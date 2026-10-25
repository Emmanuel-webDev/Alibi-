import { useState } from 'react'
import { isAddress, parseUnits, zeroAddress, type Address } from 'viem'
import { useReadContract } from 'wagmi'
import { routerAbi } from '../abi'
import { ENV } from '../config/env'
import type { AssetInfo } from '../hooks/useAssets'
import { useGarnishmentEvents } from '../hooks/useGarnishmentEvents'
import { useTx } from '../hooks/useTx'
import { fmt, shortAddr, shortHash, explorerTx } from '../lib/format'
import { GarnishmentFlowVisualizer } from './GarnishmentFlowVisualizer'
import { AssetPicker, Empty, Field, Notice, Section, TxStatus } from './ui'

export function SlashingRouterWidget({ assets, asset, setAsset }: { assets: AssetInfo[]; asset: AssetInfo; setAsset: (a: AssetInfo) => void }) {
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const { state, run, ensureAllowance, writeContractAsync } = useTx()
  const { items, relayerDown } = useGarnishmentEvents(8)

  let gross = 0n
  try {
    gross = amount ? parseUnits(amount, asset.decimals) : 0n
  } catch {
    gross = 0n
  }
  const ok = isAddress(recipient)
  const preview = useReadContract({
    address: ENV.router,
    abi: routerAbi,
    functionName: 'previewSplit',
    args: [ok ? (recipient as Address) : zeroAddress, asset.address, gross],
    query: { enabled: ok && gross > 0n, refetchInterval: 5000 },
  })
  const garnished = preview.data?.[0] ?? 0n
  const net = preview.data?.[1] ?? 0n

  return (
    <>
      <Section title="Pay through Alibi" hint="If the person you pay owes money, the router takes the debt out of this payment and sends them the rest.">
        <div className="space-y-5">
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <Field label="Recipient wallet">
              <input className="field" name="recipient" autoComplete="off" placeholder="0x…" value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} spellCheck={false} />
            </Field>
            <Field label={`Amount (${asset.symbol})`}>
              <input className="field" name="amount" autoComplete="off" inputMode="decimal" placeholder="1000" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <AssetPicker assets={assets} value={asset} onChange={setAsset} />
          </div>

          {ok && gross > 0n && preview.data && (
            <div className="max-w-2xl space-y-3 rounded-2xl bg-paper-deep p-4">
              <GarnishmentFlowVisualizer key={`${garnished}-${net}`} gross={gross} garnished={garnished} net={net} decimals={asset.decimals} symbol={asset.symbol} recipient={recipient} />
              {garnished === 0n ? <Notice tone="good">This recipient owes nothing, so the full amount arrives.</Notice> : <Notice tone="debt">This recipient’s identity owes money. {fmt(garnished, asset.decimals)} {asset.symbol} goes to its creditors first.</Notice>}
            </div>
          )}
          <button
            className="btn btn-primary"
            disabled={state.busy || !ok || gross === 0n}
            onClick={() =>
              run('Payment sent.', async () => {
                await ensureAllowance(asset.address, ENV.router, gross)
                return writeContractAsync({ address: ENV.router, abi: routerAbi, functionName: 'routePayment', args: [recipient as Address, asset.address, gross], value: asset.native ? gross : 0n })
              })
            }
          >
            Send {gross > 0n ? `${fmt(gross, asset.decimals)} ${asset.symbol}` : 'payment'}
          </button>
          {recipient && !ok && <p role="alert" className="text-[13px] font-medium text-amber">That isn’t a valid address.</p>}
          <TxStatus state={state} />
        </div>
      </Section>
      <Section title="Recent payments" hint="Read from the router contract.">
        {items.length === 0 ? (
          <Empty>{relayerDown ? 'Can’t load past payments because the relayer is down. New payments will still show up here as they happen.' : 'No payments yet. Payments sent through Alibi will show up here.'}</Empty>
        ) : (
          <ul className="divide-y divide-rule">
            {items.map((i) => {
              const a = assets.find((x) => x.address.toLowerCase() === (i.asset ?? zeroAddress).toLowerCase()) ?? assets[0]!
              return (
                <li key={i.key} className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-[15px]">
                  {i.kind === 'garnished' ? (
                    <span className="min-w-0 break-words"><b className="text-oxblood">{fmt(i.amount, a.decimals)} {a.symbol}</b> collected for {shortAddr(i.creditor)} from a wallet of identity {shortHash(i.identityId)}</span>
                  ) : (
                    <span className="min-w-0 break-words">{fmt(i.gross, a.decimals)} {a.symbol} to {shortAddr(i.recipient)}: <b className="text-verdigris">{fmt(i.net, a.decimals)}</b> received, <b className="text-oxblood">{fmt(i.garnished, a.decimals)}</b> garnished</span>
                  )}
                  <a className="text-sm text-slate underline underline-offset-2" href={explorerTx(ENV.explorer, i.txHash)} target="_blank" rel="noreferrer">View transaction</a>
                </li>
              )
            })}
          </ul>
        )}
      </Section>
    </>
  )
}
