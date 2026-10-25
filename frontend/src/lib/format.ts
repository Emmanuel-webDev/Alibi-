import { formatUnits, type Address } from 'viem'

export const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')
export const shortHash = (h?: string) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '')

/** 1234.5678 style: trims trailing zeros, caps the decimals shown. */
export function fmt(amount: bigint | undefined, decimals = 18, maxFrac = 4): string {
  if (amount === undefined) return '0'
  const s = formatUnits(amount, decimals)
  const [whole = '0', frac = ''] = s.split('.')
  const trimmed = frac.slice(0, maxFrac).replace(/0+$/, '')
  const w = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return trimmed ? `${w}.${trimmed}` : w
}

export const bpsToPercent = (bps: number | bigint) => `${(Number(bps) / 100).toFixed(Number(bps) % 100 === 0 ? 0 : 1)}%`

export function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}

export const explorerTx = (base: string, hash: string) => `${base.replace(/\/$/, '')}/tx/${hash}`
export const explorerAddress = (base: string, a: Address) => `${base.replace(/\/$/, '')}/address/${a}`

export const sameAddress = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
