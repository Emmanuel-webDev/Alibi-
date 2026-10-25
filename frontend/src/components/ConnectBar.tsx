import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi'
import { ENV } from '../config/env'
import { shortAddr } from '../lib/format'

export function ConnectBar() {
  const { address, chainId, isConnected } = useAccount()
  const { connect, connectors, isPending, error } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain, isPending: switching } = useSwitchChain()

  if (!isConnected) {
    const c = connectors[0]
    return (
      <div className="flex flex-col items-end gap-1">
        <button className="btn btn-primary" disabled={!c || isPending} onClick={() => c && connect({ connector: c })}>
          {isPending ? 'Check your wallet…' : 'Connect QIE Wallet'}
        </button>
        {!c && <span className="text-[13px] text-slate">No wallet found. Install QIE Wallet first.</span>}
        {error && <span role="alert" className="max-w-[22rem] break-words text-right text-[13px] text-amber">{error.message}</span>}
      </div>
    )
  }

  const wrong = chainId !== ENV.chainId
  return (
    <div className="flex items-center gap-1 rounded-full border border-rule bg-paper p-1 text-ink">
      {wrong ? (
        <button className="btn btn-secondary min-h-[36px] py-1.5" disabled={switching} onClick={() => switchChain({ chainId: ENV.chainId })}>
          Switch to QIE
        </button>
      ) : (
        <span className="hidden items-center gap-2 pl-3 pr-1 text-sm text-slate sm:inline-flex">
          <span aria-hidden className="h-2 w-2 rounded-full bg-verdigris" />
          QIE
        </span>
      )}
      <span className="rounded-full bg-paper-deep px-3 py-1.5 text-sm font-semibold tabular-nums text-ink" title={address}>
        {shortAddr(address)}
      </span>
      <button className="btn-quiet no-underline hover:underline text-ink" onClick={() => disconnect()}>
        Disconnect
      </button>
    </div>
  )
}
