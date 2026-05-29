/**
 * providers.js — local provider shim for the recovered eval harness.
 *
 * The original handoff excluded ../cc-lib, so eval.js cannot import
 * ../cc-lib/build/providers.js on this host. This shim preserves the small API
 * surface eval.js needs without restoring OpenClaw runtime code.
 */

export class OllamaTimeoutError extends Error {
  constructor(message = 'Ollama request timed out') {
    super(message);
    this.name = 'OllamaTimeoutError';
  }
}

export class OllamaRateLimitError extends Error {
  constructor(message = 'Ollama request rate limited') {
    super(message);
    this.name = 'OllamaRateLimitError';
  }
}

export class OllamaNetworkError extends Error {
  constructor(message = 'Ollama network error') {
    super(message);
    this.name = 'OllamaNetworkError';
  }
}

export class OllamaModelError extends Error {
  constructor(message = 'Ollama model error') {
    super(message);
    this.name = 'OllamaModelError';
  }
}

function baseUrl() {
  return (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
}

function headers() {
  const h = { 'Content-Type': 'application/json' };
  const token = process.env.OLLAMA_API_KEY || process.env.OLLAMA_CLOUD_API_KEY;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function combineSignals(timeoutMs, externalSignal) {
  const controller = new AbortController();
  const timer = timeoutMs > 0
    ? setTimeout(() => controller.abort(new OllamaTimeoutError(`${timeoutMs}ms limit`)), timeoutMs)
    : null;

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), { once: true });
    }
  }

  return { signal: controller.signal, cleanup: () => { if (timer) clearTimeout(timer); } };
}

function parseOllamaResponseText(text) {
  const trimmed = text.trim();
  if (!trimmed) return {};

  // stream:false returns one JSON object; streamed mode returns NDJSON.
  if (!trimmed.includes('\n')) return JSON.parse(trimmed);

  let finalObj = {};
  let content = '';
  for (const line of trimmed.split('\n')) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    finalObj = obj;
    if (obj.message?.content) content += obj.message.content;
    if (obj.response) content += obj.response;
  }
  return { ...finalObj, message: { ...(finalObj.message || {}), content } };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeProviderError(err, timeoutMs) {
  if (err instanceof OllamaTimeoutError || err instanceof OllamaRateLimitError || err instanceof OllamaModelError || err instanceof OllamaNetworkError) {
    return err;
  }
  if (err?.name === 'AbortError' || err instanceof DOMException) {
    return new OllamaTimeoutError(`${timeoutMs}ms limit`);
  }
  return new OllamaNetworkError(err?.message || String(err));
}

async function callOllamaOnce(model, messages, { maxTokens, timeoutMs, externalSignal }) {
  const { signal, cleanup } = combineSignals(timeoutMs, externalSignal);

  try {
    const response = await fetch(`${baseUrl()}/api/chat`, {
      method: 'POST',
      headers: headers(),
      signal,
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        think: false,
        options: { num_predict: maxTokens },
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      const detail = text.slice(0, 300) || response.statusText;
      if (response.status === 429) throw new OllamaRateLimitError(detail);
      if (response.status === 408 || response.status === 504) throw new OllamaTimeoutError(detail);
      if (response.status === 400 || response.status === 404) throw new OllamaModelError(detail);
      throw new OllamaNetworkError(`HTTP ${response.status}: ${detail}`);
    }

    const data = parseOllamaResponseText(text);
    const content = data.message?.content ?? data.response ?? '';
    return {
      content,
      model: data.model || model,
      usage: {
        input_tokens: data.prompt_eval_count ?? 0,
        output_tokens: data.eval_count ?? Math.ceil(content.length / 4),
      },
    };
  } catch (err) {
    throw normalizeProviderError(err, timeoutMs);
  } finally {
    cleanup();
  }
}

export async function callOllama(model, messages, opts = {}) {
  const {
    maxTokens = 4000,
    timeoutMs = 30_000,
    signal: externalSignal,
    retryNetworkErrors = Number(process.env.OLLAMA_NETWORK_RETRIES ?? 2),
    retryBaseDelayMs = Number(process.env.OLLAMA_NETWORK_RETRY_DELAY_MS ?? 750),
  } = opts;

  const maxRetries = Math.max(0, Number.isFinite(retryNetworkErrors) ? retryNetworkErrors : 0);
  const baseDelayMs = Math.max(0, Number.isFinite(retryBaseDelayMs) ? retryBaseDelayMs : 0);

  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callOllamaOnce(model, messages, { maxTokens, timeoutMs, externalSignal });
    } catch (err) {
      lastErr = err;
      const shouldRetry = err instanceof OllamaNetworkError && attempt < maxRetries && !externalSignal?.aborted;
      if (!shouldRetry) throw err;
      const delayMs = baseDelayMs * (2 ** attempt);
      if (delayMs > 0) await sleep(delayMs);
    }
  }
  throw lastErr;
}
