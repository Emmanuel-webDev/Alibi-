import { useEffect, useMemo, useState } from 'react'
import type { Address, Hex } from 'viem'
import { useWatchContractEvent } from 'wagmi'
import { routerAbi } from '../abi'
import { ENV, contractsConfigured } from '../config/env'
import { api } from '../lib/api'

export interface FeedItem {
  key: string
  kind: 'garnished' | 'routed'
  txHash: Hex
  blockNumber: bigint
  identityId?: Hex
  recipient?: Address
  creditor?: Address
  payer?: Address
  gross?: bigint
  garnished?: bigint
  net?: bigint
  amount?: bigint
  asset?: Address
}

const big = (v: unknown) => (v === undefined || v === null ? undefined : BigInt(v as string | number | bigint))

/** Live garnishment feed: history from the relayer's indexer (if reachable), plus router events as they happen. */
export function useGarnishmentEvents(limit = 20) {
  const [history, setHistory] = useState<FeedItem[]>([])
  const [live, setLive] = useState<FeedItem[]>([])
  const [relayerDown, setRelayerDown] = useState(false)

  useEffect(() => {
    if (!contractsConfigured) return
    let cancelled = false
    api
      .events('router', 60)
      .then(({ events }) => {
        if (cancelled) return
        setRelayerDown(false)
        setHistory(
          events.map((e): FeedItem => {
            const a = e.args as Record<string, string>
            return e.event === 'CrossWalletGarnishmentExecuted'
              ? { key: `${e.txHash}:${e.logIndex}`, kind: 'garnished', txHash: e.txHash, blockNumber: BigInt(e.blockNumber), identityId: a.identityId as Hex, recipient: a.recipientWallet as Address, creditor: a.creditor as Address, amount: big(a.amount), asset: a.asset as Address }
              : { key: `${e.txHash}:${e.logIndex}`, kind: 'routed', txHash: e.txHash, blockNumber: BigInt(e.blockNumber), payer: a.payer as Address, recipient: a.recipient as Address, identityId: a.identityId as Hex, gross: big(a.gross), garnished: big(a.garnished), net: big(a.net), asset: a.asset as Address }
          }),
        )
      })
      .catch(() => !cancelled && setRelayerDown(true))
    return () => {
      cancelled = true
    }
  }, [])

  useWatchContractEvent({
    address: ENV.router,
    abi: routerAbi,
    enabled: contractsConfigured,
    onLogs: (logs) => {
      const items: FeedItem[] = []
      for (const l of logs) {
        const base = { key: `${l.transactionHash}:${l.logIndex}`, txHash: l.transactionHash as Hex, blockNumber: l.blockNumber ?? 0n }
        if (l.eventName === 'CrossWalletGarnishmentExecuted') {
          const a = l.args
          items.push({ ...base, kind: 'garnished', identityId: a.identityId, recipient: a.recipientWallet, creditor: a.creditor, amount: a.amount, asset: a.asset })
        } else if (l.eventName === 'PaymentRouted') {
          const a = l.args
          items.push({ ...base, kind: 'routed', payer: a.payer, recipient: a.recipient, identityId: a.identityId, gross: a.gross, garnished: a.garnished, net: a.net, asset: a.asset })
        }
      }
      if (items.length) setLive((prev) => [...items, ...prev])
    },
  })

  const items = useMemo(() => {
    const seen = new Set<string>()
    return [...live, ...history]
      .filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)))
      .sort((a, b) => Number(b.blockNumber - a.blockNumber))
      .slice(0, limit)
  }, [live, history, limit])

  return { items, relayerDown }
}
