import { useMemo } from 'react'
import { zeroAddress, type Address, type Hex } from 'viem'
import { useAccount, useReadContract, useReadContracts } from 'wagmi'
import { ENV, contractsConfigured } from '../config/env'
import { registryAbi } from '../abi'

export const TIER_NAMES = ['Unverified', 'New', 'Base', 'Proven'] as const
export const ZERO_ID = ('0x' + '00'.repeat(32)) as Hex

export interface IdentitySnapshot {
  wallet?: Address
  linked: boolean
  identityId: Hex
  tier: number
  tierName: string
  activeDebt: boolean
  openClaims: bigint
  floorBps: number
  walletCount: number
  settledDeals: number
  uniqueCounterparties: number
  defaultCount: number
  firstLinkedAt: bigint
  loading: boolean
}

/** Reads everything the passport card needs for the connected wallet, straight from the registry. */
export function useAlibiIdentity(wallet?: Address): IdentitySnapshot {
  const { address: connected } = useAccount()
  const w = wallet ?? connected
  const enabled = !!w && contractsConfigured
  const refetchInterval = 5000

  const solv = useReadContract({ address: ENV.registry, abi: registryAbi, functionName: 'getWalletSolvency', args: [w ?? zeroAddress], query: { enabled, refetchInterval } })
  const identityId = (solv.data?.[0] ?? ZERO_ID) as Hex
  const linked = identityId !== ZERO_ID

  const ident = useReadContract({ address: ENV.registry, abi: registryAbi, functionName: 'getIdentity', args: [identityId], query: { enabled: enabled && linked, refetchInterval } })

  return useMemo<IdentitySnapshot>(() => {
    const tier = Number(solv.data?.[3] ?? 0)
    const i = ident.data
    return {
      wallet: w,
      linked,
      identityId,
      tier,
      tierName: TIER_NAMES[tier] ?? 'Unverified',
      activeDebt: Boolean(solv.data?.[1]),
      openClaims: solv.data?.[2] ?? 0n,
      floorBps: Number(solv.data?.[4] ?? 10000),
      walletCount: Number(i?.walletCount ?? 0),
      settledDeals: Number(i?.settledDeals ?? 0),
      uniqueCounterparties: Number(i?.uniqueCounterparties ?? 0),
      defaultCount: Number(i?.defaultCount ?? 0),
      firstLinkedAt: i?.firstLinkedAt ?? 0n,
      loading: solv.isLoading,
    }
  }, [solv.data, solv.isLoading, ident.data, identityId, linked, w])
}

/** Stake, exposure, debt and remaining unsecured capacity for one identity and asset. */
export function useIdentityBalances(identityId: Hex, asset: Address) {
  const enabled = identityId !== ZERO_ID && contractsConfigured
  const { data } = useReadContracts({
    contracts: [
      { address: ENV.registry, abi: registryAbi, functionName: 'stakeOf', args: [identityId, asset] },
      { address: ENV.registry, abi: registryAbi, functionName: 'exposure', args: [identityId, asset] },
      { address: ENV.registry, abi: registryAbi, functionName: 'debtOutstanding', args: [identityId, asset] },
      { address: ENV.registry, abi: registryAbi, functionName: 'freeCapacity', args: [identityId, asset] },
    ],
    query: { enabled, refetchInterval: 5000 },
  })
  return {
    stake: (data?.[0]?.result as bigint | undefined) ?? 0n,
    exposure: (data?.[1]?.result as bigint | undefined) ?? 0n,
    debt: (data?.[2]?.result as bigint | undefined) ?? 0n,
    freeCapacity: (data?.[3]?.result as bigint | undefined) ?? 0n,
  }
}
