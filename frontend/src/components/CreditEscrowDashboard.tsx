import { useMemo, useState } from 'react'
import { isAddress, parseUnits, zeroAddress, type Address } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import { escrowAbi, routerAbi } from '../abi'
import { ENV } from '../config/env'
import { NATIVE, type AssetInfo } from '../hooks/useAssets'
import { STATUS, STATUS_LABEL, useAgreements, type Agreement } from '../hooks/useAgreements'
import { TIER_NAMES, useAlibiIdentity } from '../hooks/useAlibiIdentity'
import { useNow } from '../hooks/useNow'
import { useTx } from '../hooks/useTx'
import { friendlyError } from '../lib/errors'
import { duration, fmt, sameAddress, shortAddr } from '../lib/format'
import { QiePassVerificationGate } from './QiePassVerificationGate'
import { SplitBar } from './SplitBar'
import { AssetPicker, Empty, Field, Notice, Section, Stat, TxStatus } from './ui'

function parse(v: string, decimals: number): bigint {
  try {
    return v ? parseUnits(v, decimals) : 0n
  } catch {
    return 0n
  }
}

function CreateAgreement({ assets, asset, setAsset }: { assets: AssetInfo[]; asset: AssetInfo; setAsset: (a: AssetInfo) => void }) {
  const { address } = useAccount()
  const id = useAlibiIdentity()
  const { state, run, ensureAllowance, writeContractAsync } = useTx()
  const [creditor, setCreditor] = useState(ENV.demoMerchant)
  const [amount, setAmount] = useState('')
  const [duration_, setDuration] = useState('')

  const total = parse(amount, asset.decimals)
  const minDuration = useReadContract({ address: ENV.escrow, abi: escrowAbi, functionName: 'minDuration' })
  const dur = duration_ ? BigInt(duration_) : (minDuration.data ?? 15n)
  const creditorOk = isAddress(creditor) && !sameAddress(creditor, address)
  // the bond depends on the creditor's own rules, so quote against the creditor
  const quote = useReadContract({
    address: ENV.escrow,
    abi: escrowAbi,
    functionName: 'quoteFor',
    args: [address ?? zeroAddress, creditorOk ? (creditor as Address) : zeroAddress, asset.address, total],
    query: { enabled: !!address && total > 0n },
  })
  const paused = useReadContract({ address: ENV.escrow, abi: escrowAbi, functionName: 'paused', query: { refetchInterval: 8000 } })
  const bond = quote.data?.[0] ?? 0n

  return (
    <div className="space-y-5">
      <p className="max-w-prose text-[15px] leading-relaxed text-slate">
        You lock a bond now and pay the rest by the deadline. Miss it and the bond goes to the creditor. Whatever is still unpaid becomes debt on your identity and is taken from any of your wallets.
      </p>
      <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <Field label="Creditor address">
          <input className="field" name="creditor" autoComplete="off" placeholder="0x…" value={creditor} onChange={(e) => setCreditor(e.target.value.trim())} spellCheck={false} />
        </Field>
        <Field label={`Deal size (${asset.symbol})`}>
          <input className="field" name="deal-size" autoComplete="off" inputMode="decimal" placeholder="500" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Deadline (seconds from now)" note={`The minimum here is ${(minDuration.data ?? 0n).toString()} seconds.`}>
          <input className="field" name="deadline" autoComplete="off" inputMode="numeric" placeholder={(minDuration.data ?? 15n).toString()} value={duration_} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <AssetPicker assets={assets} value={asset} onChange={setAsset} />
      </div>

      {total > 0n && quote.data && (
        <div className="max-w-2xl space-y-2 rounded-2xl bg-paper-deep p-4">
          <SplitBar height="h-6" decimals={asset.decimals} symbol={asset.symbol} segments={[{ value: bond, tone: 'locked', label: 'Bond you lock now' }, { value: total - bond, tone: 'owed', label: 'Pay by the deadline' }]} />
          <p className="text-sm text-slate">
            {id.linked ? `Your tier is ${id.tierName}.` : 'Verify with QIE Pass and bind this wallet before you open an agreement.'}
            {bond === total && id.linked ? (id.defaultCount > 0 ? ' With a default on record, the bond is the full amount.' : ' With no history yet, the bond is the full amount.') : ''}
          </p>
        </div>
      )}
      {paused.data === true && <Notice tone="warn">New agreements are paused. You can still settle and record defaults.</Notice>}
      {quote.isError && total > 0n && creditorOk && <Notice tone="bad">{friendlyError(quote.error)}</Notice>}
      {!id.linked && address && <div className="max-w-prose rounded-2xl border border-rule bg-paper p-4"><QiePassVerificationGate compact /></div>}
      <button
        className="btn btn-primary"
        disabled={state.busy || !id.linked || !creditorOk || total === 0n || bond === 0n || paused.data === true}
        onClick={() =>
          run('Agreement opened.', async () => {
            await ensureAllowance(asset.address, ENV.escrow, bond)
            return writeContractAsync({ address: ENV.escrow, abi: escrowAbi, functionName: 'createAgreement', args: [creditor as Address, asset.address, total, dur], value: asset.native ? bond : 0n })
          })
        }
      >
        Open agreement
      </button>
      {creditor && !creditorOk && <p role="alert" className="text-[13px] font-medium text-amber">Enter a valid creditor address. It can’t be your own wallet.</p>}
      <TxStatus state={state} />
    </div>
  )
}

