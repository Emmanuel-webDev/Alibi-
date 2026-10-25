import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { zeroAddress, type Address, type Hex } from 'viem'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { erc20Abi } from '../lib/erc20'
import { friendlyError } from '../lib/errors'

export interface TxState {
  busy: boolean
  error?: string
  hash?: Hex
  done?: string
}

/** Runs a wallet transaction, waits for the receipt, refreshes every on-chain read, and turns reverts into plain language. */
export function useTx() {
  const client = usePublicClient()
  const qc = useQueryClient()
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const [state, setState] = useState<TxState>({ busy: false })

  const run = useCallback(
    async (doneMessage: string, send: () => Promise<Hex>): Promise<boolean> => {
      setState({ busy: true })
      try {
        const hash = await send()
        setState({ busy: true, hash })
        const receipt = await client!.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') throw new Error('The transaction was mined but reverted.')
        await qc.invalidateQueries()
        setState({ busy: false, hash, done: doneMessage })
        return true
      } catch (e) {
        setState({ busy: false, error: friendlyError(e) })
        return false
      }
    },
    [client, qc],
  )

  /** Approve `spender` for at least `amount` of an ERC-20 (no-op for native QIE). */
  const ensureAllowance = useCallback(
    async (token: Address, spender: Address, amount: bigint) => {
      if (token === zeroAddress || !address || amount === 0n) return
      const current = await client!.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [address, spender] })
      if (current >= amount) return
      const hash = await writeContractAsync({ address: token, abi: erc20Abi, functionName: 'approve', args: [spender, amount] })
      await client!.waitForTransactionReceipt({ hash })
    },
    [address, client, writeContractAsync],
  )

  const reset = useCallback(() => setState({ busy: false }), [])
  return { state, run, reset, ensureAllowance, writeContractAsync }
}
