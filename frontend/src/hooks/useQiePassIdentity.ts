import { useQuery } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { contractsConfigured } from '../config/env'
import { api, type PassStatus } from '../lib/api'
import { useAlibiIdentity, type IdentitySnapshot } from './useAlibiIdentity'

export type PassState =
  | 'disconnected' // A: no wallet
  | 'checking' // asking the registry and QIE Pass
  | 'unverified' // B: QIE Pass does not show a verified person for this wallet
  | 'verified' // C: verified, not yet bound on chain: one click to bind
  | 'pending-join' // a verified primary wallet authorized this wallet to join its identity
  | 'linked' // bound on chain: the protocol can be used
  | 'error' // QIE Pass or the relayer could not be reached

export interface QiePassIdentity {
  state: PassState
  identity: IdentitySnapshot
  pass?: PassStatus
  error?: string
  recheck: () => void
}

/**
 * Resolves everything about the connected wallet with no typing:
 *   1. the registry says whether it is already bound (identityOf)
 *   2. if not, the relayer asks QIE Pass whether the wallet's owner is verified (silent, no notification)
 * Re-checks every 10 seconds while unverified, so finishing verification elsewhere is picked up automatically.
 */
export function useQiePassIdentity(): QiePassIdentity {
  const { address, isConnected } = useAccount()
  const identity = useAlibiIdentity()
  const q = useQuery({
    queryKey: ['pass-status', address],
    queryFn: () => api.passStatus(address!),
    enabled: !!address && contractsConfigured,
    refetchInterval: (query) => (identity.linked || query.state.data?.isVerified ? 30_000 : 10_000),
    retry: false,
  })

  const base = { identity, pass: q.data, recheck: () => void q.refetch() }
  if (!isConnected || !address) return { ...base, state: 'disconnected' }
  if (identity.loading) return { ...base, state: 'checking' }
  if (identity.linked) return { ...base, state: 'linked' }
  if (q.isLoading) return { ...base, state: 'checking' }
  if (q.isError) return { ...base, state: 'error', error: q.error instanceof Error ? q.error.message : 'Could not reach QIE Pass.' }
  if (q.data?.pendingJoin) return { ...base, state: 'pending-join' }
  if (q.data?.isVerified) return { ...base, state: 'verified' }
  return { ...base, state: 'unverified' }
}
