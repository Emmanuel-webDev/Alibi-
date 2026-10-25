export type Tone = 'locked' | 'owed' | 'garnish' | 'net' | 'neutral'

export interface Segment {
  value: bigint
  tone: Tone
  label: string
}

/**
 * Turn amounts into bar widths (percent). Every non-zero segment gets a visible sliver (>= 3%) so a small
 * amount never disappears, and widths always add up to exactly 100.
 */
export function segmentWidths(segments: Segment[]): number[] {
  const total = segments.reduce((a, s) => a + s.value, 0n)
  if (total === 0n) return segments.map(() => 0)
  const MIN = 3
  const raw = segments.map((s) => (s.value === 0n ? 0 : Number((s.value * 10_000n) / total) / 100))
  const bumped = raw.map((w, i) => (segments[i]!.value > 0n && w < MIN ? MIN : w))
  const sum = bumped.reduce((a, b) => a + b, 0)
  const scaled = bumped.map((w) => (w / sum) * 100)
  // fix rounding drift on the widest segment
  const drift = 100 - scaled.reduce((a, b) => a + b, 0)
  const widest = scaled.indexOf(Math.max(...scaled))
  if (widest >= 0) scaled[widest] = scaled[widest]! + drift
  return scaled
}
