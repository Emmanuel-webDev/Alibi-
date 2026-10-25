import { useEffect, useState } from 'react'
import { fmt } from '../lib/format'
import { segmentWidths, type Segment, type Tone } from '../lib/split'

const COLOR: Record<Tone, string> = {
  locked: 'bg-ink',
  owed: 'bg-slate',
  garnish: 'bg-oxblood',
  net: 'bg-verdigris',
  neutral: 'bg-rule',
}
const TEXT: Record<Tone, string> = {
  locked: 'text-ink',
  owed: 'text-ink',
  garnish: 'text-oxblood',
  net: 'text-verdigris',
  neutral: 'text-ink',
}

/** Signature element: one bar, split into who gets what. Segments grow in once on mount. */
export function SplitBar({ segments, decimals = 18, symbol = 'QIE', height = 'h-5', size = 'md' }: { segments: Segment[]; decimals?: number; symbol?: string; height?: string; size?: 'md' | 'hero' }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(t)
  }, [])
  const widths = segmentWidths(segments)
  const visible = segments.filter((s) => s.value > 0n)
  const hero = size === 'hero'

  return (
    <div>
      <div
        className={`flex w-full gap-[3px] overflow-hidden bg-paper-deep ${hero ? 'h-16 rounded-full sm:h-20' : `${height} rounded-full`}`}
        role="img"
        aria-label={visible.map((s) => `${s.label} ${fmt(s.value, decimals)} ${symbol}`).join(', ')}
      >
        {segments.map((s, i) => (
          <div key={i} className={`split-seg ${COLOR[s.tone]}`} style={{ width: shown ? `${widths[i]}%` : '0%' }} />
        ))}
      </div>
      {hero ? (
        <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
          {visible.map((s, i) => (
            <div key={i} className={i === visible.length - 1 && visible.length > 1 ? 'sm:text-right' : ''}>
              <dt className="flex items-center gap-2 text-sm text-slate sm:text-[15px]" style={{ justifyContent: i === visible.length - 1 && visible.length > 1 ? undefined : undefined }}>
                <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${COLOR[s.tone]}`} />
                {s.label}
              </dt>
              <dd className={`mt-1 font-display text-4xl font-semibold tabular-nums leading-none sm:text-5xl lg:text-6xl ${TEXT[s.tone]}`}>
                {fmt(s.value, decimals)}
                <span className="ml-2 text-lg font-medium text-slate sm:text-2xl">{symbol}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {visible.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${COLOR[s.tone]}`} />
              <span className="text-slate">{s.label}</span>
              <span className="font-semibold tabular-nums">
                {fmt(s.value, decimals)} {symbol}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