function AgreementRow({ a, assets }: { a: Agreement; assets: AssetInfo[] }) {
  const { address } = useAccount()
  const now = useNow()
  const { state, run, ensureAllowance, writeContractAsync } = useTx()
  const asset = assets.find((x) => sameAddress(x.address, a.asset)) ?? NATIVE
  const fee = useReadContract({ address: ENV.escrow, abi: escrowAbi, functionName: 'feeFor', args: [a.total] })
  const remaining = a.total - a.bond
  const settleDue = remaining + (fee.data ?? 0n)
  const left = Number(a.deadline) - now
  const isPayer = sameAddress(a.payer, address)
  const isCreditor = sameAddress(a.creditor, address)
  const open = a.status === STATUS.Open

  return (
    <li className="border-t border-rule py-5 first:border-t-0 first:pt-0">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-display text-xl font-semibold tabular-nums">
          <span className="text-slate">#{a.id.toString()}</span> {fmt(a.total, asset.decimals)} {asset.symbol}
        </p>
        <p className={`chip ${a.status === STATUS.Defaulted ? 'bg-oxblood-soft text-oxblood' : a.status === STATUS.Settled ? 'bg-verdigris-soft text-verdigris' : 'bg-paper-deep text-ink'}`}>
          {STATUS_LABEL[a.status]}
          {open && (left > 0 ? `, ${duration(left)} left` : ', deadline passed')}
        </p>
      </div>
      <SplitBar height="h-3" decimals={asset.decimals} symbol={asset.symbol} segments={[{ value: a.bond, tone: 'locked', label: 'Bond' }, { value: remaining, tone: a.status === STATUS.Defaulted ? 'garnish' : 'owed', label: a.status === STATUS.Defaulted ? 'Became debt' : 'Remaining' }]} />
      <p className="mt-2 text-sm text-slate">
        {isPayer ? `You owe ${shortAddr(a.creditor)}` : `${shortAddr(a.payer)} owes you`}.
      </p>
      {open && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {isPayer && left > 0 && (
            <button
              className="btn btn-primary"
              disabled={state.busy || fee.data === undefined}
              onClick={() =>
                run('Settled. The creditor was paid in full.', async () => {
                  await ensureAllowance(asset.address, ENV.escrow, settleDue)
                  return writeContractAsync({ address: ENV.escrow, abi: escrowAbi, functionName: 'settleAgreement', args: [a.id], value: asset.native ? settleDue : 0n })
                })
              }
            >
              Settle for {fmt(settleDue, asset.decimals)} {asset.symbol}
            </button>
          )}
          {left <= 0 && isCreditor && (
            <button
              className="btn btn-secondary"
              disabled={state.busy}
              onClick={() =>
                run('Default claimed. Bond seized and debt recorded.', () =>
                  writeContractAsync({ address: ENV.escrow, abi: escrowAbi, functionName: 'triggerDefault', args: [a.id] })
                )
              }
            >
              Claim default and seize bond
            </button>
          )}
          {left <= 0 && isPayer && (
            <span className="self-center text-sm text-slate">Past deadline, creditor can claim</span>
          )}
        </div>
      )}
      <div className="mt-2">
        <TxStatus state={state} />
      </div>
    </li>
  )
}

