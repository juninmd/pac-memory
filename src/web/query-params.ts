/** Parses a numeric query/body value into an integer clamped to [min, max]; junk (NaN, "abc") falls back. */
export function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}
