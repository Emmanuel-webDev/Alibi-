import { describe, expect, it } from 'vitest'
import { bpsToPercent, duration, fmt, shortAddr } from '../lib/format'
import { segmentWidths } from '../lib/split'

describe('format', () => {
  it('trims zeros and groups thousands', () => {
    expect(fmt(1234500000000000000000n)).toBe('1,234.5')
    expect(fmt(0n)).toBe('0')
    expect(fmt(undefined)).toBe('0')
  })
  it('formats bps and durations', () => {
    expect(bpsToPercent(1000)).toBe('10%')
    expect(bpsToPercent(250)).toBe('2.5%')
    expect(duration(15)).toBe('15s')
    expect(duration(125)).toBe('2m 5s')
  })
  it('shortens addresses', () => {
    expect(shortAddr('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678')
  })
})

describe('segmentWidths', () => {
  it('splits 450/550 and sums to 100', () => {
    const w = segmentWidths([{ value: 450n, tone: 'garnish', label: 'a' }, { value: 550n, tone: 'net', label: 'b' }])
    expect(w[0]).toBeCloseTo(45, 1)
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5)
  })
  it('keeps tiny non-zero segments visible', () => {
    const w = segmentWidths([{ value: 1n, tone: 'locked', label: 'a' }, { value: 100000n, tone: 'owed', label: 'b' }])
    expect(w[0]!).toBeGreaterThanOrEqual(2.5)
  })
  it('handles all zero', () => {
    expect(segmentWidths([{ value: 0n, tone: 'net', label: 'a' }])).toEqual([0])
  })
})