export function ClaimablePanel() {
  const { address } = useAccount()
  const { state, run, writeContractAsync } = useTx()
  const escrowNative = useReadContract({ address: ENV.escrow, abi: escrowAbi, functionName: 'claimable', args: [address ?? zeroAddress, NATIVE.address], query: { enabled: !!address, refetchInterval: 6000 } })
  const routerNative = useReadContract({ address: ENV.router, abi: routerAbi, functionName: 'claimable', args: [address ?? zeroAddress, NATIVE.address], query: { enabled: !!address, refetchInterval: 6000 } })
  const pending = useMemo(
    () => [
      { from: 'escrow' as const, a: NATIVE, v: escrowNative.data ?? 0n },
      { from: 'router' as const, a: NATIVE, v: routerNative.data ?? 0n },
    ].filter((p) => p.v > 0n),
    [escrowNative.data, routerNative.data],
  )
  if (pending.length === 0) return null
  return (
    <div className="space-y-2">
      <Notice tone="info">Some payouts couldn’t be sent straight to you, so they are held here. Withdraw them below.</Notice>
      {pending.map((p) => (
        <button
          key={p.from}
          className="btn btn-secondary mr-3"
          disabled={state.busy}
          onClick={() =>
            run('Withdrawn.', () =>
              p.from === 'escrow'
                ? writeContractAsync({ address: ENV.escrow, abi: escrowAbi, functionName: 'withdrawClaimable', args: [p.a.address] })
                : writeContractAsync({ address: ENV.router, abi: routerAbi, functionName: 'withdrawClaimable', args: [p.a.address] }),
            )
          }
        >
          Withdraw {fmt(p.v, p.a.decimals)} {p.a.symbol}
        </button>
      ))}
      <TxStatus state={state} />
    </div>
  )
}

function CreditorPolicyPanel() {
  const { address } = useAccount()
  const { state, run, writeContractAsync } = useTx()
  const current = useReadContract({ address: ENV.escrow, abi: escrowAbi, functionName: 'creditorPolicy', args: [address ?? zeroAddress], query: { enabled: !!address } })
  const [pct, setPct] = useState('')
  const [tier, setTier] = useState('0')
  const bps = pct === '' ? undefined : Math.round(Number(pct) * 100)
  const valid = bps !== undefined && Number.isFinite(bps) && bps >= 0 && bps <= 10_000
  return (
    <div className="space-y-5">
      <p className="max-w-prose text-[15px] leading-relaxed text-slate">
        When you are the one being paid, you set the risk you accept. Anyone opening an agreement with you must lock at least this share up front and have at least this tier. Changes apply to new agreements only.
      </p>
      {current.data && (
        <dl className="flex flex-wrap gap-x-14 gap-y-4" aria-label="Your current rules">
          <Stat size="lg" label="Up front, at least" value={`${Number(current.data[0]) / 100}%`} />
          <Stat size="lg" label="Minimum tier" value={TIER_NAMES[Number(current.data[1])] ?? 'Unverified'} />
        </dl>
      )}
      <div className="flex flex-wrap items-end gap-3 border-t border-rule pt-5">
        <div className="w-full sm:w-44">
          <Field label="Minimum up front (%)">
            <input className="field" name="min-upfront" autoComplete="off" inputMode="decimal" placeholder="50" value={pct} onChange={(e) => setPct(e.target.value)} />
          </Field>
        </div>
        <div className="w-full sm:w-48">
          <Field label="Minimum tier">
            <select className="field" name="min-tier" value={tier} onChange={(e) => setTier(e.target.value)}>
              {TIER_NAMES.map((n, i) => (
                <option key={n} value={i}>{n}</option>
              ))}
            </select>
          </Field>
        </div>
        <button className="btn btn-secondary" disabled={state.busy || !valid || !address} onClick={() => run('Rules saved.', () => writeContractAsync({ address: ENV.escrow, abi: escrowAbi, functionName: 'setCreditorPolicy', args: [bps!, Number(tier)] }))}>
          Save my rules
        </button>
      </div>
      <TxStatus state={state} />
    </div>
  )
}

export function CreditEscrowDashboard({ assets, asset, setAsset }: { assets: AssetInfo[]; asset: AssetInfo; setAsset: (a: AssetInfo) => void }) {
  const { address } = useAccount()
  const { mine, loading } = useAgreements(address)
  return (
    <>
      <Section title="Open an agreement" hint="Pay in two parts: a bond now, the rest by the deadline.">
        <CreateAgreement assets={assets} asset={asset} setAsset={setAsset} />
      </Section>
      <Section id="creditor-rules" title="Your rules as a creditor" hint="Optional. Set limits for people who owe you.">
        <CreditorPolicyPanel />
      </Section>
      <Section title="Your agreements" hint="Deals where you pay or get paid, newest first.">
        {!address ? (
          <Empty>Connect a wallet to see your agreements.</Empty>
        ) : loading ? (
          <p className="text-[15px] text-slate" role="status" aria-live="polite">Loading agreements…</p>
        ) : mine.length === 0 ? (
          <Empty>No agreements yet. Open one above and it will show up here.</Empty>
        ) : (
          <ul>{mine.map((a) => <AgreementRow key={a.id.toString()} a={a} assets={assets} />)}</ul>
        )}
        <div className="mt-4">
          <ClaimablePanel />
        </div>
      </Section>
    </>
  )
}
