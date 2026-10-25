import { useState } from 'react'
import { isAddress, parseEther, zeroAddress, type Address } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import { escrowAbi, registryAbi, routerAbi } from '../abi'
import { ENV } from '../config/env'
import { STATUS, useAgreements } from '../hooks/useAgreements'
import { useAlibiIdentity, useIdentityBalances } from '../hooks/useAlibiIdentity'
import { useNow } from '../hooks/useNow'
import { useTx } from '../hooks/useTx'
import { duration, fmt, sameAddress } from '../lib/format'
import { GarnishmentFlowVisualizer } from './GarnishmentFlowVisualizer'
import { QiePassVerificationGate } from './QiePassVerificationGate'
import { Empty, Field, Notice, Section, Stat, TxStatus } from './ui'

const ASSET = zeroAddress
export const PRESETS = [
  { label: '0.1 QIE', deal: parseEther('0.1'), pay: parseEther('0.2') },
  { label: '0.5 QIE', deal: parseEther('0.5'), pay: parseEther('1.0') },
  { label: '1 QIE', deal: parseEther('1.0'), pay: parseEther('2.0') },
] as const

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <li className="group relative grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4 pb-10 last:pb-0 sm:gap-x-6">
      <span aria-hidden className="absolute bottom-0 left-[1.2rem] top-11 w-px bg-rule group-last:hidden" />
      <span className={`flex h-10 w-10 items-center justify-center rounded-full font-display text-lg font-bold tabular-nums ${done ? 'bg-verdigris-soft text-verdigris' : 'bg-ink text-panel'}`}>{n}</span>
      <div className="min-w-0 pt-1.5">
        <h3 className="text-xl font-semibold leading-snug">
          {title}
          {done && <span className="chip ml-2 bg-verdigris-soft align-middle text-[13px] text-verdigris">Done</span>}
        </h3>
        <div className="mt-4">{children}</div>
      </div>
    </li>
  )
}

