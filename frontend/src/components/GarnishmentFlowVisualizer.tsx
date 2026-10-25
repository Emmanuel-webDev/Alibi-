import { fmt, shortAddr } from '../lib/format'

interface Props {
  gross: bigint
  garnished: bigint
  net: bigint
  decimals?: number
  symbol?: string
  creditor?: string
  recipient?: string
}

/** One payment going in, split into what the creditor collects and what the recipient keeps. Stroke widths are proportional. */
export function GarnishmentFlowVisualizer({ gross, garnished, net, decimals = 18, symbol = 'QIE', creditor, recipient }: Props) {
  const total = gross === 0n ? 1n : gross
  const w = (v: bigint) => Math.max(v === 0n ? 0 : 4, Number((v * 1000n) / total) / 1000 * 36)
  const gw = w(garnished)
  const nw = w(net)
  return (
    <figure className="m-0">
      <svg viewBox="0 0 560 200" className="h-auto w-full" role="img" aria-label={`${fmt(gross, decimals)} ${symbol} paid in. ${fmt(garnished, decimals)} goes to the creditor and ${fmt(net, decimals)} reaches the recipient.`}>
        <text x="8" y="104" className="fill-ink font-display" fontSize="15" fontWeight="600">
          {fmt(gross, decimals)} {symbol}
        </text>
        <text x="8" y="124" className="fill-slate" fontSize="12">paid in</text>
        <path className="text-oxblood" d="M120 100 C 220 100, 230 52, 340 52 L 420 52" fill="none" stroke="currentColor" strokeWidth={gw} strokeLinecap="butt" opacity={garnished === 0n ? 0 : 1} />
        <path className="text-verdigris" d="M120 100 C 220 100, 230 148, 340 148 L 420 148" fill="none" stroke="currentColor" strokeWidth={nw} strokeLinecap="butt" opacity={net === 0n ? 0 : 1} />
        <text x="432" y="48" className="fill-oxblood font-display" fontSize="15" fontWeight="600">
          {fmt(garnished, decimals)} {symbol}
        </text>
        <text x="432" y="66" className="fill-slate" fontSize="12">to creditor{creditor ? ` ${shortAddr(creditor)}` : ''}</text>
        <text x="432" y="144" className="fill-verdigris font-display" fontSize="15" fontWeight="600">
          {fmt(net, decimals)} {symbol}
        </text>
        <text x="432" y="162" className="fill-slate" fontSize="12">to recipient{recipient ? ` ${shortAddr(recipient)}` : ''}</text>
      </svg>
    </figure>
  )
}
