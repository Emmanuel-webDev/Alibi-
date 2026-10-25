import { useAccount } from 'wagmi'
import { useBind, type BindState } from '../hooks/useBind'
import { useQiePassIdentity } from '../hooks/useQiePassIdentity'
import { useSandbox } from '../hooks/useSandbox'
import { shortAddr, shortHash } from '../lib/format'
import { Notice } from './ui'

/** QIE Pass verification page. The query parameters are best effort: the page also works without them. */
export function verifyUrl(wallet: string, origin: string) {
  return `https://id.qie.digital/verify?wallet=${wallet}&redirect_uri=${encodeURIComponent(origin)}`
}

const PROGRESS: Record<string, string> = {
  consent: 'Approve the request in QIE Wallet…',
  sign: 'Sign the message in your wallet…',
  attest: 'Checking QIE Pass and preparing the attestation…',
  link: 'Confirm the transaction in your wallet…',
}

function Progress({ state }: { state: BindState }) {
  if (PROGRESS[state.step]) return <p className="text-sm text-slate" role="status" aria-live="polite">{PROGRESS[state.step]}</p>
  if (state.step === 'error') return <Notice tone="bad">{state.error}</Notice>
  if (state.step === 'done') return <Notice tone="good">{state.note ?? 'Wallet bound. You can open agreements now.'}</Notice>
  return null
}

function Status({ tone, children }: { tone: 'good' | 'warn' | 'neutral'; children: React.ReactNode }) {
  const c = { good: 'bg-verdigris-soft text-verdigris', warn: 'bg-amber-soft text-amber', neutral: 'bg-paper-deep text-ink' }[tone]
  const dot = { good: 'bg-verdigris', warn: 'bg-amber', neutral: 'bg-slate' }[tone]
  return (
    <span className={`chip ${c}`}>
      <span aria-hidden className={`h-2 w-2 rounded-full ${dot}`} />
      {children}
    </span>
  )
}

/**
 * Shown whenever the connected wallet is not yet usable. It never asks for an ID: the identity is resolved from the
 * wallet via QIE Pass. Renders nothing when the wallet is already bound.
 */
export function QiePassVerificationGate({ compact = false }: { compact?: boolean }) {
  const { address } = useAccount()
  const { state, pass, error, recheck } = useQiePassIdentity()
  const { state: bindState, bind } = useBind()
  const sandbox = useSandbox()
  const busy = ['sign', 'attest', 'link'].includes(bindState.step)
  const pad = compact ? 'space-y-3' : 'space-y-5'

  if (state === 'linked') return null

  if (state === 'disconnected') {
    return (
      <div className="max-w-prose space-y-2">
        <Status tone="neutral">No wallet connected</Status>
        <p className="text-[15px] leading-relaxed">Connect your QIE Wallet. Alibi looks up your QIE Pass from the wallet itself, so there is nothing to type.</p>
      </div>
    )
  }
  if (state === 'checking') return <p className="text-[15px] text-slate" role="status" aria-live="polite">Checking QIE Pass for {shortAddr(address)}…</p>

  const sandboxPanel = sandbox.on && (
    <div className="max-w-prose space-y-3 rounded-2xl border border-dashed border-ink/40 p-4">
      <p className="text-sm font-semibold">Judge sandbox mode (testnet only)</p>
      <p className="text-[13px] leading-relaxed text-slate">This skips real QIE Pass. It fakes an approved callback and binds this wallet to a demo identity. Pick the same identity on Wallet A and Wallet B so they share debt.</p>
      <div className="flex flex-wrap gap-2">
        {sandbox.presets.map((p) => (
          <button key={p} className="btn btn-secondary" disabled={busy} onClick={() => bind({ sandbox: p })}>
            Simulate QIE Pass callback for {p}
          </button>
        ))}
      </div>
      <Progress state={bindState} />
    </div>
  )

  if (state === 'error') {
    return (
      <div className={pad}>
        <Notice tone="bad">{error}</Notice>
        <button className="btn btn-secondary" onClick={recheck}>Try again</button>
        {sandboxPanel}
      </div>
    )
  }

  if (state === 'pending-join' && pass?.pendingJoin) {
    return (
      <div className={pad}>
        <Status tone="good">Invitation waiting</Status>
        <p className="max-w-prose text-[15px] leading-relaxed">
          Your verified wallet <b className="tabular-nums">{shortAddr(pass.pendingJoin.primary)}</b> invited this wallet to join its QIE identity <span className="tabular-nums text-slate">{shortHash(pass.pendingJoin.identityId)}</span>.
        </p>
        <button className="btn btn-primary" disabled={busy} onClick={() => bind('join')}>Add this wallet to that identity</button>
        <Progress state={bindState} />
      </div>
    )
  }

  if (state === 'verified') {
    return (
      <div className={pad}>
        <div className="flex flex-wrap items-center gap-2 text-[15px]">
          <Status tone="good">QIE Pass verified</Status>
          <span className="text-slate">for {shortAddr(address)}</span>
        </div>
        <p className="max-w-prose text-[14px] leading-relaxed text-slate">
          {pass?.anchor === 'wallet'
            ? `Identity ${shortHash(pass.identityId ?? undefined)}. This is read-only and comes from your verified wallet.`
            : 'To bind, approve sharing your QIE identity in QIE Wallet, then sign one message. Alibi stores a hash of your QIE ID and no personal data.'}
        </p>
        <button className="btn btn-primary" disabled={busy} onClick={() => bind('self', { anchor: pass?.anchor })}>Bind this wallet to my QIE identity</button>
        <Progress state={bindState} />
        {sandboxPanel}
      </div>
    )
  }

  // unverified
  return (
    <div className={pad}>
      <Status tone="warn">Not verified</Status>
      <p className="max-w-prose text-[15px] leading-relaxed">
        No verified QIE Pass found for wallet <b className="break-all tabular-nums">{address}</b>. You need an active QIE Pass on this wallet before you can bind it or open agreements.
      </p>
      <div className="flex flex-wrap gap-3">
        <a className="btn btn-primary" href={verifyUrl(address ?? '', window.location.origin)} target="_blank" rel="noreferrer">
          Verify with QIE Pass
        </a>
        <button className="btn btn-secondary" onClick={recheck}>Re-check verification status</button>
      </div>
      <p className="text-[13px] text-slate">This page checks again every 10 seconds and updates once QIE Pass approves you.</p>
      <div className="max-w-prose rounded-2xl bg-paper-deep p-4 text-[14px] leading-relaxed">
        <p className="font-semibold">Already verified on another wallet?</p>
        <p className="mt-1 text-slate">
          QIE Pass verifies one address, so a second account in your wallet doesn’t count as verified. Open Alibi with your verified wallet, go to Identity, then Add another wallet, and authorize <b className="tabular-nums text-ink">{shortAddr(address)}</b>. When you come back to this wallet, an Add button will be waiting.
        </p>
      </div>
      {sandboxPanel}
    </div>
  )
}
