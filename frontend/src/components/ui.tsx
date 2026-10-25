import type { ReactNode } from 'react'
import { ENV } from '../config/env'
import type { AssetInfo } from '../hooks/useAssets'
import type { TxState } from '../hooks/useTx'
import { explorerTx } from '../lib/format'

/** A warm working panel. Title and hint on the left at wide sizes, the work on the right. */
export function Section({ title, hint, children, className = '', id }: { title: string; hint?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`panel p-6 sm:p-8 lg:p-10 ${className}`}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:gap-12">
        <div>
          <h2 className="text-2xl font-semibold leading-tight sm:text-[1.75rem]">{title}</h2>
          {hint && <p className="mt-2 max-w-[38ch] text-[15px] leading-relaxed text-slate">{hint}</p>}
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  )
}

export function Field({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      {children}
      {note && <span className="mt-1.5 block text-[13px] leading-snug text-slate">{note}</span>}
    </label>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'bad' | 'good' | 'debt'; children: ReactNode }) {
  const styles = {
    info: 'border-rule bg-paper text-ink',
    warn: 'border-amber/40 bg-amber-soft text-amber',
    // errors and risks: strong but neutral, so oxblood keeps meaning "debt"
    bad: 'border-2 border-ink bg-paper text-ink font-medium',
    debt: 'border-oxblood/40 bg-oxblood-soft text-oxblood',
    good: 'border-verdigris/40 bg-verdigris-soft text-verdigris',
  }[tone]
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={`max-w-prose break-words rounded-2xl border px-4 py-3 text-[14px] leading-relaxed ${styles}`}>
      {children}
    </div>
  )
}

/** A key number. `size="lg"` is for the one or two figures a screen is about. */
export function Stat({ label, value, tone, size = 'md' }: { label: string; value: ReactNode; tone?: 'bad' | 'good'; size?: 'md' | 'lg' }) {
  const color = tone === 'bad' ? 'text-oxblood' : tone === 'good' ? 'text-verdigris' : 'text-ink'
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-slate">{label}</dt>
      <dd className={`font-display font-semibold tabular-nums leading-tight ${size === 'lg' ? 'text-4xl sm:text-5xl' : 'text-2xl'} ${color}`}>{value}</dd>
    </div>
  )
}

/** Plain-text empty state, so a blank list still says what will appear and how. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="max-w-prose rounded-2xl border border-dashed border-rule px-4 py-5 text-[15px] leading-relaxed text-slate">{children}</p>
}

export function TxStatus({ state }: { state: TxState }) {
  if (state.busy) {
    return (
      <p className="text-sm text-slate" role="status" aria-live="polite">
        {state.hash ? 'Waiting for the network to confirm…' : 'Confirm in your wallet…'}
      </p>
    )
  }
  if (state.error) return <Notice tone="bad">{state.error}</Notice>
  if (state.done) {
    return (
      <Notice tone="good">
        {state.done}{' '}
        {state.hash && (
          <a className="underline underline-offset-2" href={explorerTx(ENV.explorer, state.hash)} target="_blank" rel="noreferrer">
            View transaction
          </a>
        )}
      </Notice>
    )
  }
  return null
}

export function AssetPicker({ assets, value, onChange }: { assets: AssetInfo[]; value: AssetInfo; onChange: (a: AssetInfo) => void }) {
  if (assets.length < 2) return null
  return (
    <Field label="Asset">
      <select className="field" value={value.address} onChange={(e) => onChange(assets.find((a) => a.address === e.target.value) ?? assets[0]!)}>
        {assets.map((a) => (
          <option key={a.address} value={a.address}>
            {a.symbol}
          </option>
        ))}
      </select>
    </Field>
  )
}
