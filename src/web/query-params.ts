/** Parses a numeric query/body value into an integer clamped to [min, max]; junk (NaN, "abc") falls back. */
export function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

/** The JSON body as a plain object, or null when it is missing, null, an array or a scalar. */
export function bodyObject(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}
