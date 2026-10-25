import { useMemo } from 'react'
import type { Address, Hex } from 'viem'
import { useReadContract, useReadContracts } from 'wagmi'
import { escrowAbi } from '../abi'
import { ENV, contractsConfigured } from '../config/env'
import { sameAddress } from '../lib/format'

export const STATUS = { None: 0, Open: 1, Settled: 2, Defaulted: 3 } as const
export const STATUS_LABEL: Record<number, string> = { 1: 'Open', 2: 'Settled', 3: 'Defaulted' }

export interface Agreement {
  id: bigint
  payer: Address
  creditor: Address
  asset: Address
  payerIdentity: Hex
  total: bigint
  bond: bigint
  createdAt: bigint
  deadline: bigint
  status: number
}

const WINDOW = 40

/** The most recent agreements involving `me`, read straight from the escrow contract (no indexer needed). */
export function useAgreements(me?: Address) {
  const next = useReadContract({ address: ENV.escrow, abi: escrowAbi, functionName: 'nextAgreementId', query: { enabled: contractsConfigured, refetchInterval: 5000 } })
  const last = Number(next.data ?? 1n) - 1 // ids start at 1

  const ids = useMemo(() => {
    const out: bigint[] = []
    for (let i = Math.max(1, last - WINDOW + 1); i <= last; i++) out.push(BigInt(i))
    return out.reverse()
  }, [last])

  const reads = useReadContracts({
    contracts: ids.map((id) => ({ address: ENV.escrow, abi: escrowAbi, functionName: 'getAgreement', args: [id] }) as const),
    query: { enabled: ids.length > 0, refetchInterval: 5000 },
  })

  const agreements = useMemo<Agreement[]>(() => {
    const out: Agreement[] = []
    ids.forEach((id, i) => {
      const r = reads.data?.[i]?.result as Omit<Agreement, 'id'> | undefined
      if (r && r.status !== STATUS.None) out.push({ id, ...r })
    })
    return out
  }, [ids, reads.data])

  const mine = useMemo(() => agreements.filter((a) => sameAddress(a.payer, me) || sameAddress(a.creditor, me)), [agreements, me])
  return { agreements, mine, loading: next.isLoading || reads.isLoading }
}
