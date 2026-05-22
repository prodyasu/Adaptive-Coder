export function titleToNumber(columnTitle: string): number {
  let result = 0;
  for (const c of columnTitle) {
    result = result * 26 + (c.charCodeAt(0) - 'A'.charCodeAt(0) + 1);
  }
  return result;
}
