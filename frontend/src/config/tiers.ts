import { useReadContract } from 'wagmi'
import { registryAbi } from '../abi'
import { ENV, contractsConfigured } from './env'
import { bpsToPercent, duration, fmt } from '../lib/format'

/**
 * Real tier configuration defaults from Alibi contracts:
 *
 * Source: contracts/src/AlibiIdentityRegistry.sol (constructor lines 152-162):
 * - baseMinDeals: 3
 * - baseMinCounterparties: 2
 * - baseMinAge: 7 days (604,800 seconds)
 * - provenMinDeals: 10
 * - provenMinCounterparties: 4
 * - provenMinAge: 30 days (2,592,000 seconds)
 * - newFloorBps: 1000 (10%)
 * - baseFloorBps: 2500 (25%)
 * - provenFloorBps: 1000 (10%)
 *
 * Source: contracts/script/Deploy.s.sol (lines 69-70 & 85-86):
 * - baseCap: 50 ether (50 QIE)
 * - provenCap: 200 ether (200 QIE)
 * - newCap: 0 (mapping default, only stake backs credit)
 * - unverifiedCap: 0 (mapping default)
 *
 * Source: contracts/src/AlibiIdentityRegistry.sol floorBps():
 * - Unverified returns BPS (10,000 = 100%)
 */

export interface TierRowData {
  tier: 'Unverified' | 'New' | 'Base' | 'Proven'
  minDeals: number | string
  minCounterparties: number | string
  minAge: string
  bondFloor: string
  unsecuredCap: string
  sourceNote?: string
}

export const REAL_TIER_CONFIG = {
  unverified: {
    minDeals: 0,
    minCounterparties: 0,
    minAgeSeconds: 0,
    floorBps: 10_000,
    capWei: 0n,
  },
  new: {
    minDeals: 0,
    minCounterparties: 0,
    minAgeSeconds: 0,
    floorBps: 1_000,
    capWei: 0n,
  },
  base: {
    minDeals: 3,
    minCounterparties: 2,
    minAgeSeconds: 7 * 86_400, // 7 days
    floorBps: 2_500,
    capWei: 50n * 10n ** 18n, // 50 QIE
  },
  proven: {
    minDeals: 10,
    minCounterparties: 4,
    minAgeSeconds: 30 * 86_400, // 30 days
    floorBps: 1_000,
    capWei: 200n * 10n ** 18n, // 200 QIE
  },
} as const

export function getStaticTierRows(): TierRowData[] {
  return [
    {
      tier: 'Unverified',
      minDeals: 0,
      minCounterparties: 0,
      minAge: '—',
      bondFloor: bpsToPercent(REAL_TIER_CONFIG.unverified.floorBps), // 100%
      unsecuredCap: `${fmt(REAL_TIER_CONFIG.unverified.capWei)} QIE`, // 0 QIE
      sourceNote: 'Default floorBps(Tier.Unverified) = 10,000 bps',
    },
    {
      tier: 'New',
      minDeals: 0,
      minCounterparties: 0,
      minAge: '—',
      bondFloor: bpsToPercent(REAL_TIER_CONFIG.new.floorBps), // 10%
      unsecuredCap: `${fmt(REAL_TIER_CONFIG.new.capWei)} QIE`, // 0 QIE
      sourceNote: 'tierConfig.newFloorBps = 1,000 bps; stake backs credit',
    },
    {
      tier: 'Base',
      minDeals: REAL_TIER_CONFIG.base.minDeals, // 3
      minCounterparties: REAL_TIER_CONFIG.base.minCounterparties, // 2
      minAge: duration(REAL_TIER_CONFIG.base.minAgeSeconds), // 7d 0h / 7 days
      bondFloor: bpsToPercent(REAL_TIER_CONFIG.base.floorBps), // 25%
      unsecuredCap: `${fmt(REAL_TIER_CONFIG.base.capWei)} QIE`, // 50 QIE
      sourceNote: 'tierConfig.base* + Deploy.s.sol baseCap = 50 QIE',
    },
    {
      tier: 'Proven',
      minDeals: REAL_TIER_CONFIG.proven.minDeals, // 10
      minCounterparties: REAL_TIER_CONFIG.proven.minCounterparties, // 4
      minAge: duration(REAL_TIER_CONFIG.proven.minAgeSeconds), // 30d 0h / 30 days
      bondFloor: bpsToPercent(REAL_TIER_CONFIG.proven.floorBps), // 10%
      unsecuredCap: `${fmt(REAL_TIER_CONFIG.proven.capWei)} QIE`, // 200 QIE
      sourceNote: 'tierConfig.proven* + Deploy.s.sol provenCap = 200 QIE',
    },
  ]
}

/** Reads tierConfig and unsecured caps live from the registry contract if available */
export function useLiveTierRows(): { rows: TierRowData[]; isLive: boolean } {
  const liveTierConfig = useReadContract({
    address: ENV.registry,
    abi: registryAbi,
    functionName: 'tierConfig',
    query: { enabled: contractsConfigured, refetchInterval: 30_000 },
  })

  const liveBaseCap = useReadContract({
    address: ENV.registry,
    abi: registryAbi,
    functionName: 'unsecuredCap',
    args: ['0x0000000000000000000000000000000000000000', 2], // Tier.Base = 2
    query: { enabled: contractsConfigured, refetchInterval: 30_000 },
  })

  const liveProvenCap = useReadContract({
    address: ENV.registry,
    abi: registryAbi,
    functionName: 'unsecuredCap',
    args: ['0x0000000000000000000000000000000000000000', 3], // Tier.Proven = 3
    query: { enabled: contractsConfigured, refetchInterval: 30_000 },
  })

  if (!liveTierConfig.data) {
    return { rows: getStaticTierRows(), isLive: false }
  }

  const [
    baseMinDeals,
    baseMinCounterparties,
    baseMinAge,
    provenMinDeals,
    provenMinCounterparties,
    provenMinAge,
    newFloorBps,
    baseFloorBps,
    provenFloorBps,
  ] = liveTierConfig.data

  const baseCap = (liveBaseCap.data as bigint | undefined) ?? REAL_TIER_CONFIG.base.capWei
  const provenCap = (liveProvenCap.data as bigint | undefined) ?? REAL_TIER_CONFIG.proven.capWei

  return {
    isLive: true,
    rows: [
      {
        tier: 'Unverified',
        minDeals: 0,
        minCounterparties: 0,
        minAge: '—',
        bondFloor: '100%',
        unsecuredCap: '0 QIE',
      },
      {
        tier: 'New',
        minDeals: 0,
        minCounterparties: 0,
        minAge: '—',
        bondFloor: bpsToPercent(newFloorBps),
        unsecuredCap: '0 QIE',
      },
      {
        tier: 'Base',
        minDeals: Number(baseMinDeals),
        minCounterparties: Number(baseMinCounterparties),
        minAge: duration(Number(baseMinAge)),
        bondFloor: bpsToPercent(baseFloorBps),
        unsecuredCap: `${fmt(baseCap)} QIE`,
      },
      {
        tier: 'Proven',
        minDeals: Number(provenMinDeals),
        minCounterparties: Number(provenMinCounterparties),
        minAge: duration(Number(provenMinAge)),
        bondFloor: bpsToPercent(provenFloorBps),
        unsecuredCap: `${fmt(provenCap)} QIE`,
      },
    ],
  }
}
