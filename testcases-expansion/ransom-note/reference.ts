export function canConstruct(ransom: string, magazine: string): boolean {
  const freq = new Map<string, number>();
  for (const c of magazine) freq.set(c, (freq.get(c) || 0) + 1);
  for (const c of ransom) {
    if (!freq.has(c) || freq.get(c)! <= 0) return false;
    freq.set(c, freq.get(c)! - 1);
  }
  return true;
}
