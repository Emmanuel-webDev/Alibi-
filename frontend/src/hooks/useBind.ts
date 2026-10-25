import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import type { Address } from 'viem'
import { useAccount, usePublicClient, useSignMessage, useWriteContract } from 'wagmi'
import { registryAbi } from '../abi'
import { ENV } from '../config/env'
import { api, type AttestResponse } from '../lib/api'
import { friendlyError } from '../lib/errors'

export type BindStep = 'idle' | 'consent' | 'sign' | 'attest' | 'link' | 'done' | 'error'
export interface BindState {
  step: BindStep
  error?: string
  note?: string
}

/**
 * One-click binding. Nothing is typed: the identity comes from the relayer's attestation, which exists only after
 * (1) QIE Pass says the wallet's owner is verified and (2) this wallet signed a single-use challenge.
 *   self     -> bind this verified wallet as the primary of its own identity
 *   join     -> bind this wallet to the identity of a verified primary wallet that authorized it
 *   sandbox  -> testnet demo identity (only if the relayer has the sandbox enabled)
 */
export function useBind() {
  const { address } = useAccount()
  const client = usePublicClient()
  const qc = useQueryClient()
  const { signMessageAsync } = useSignMessage()
  const { writeContractAsync } = useWriteContract()
  const [state, setState] = useState<BindState>({ step: 'idle' })

  const linkOnChain = useCallback(
    async (att: AttestResponse) => {
      setState({ step: 'link' })
      const a = att.attestation
      const hash = await writeContractAsync({
        address: ENV.registry,
        abi: registryAbi,
        functionName: 'linkWallet',
        args: [{ wallet: a.wallet, identityId: a.identityId, kycVerified: a.kycVerified, issuedAt: BigInt(a.issuedAt), expiresAt: BigInt(a.expiresAt), nonce: BigInt(a.nonce) }, att.signature],
      })
      const receipt = await client!.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('Linking reverted on chain.')
      await qc.invalidateQueries()
    },
    [client, qc, writeContractAsync],
  )

  /** DID anchor: ask QIE Pass to prompt the user, then poll until they approve in QIE Wallet. Returns the request to attest with. */
  const awaitConsent = useCallback(async (wallet: Address): Promise<string> => {
    setState({ step: 'consent' })
    const { requestId, status: initialStatus } = await api.bindStart(wallet)
    if (initialStatus === 'ready') return requestId
    const started = Date.now()
    for (;;) {
      if (Date.now() - started > 5 * 60_000) throw new Error('No approval received in QIE Wallet within five minutes. Try again.')
      await new Promise((r) => setTimeout(r, 3000))
      const { status } = await api.bindStatus(wallet, requestId)
      if (status === 'ready') return requestId
      if (status === 'consent_rejected') throw new Error('You declined the request in QIE Wallet.')
      if (status === 'expired') throw new Error('The request in QIE Wallet expired. Try again.')
    }
  }, [])

  const bind = useCallback(
    async (kind: 'self' | 'join' | { sandbox: string }, opts: { anchor?: 'did' | 'wallet' } = {}) => {
      if (!address) return
      try {
        const requestId = kind === 'self' && opts.anchor === 'did' ? await awaitConsent(address) : undefined
        setState({ step: 'sign' })
        const purpose = kind === 'self' ? 'self' : kind === 'join' ? 'join' : 'sandbox'
        const target = typeof kind === 'object' ? kind.sandbox : undefined
        const challenge = await api.challenge(address, purpose, target)
        const signature = await signMessageAsync({ message: challenge.message })
        setState({ step: 'attest' })
        const att = typeof kind === 'object' ? await api.sandboxAttest({ wallet: address, preset: kind.sandbox, signature }) : await api.attest({ wallet: address, signature, requestId })
        await linkOnChain(att)
        setState({ step: 'done' })
      } catch (e) {
        setState({ step: 'error', error: friendlyError(e) })
      }
    },
    [address, awaitConsent, linkOnChain, signMessageAsync],
  )

  /** From a verified, linked primary wallet: let another wallet you control join this identity. */
  const authorize = useCallback(
    async (target: Address) => {
      if (!address) return
      try {
        setState({ step: 'sign' })
        const challenge = await api.challenge(address, 'authorize', target)
        const signature = await signMessageAsync({ message: challenge.message })
        setState({ step: 'attest' })
        await api.authorize({ primary: address, wallet: target, signature })
        await qc.invalidateQueries()
        setState({ step: 'done', note: 'Authorized. Switch to that wallet in QIE Wallet and open this page to finish.' })
      } catch (e) {
        setState({ step: 'error', error: friendlyError(e) })
      }
    },
    [address, qc, signMessageAsync],
  )

  const reset = useCallback(() => setState({ step: 'idle' }), [])
  return { state, bind, authorize, reset }
}