/** A guided, real run of the headline scenario on the connected network. Nothing here is simulated. */
export function JudgeSandbox() {
  const { address } = useAccount()
  const id = useAlibiIdentity()
  const bal = useIdentityBalances(id.identityId, ASSET)
  const now = useNow()
  const { mine } = useAgreements(address)
  const [presetIndex, setPresetIndex] = useState(0)
  const [walletB, setWalletB] = useState('')
  const [merchant, setMerchant] = useState(ENV.demoMerchant)
  const dealTx = useTx()
  const defTx = useTx()
  const payTx = useTx()

  const DEAL = (PRESETS[presetIndex] ?? PRESETS[0]!).deal
  const PAY = (PRESETS[presetIndex] ?? PRESETS[0]!).pay

  const bOk = isAddress(walletB) && !sameAddress(walletB, address)
  const idB = useReadContract({ address: ENV.registry, abi: registryAbi, functionName: 'identityOf', args: [bOk ? (walletB as Address) : zeroAddress], query: { enabled: bOk, refetchInterval: 4000 } })
  const sameIdentity = bOk && id.linked && idB.data === id.identityId

  const minDur = useReadContract({ address: ENV.escrow, abi: escrowAbi, functionName: 'minDuration' })
  const quote = useReadContract({
    address: ENV.escrow,
    abi: escrowAbi,
    functionName: 'quoteFor',
    args: [address ?? zeroAddress, isAddress(merchant) ? (merchant as Address) : zeroAddress, ASSET, DEAL],
    query: { enabled: !!address },
  })
  const bond = quote.data?.[0] ?? DEAL
  const earned = id.linked && bond < DEAL

  const open = mine.find((a) => a.status === STATUS.Open && sameAddress(a.payer, address))
  const defaulted = mine.find((a) => a.status === STATUS.Defaulted && sameAddress(a.payer, address))
  const left = open ? Number(open.deadline) - now : 0

  const preview = useReadContract({ address: ENV.router, abi: routerAbi, functionName: 'previewSplit', args: [bOk ? (walletB as Address) : zeroAddress, ASSET, PAY], query: { enabled: bOk, refetchInterval: 4000 } })
  const garnished = preview.data?.[0] ?? 0n
  const net = preview.data?.[1] ?? 0n

  const merchantOk = isAddress(merchant) && !sameAddress(merchant, address) && !sameAddress(merchant, walletB)
  const seedCmd = `cd contracts && REGISTRY=${ENV.registry} DEMO_IDENTITY_ID=${id.identityId} forge script script/SeedDemo.s.sol --rpc-url ${ENV.rpcUrl} --broadcast`

  return (
    <Section title="Judge sandbox" hint="Run the whole story on this network in three steps. Each step is a real transaction. The deal uses the shortest deadline allowed here.">
      <div className="space-y-8">
        <Notice tone="info">You need about {fmt(DEAL + PAY)} QIE in one wallet: {fmt(DEAL)} for the deal, then {fmt(PAY)} for the payment. Get it from the QIE faucet.</Notice>

        <ol>
        <Step n={1} title="Put two wallets under one QIE identity" done={sameIdentity}>
          <div className="space-y-4">
            {!id.linked ? (
              <QiePassVerificationGate />
            ) : (
              <p className="max-w-prose text-[15px] leading-relaxed">
                Wallet A is bound. Now switch to Wallet B in QIE Wallet and bind it the same way. With Judge sandbox mode on, pick the same demo identity. With real QIE Pass, authorize it from Wallet A on the Identity tab.
              </p>
            )}
            <div className="max-w-md">
            <Field label="Wallet B address" note={sameIdentity ? 'Wallet B belongs to the same identity as Wallet A.' : bOk && idB.data !== undefined ? 'Wallet B isn’t linked to this identity yet.' : 'Paste the second wallet you linked.'}>
              <input className="field" name="wallet-b" autoComplete="off" placeholder="0x…" value={walletB} onChange={(e) => setWalletB(e.target.value.trim())} spellCheck={false} />
            </Field>
            </div>
          </div>
        </Step>

        <Step n={2} title={`Open a ${fmt(DEAL)} QIE deal and let it default`} done={!!defaulted}>
          <div className="space-y-4">
            <div>
              <span className="mb-1.5 block text-sm font-semibold">Deal amount preset</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Deal amount preset">
                {PRESETS.map((p, idx) => (
                  <button
                    key={p.label}
                    type="button"
                    className={`btn min-h-[38px] px-4 py-1.5 ${presetIndex === idx ? 'btn-primary' : 'btn-secondary'}`}
                    disabled={!!open || dealTx.state.busy}
                    onClick={() => setPresetIndex(idx)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-w-md">
            <Field label="Creditor (a third wallet you control)">
              <input className="field" name="sandbox-creditor" autoComplete="off" placeholder="0x…" value={merchant} onChange={(e) => setMerchant(e.target.value.trim())} spellCheck={false} />
            </Field>
            </div>
            {id.linked && !earned && (
              <Notice tone="warn">
                A new identity has to lock the full {fmt(DEAL)} QIE, because credit is earned. For the demo, the deployer can give this identity a history. This is public and is turned off before mainnet:
                <code className="mt-2 block overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-paper-deep p-3 text-[12px] text-ink">{seedCmd}</code>
              </Notice>
            )}
            <dl><Stat label={`Bond to lock, of ${fmt(DEAL)}`} value={`${fmt(bond)} QIE`} /></dl>
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="btn btn-primary"
                disabled={dealTx.state.busy || !id.linked || !merchantOk || !!open}
                onClick={() => dealTx.run('Deal opened. Now wait for the deadline.', () => dealTx.writeContractAsync({ address: ENV.escrow, abi: escrowAbi, functionName: 'createAgreement', args: [merchant as Address, ASSET, DEAL, minDur.data ?? 15n], value: bond }))}
              >
                Open the {fmt(DEAL)} QIE deal
              </button>
              {open && left > 0 ? (
                <button className="btn btn-secondary" disabled>
                  Deadline in {duration(left)}
                </button>
              ) : open && sameAddress(merchant, address) ? (
                <button
                  className="btn btn-secondary"
                  disabled={defTx.state.busy}
                  onClick={() => open && defTx.run('Default claimed. Bond seized and debt recorded.', () => defTx.writeContractAsync({ address: ENV.escrow, abi: escrowAbi, functionName: 'triggerDefault', args: [open.id] }))}
                >
                  Claim default and seize bond
                </button>
              ) : open ? (
                <span className="self-center text-sm text-slate">Past deadline, creditor can claim</span>
              ) : null}
            </div>
            <TxStatus state={dealTx.state} />
            <TxStatus state={defTx.state} />
            {defaulted && <Notice tone="debt">Default recorded. The identity now owes {fmt(bal.debt)} QIE, and the debt follows every linked wallet.</Notice>}
          </div>
        </Step>

        <Step n={3} title={`Pay Wallet B ${fmt(PAY)} QIE and watch it get collected`} done={payTx.state.done !== undefined}>
          <div className="space-y-4">
            {bOk && sameIdentity ? (
              <div className="max-w-2xl rounded-2xl bg-paper-deep p-4"><GarnishmentFlowVisualizer key={`${garnished}-${net}`} gross={PAY} garnished={garnished} net={net} recipient={walletB} creditor={merchant} /></div>
            ) : (
              <Empty>Link Wallet B in step 1 to see how the payment splits.</Empty>
            )}
            <button
              className="btn btn-primary"
              disabled={payTx.state.busy || !bOk || !sameIdentity}
              onClick={() => payTx.run('Payment routed. The debt was collected before Wallet B received anything.', () => payTx.writeContractAsync({ address: ENV.router, abi: routerAbi, functionName: 'routePayment', args: [walletB as Address, ASSET, PAY], value: PAY }))}
            >
              Send {fmt(PAY)} QIE to Wallet B
            </button>
            <TxStatus state={payTx.state} />
          </div>
        </Step>
        </ol>
      </div>
    </Section>
  )
}
