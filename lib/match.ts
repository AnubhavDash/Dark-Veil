/** face-api convention: Euclidean distance < 0.6 between 128-d descriptors is the same person. */
export const MATCH_THRESHOLD = 0.6

export function euclid(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    s += d * d
  }
  return Math.sqrt(s)
}

/** Map distance to a friendly 0-100 similarity. 0 → 100%, 0.6 → 40%, 1.0+ → 0%. */
export function similarity(distance: number): number {
  return Math.max(0, Math.min(100, Math.round((1 - distance) * 1000) / 10))
}
