/**
 * test-providers-retry.js — callOllama retry-on-network-error behavior.
 */
import assert from 'assert';
import {
  callOllama,
  OllamaModelError,
  OllamaNetworkError,
  OllamaRateLimitError,
} from './providers.js';

const originalFetch = globalThis.fetch;

function jsonResponse(body, { status = 200, statusText = 'OK' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
  };
}

async function withFetch(mockFetch, fn) {
  globalThis.fetch = mockFetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('\n=== test-providers-retry.js ===\n');

console.log('Test 1: retries transient fetch/network failures and succeeds');
{
  let calls = 0;
  await withFetch(async () => {
    calls++;
    if (calls < 3) throw new TypeError('fetch failed');
    return jsonResponse({ model: 'm', message: { content: 'ok' }, prompt_eval_count: 2, eval_count: 1 });
  }, async () => {
    const result = await callOllama('m', [{ role: 'user', content: 'hi' }], {
      retryNetworkErrors: 2,
      retryBaseDelayMs: 1,
    });
    assert.strictEqual(result.content, 'ok');
    assert.strictEqual(calls, 3, 'should call fetch initial + 2 retries');
  });
  console.log('  ✓ transient network failures retried');
}

console.log('Test 2: retries HTTP 5xx network errors and succeeds');
{
  let calls = 0;
  await withFetch(async () => {
    calls++;
    if (calls === 1) return jsonResponse('bad gateway', { status: 502, statusText: 'Bad Gateway' });
    return jsonResponse({ model: 'm', message: { content: 'ok-5xx' } });
  }, async () => {
    const result = await callOllama('m', [{ role: 'user', content: 'hi' }], {
      retryNetworkErrors: 1,
      retryBaseDelayMs: 1,
    });
    assert.strictEqual(result.content, 'ok-5xx');
    assert.strictEqual(calls, 2, 'should retry 5xx once');
  });
  console.log('  ✓ HTTP 5xx retried');
}

console.log('Test 3: exhausts network retries with OllamaNetworkError');
{
  let calls = 0;
  await withFetch(async () => {
    calls++;
    throw new TypeError('socket hang up');
  }, async () => {
    await assert.rejects(
      () => callOllama('m', [{ role: 'user', content: 'hi' }], {
        retryNetworkErrors: 2,
        retryBaseDelayMs: 1,
      }),
      OllamaNetworkError,
    );
    assert.strictEqual(calls, 3, 'should attempt initial + 2 retries');
  });
  console.log('  ✓ retry exhaustion preserves network error');
}

console.log('Test 4: does not retry model or rate-limit errors');
{
  let modelCalls = 0;
  await withFetch(async () => {
    modelCalls++;
    return jsonResponse('missing model', { status: 404, statusText: 'Not Found' });
  }, async () => {
    await assert.rejects(
      () => callOllama('m', [{ role: 'user', content: 'hi' }], {
        retryNetworkErrors: 2,
        retryBaseDelayMs: 1,
      }),
      OllamaModelError,
    );
    assert.strictEqual(modelCalls, 1, 'should not retry model errors');
  });

  let rateCalls = 0;
  await withFetch(async () => {
    rateCalls++;
    return jsonResponse('too many requests', { status: 429, statusText: 'Too Many Requests' });
  }, async () => {
    await assert.rejects(
      () => callOllama('m', [{ role: 'user', content: 'hi' }], {
        retryNetworkErrors: 2,
        retryBaseDelayMs: 1,
      }),
      OllamaRateLimitError,
    );
    assert.strictEqual(rateCalls, 1, 'should not retry rate-limit errors');
  });
  console.log('  ✓ non-network errors are not retried');
}

console.log('\nPASSED');
