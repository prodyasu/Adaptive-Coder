export function criticalConnections(n: number, connections: number[][]): number[][] {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [u, v] of connections) {
    adj[u].push(v);
    adj[v].push(u);
  }

  const disc: number[] = new Array(n).fill(-1);
  const low: number[] = new Array(n).fill(-1);
  const result: number[][] = [];
  let time = 0;

  function dfs(u: number, parent: number): void {
    disc[u] = low[u] = time++;
    for (const v of adj[u]) {
      if (v === parent) continue;
      if (disc[v] === -1) {
        dfs(v, u);
        low[u] = Math.min(low[u], low[v]);
        if (low[v] > disc[u]) {
          result.push([Math.min(u, v), Math.max(u, v)]);
        }
      } else {
        low[u] = Math.min(low[u], disc[v]);
      }
    }
  }

  for (let i = 0; i < n; i++) {
    if (disc[i] === -1) dfs(i, -1);
  }

  return result;
}