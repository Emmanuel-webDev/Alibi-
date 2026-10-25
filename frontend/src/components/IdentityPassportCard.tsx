import { useState } from 'react'
import { isAddress, parseUnits, type Address } from 'viem'
import { useAccount } from 'wagmi'
import { registryAbi } from '../abi'
import { ENV } from '../config/env'
import { NATIVE, type AssetInfo } from '../hooks/useAssets'
import { TIER_NAMES, useAlibiIdentity, useIdentityBalances } from '../hooks/useAlibiIdentity'
import { useBind } from '../hooks/useBind'
import { useQiePassIdentity } from '../hooks/useQiePassIdentity'
import { useTx } from '../hooks/useTx'
import { bpsToPercent, fmt, shortHash } from '../lib/format'
import { QiePassVerificationGate } from './QiePassVerificationGate'
import { Field, Notice, Section, Stat, TxStatus } from './ui'

function AddWalletPanel() {
  const { state, authorize, reset } = useBind()
  const [target, setTarget] = useState('')
  const ok = isAddress(target)
  const busy = ['sign', 'attest'].includes(state.step)
  return (
    <div className="space-y-3">
      <p className="max-w-prose text-[15px] leading-relaxed text-slate">
        Authorize another wallet you control, then switch to it in QIE Wallet. It will show an Add button. Paste the wallet address here, not an ID.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <Field label="Wallet to add">
            <input className="field" name="wallet-to-add" autoComplete="off" placeholder="0x…" value={target} onChange={(e) => { setTarget(e.target.value.trim()); reset() }} spellCheck={false} />
          </Field>
        </div>
        <button className="btn btn-secondary" disabled={!ok || busy} onClick={() => authorize(target as Address)}>Authorize this wallet</button>
      </div>
      {state.step === 'sign' && <p className="text-sm text-slate" role="status" aria-live="polite">Sign the message in your wallet…</p>}
      {state.step === 'attest' && <p className="text-sm text-slate" role="status" aria-live="polite">Checking QIE Pass…</p>}
      {state.step === 'done' && <Notice tone="good">{state.note}</Notice>}
      {state.step === 'error' && <Notice tone="bad">{state.error}</Notice>}
    </div>
  )
}

function StakePanel({ asset, identityId }: { asset: AssetInfo; identityId: `0x${string}` }) {
  const { stake, exposure } = useIdentityBalances(identityId, asset.address)
  const { state, run, ensureAllowance, writeContractAsync } = useTx()
  const [amount, setAmount] = useState('')
  let parsed = 0n
  try {
    parsed = amount ? parseUnits(amount, asset.decimals) : 0n
  } catch {
    parsed = 0n
  }
  const free = stake > exposure ? stake - exposure : 0n

  return (
    <div className="space-y-3">
      <dl><Stat size="lg" label="Staked" value={`${fmt(stake, asset.decimals)} ${asset.symbol}`} /></dl>
      <p className="max-w-prose text-[15px] leading-relaxed text-slate">
        Stake backs your agreements and lowers the bond you post. If you default, it is taken first.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-44">
          <Field label={`Amount (${asset.symbol})`}>
            <input className="field" name="stake-amount" autoComplete="off" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </div>
        <button
          className="btn btn-secondary"
          disabled={state.busy || parsed === 0n}
          onClick={() =>
            run('Stake added.', async () => {
              await ensureAllowance(asset.address, ENV.registry, parsed)
              return writeContractAsync({ address: ENV.registry, abi: registryAbi, functionName: 'stake', args: [asset.address, parsed], value: asset.native ? parsed : 0n })
            })
          }
        >
          Add stake
        </button>
        <button
          className="btn btn-secondary"
          disabled={state.busy || parsed === 0n || parsed > free}
          onClick={() => run('Stake withdrawn.', () => writeContractAsync({ address: ENV.registry, abi: registryAbi, functionName: 'withdrawStake', args: [asset.address, parsed] }))}
        >
          Withdraw
        </button>
      </div>
      {parsed > free && parsed > 0n && <p className="text-[13px] text-slate">You can withdraw up to {fmt(free, asset.decimals)} {asset.symbol}. The rest backs open agreements.</p>}
      <TxStatus state={state} />
    </div>
  )
}

export function IdentityPassportCard({ asset = NATIVE }: { asset?: AssetInfo }) {
  const { isConnected } = useAccount()
  const { state: passState, pass } = useQiePassIdentity()
  const id = useAlibiIdentity()
  const bal = useIdentityBalances(id.identityId, asset.address)

  return (
    <>
      <Section title="Your identity" hint="One QIE identity can use several wallets. Its record follows it to all of them.">
        {!id.linked ? (
          <QiePassVerificationGate />
        ) : (
          <div className="space-y-8">
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate">
              <span className="chip bg-verdigris-soft text-verdigris"><span aria-hidden className="h-2 w-2 rounded-full bg-verdigris" />Bound to QIE Pass</span>
              <span className="tabular-nums">{shortHash(id.identityId)}</span>
            </div>
            <dl className="flex flex-wrap gap-x-14 gap-y-6">
              <div className="min-w-0">
                <dt className="text-[13px] text-slate">Tier</dt>
                <dd className="font-display text-4xl font-semibold leading-tight sm:text-5xl">{id.tierName}</dd>
                <dd className="mt-1 max-w-[34ch] text-[14px] text-slate">{id.tier >= 2 ? `You post ${bpsToPercent(id.floorBps)} of each deal as a bond.` : 'No history yet, so you post the full amount.'}</dd>
              </div>
              <Stat size="lg" label="Debt owed" value={`${fmt(bal.debt, asset.decimals)} ${asset.symbol}`} tone={bal.debt > 0n ? 'bad' : undefined} />
            </dl>
            {id.activeDebt && <Notice tone="debt">This identity owes {fmt(bal.debt, asset.decimals)} {asset.symbol}. It comes out of the next payment any of its wallets receives through Alibi.</Notice>}
            <dl className="grid grid-cols-2 gap-x-8 gap-y-5 border-t border-rule pt-6 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
              <Stat label="Settled deals" value={id.settledDeals} />
              <Stat label="Different counterparties" value={id.uniqueCounterparties} />
              <Stat label="Defaults" value={id.defaultCount} tone={id.defaultCount ? 'bad' : undefined} />
              <Stat label="Linked wallets" value={id.walletCount} />
              <Stat label="Unsecured room left" value={`${fmt(bal.freeCapacity, asset.decimals)} ${asset.symbol}`} />
            </dl>
            <p className="max-w-prose text-[13px] leading-relaxed text-slate">
              Tiers, lowest to highest: {TIER_NAMES.slice(1).join(', ')}. To move up, settle more deals with different verified people over time.
            </p>
          </div>
        )}
      </Section>
      {isConnected && id.linked && passState === 'linked' && pass?.isVerified && (
        <Section title="Add another wallet" hint="Only a wallet that QIE Pass has verified can authorize others.">
          <AddWalletPanel />
        </Section>
      )}
      {isConnected && id.linked && (
        <Section title="Stake" hint="Optional. Stake up front and you post a smaller bond on each deal.">
          <StakePanel asset={asset} identityId={id.identityId} />
        </Section>
      )}
    </>
  )
}
