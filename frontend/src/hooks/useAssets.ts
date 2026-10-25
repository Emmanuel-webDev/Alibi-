import { useMemo } from 'react'
import { zeroAddress, type Address } from 'viem'
import { useReadContracts } from 'wagmi'
import { ENV } from '../config/env'
import { erc20Abi } from '../lib/erc20'

export interface AssetInfo {
  address: Address
  symbol: string
  decimals: number
  native: boolean
}

export const NATIVE: AssetInfo = { address: zeroAddress, symbol: 'QIE', decimals: 18, native: true }

/** Native QIE, plus an ERC-20 (e.g. QUSDC) when VITE_QUSDC_ADDRESS is set. Symbol and decimals are read from the token itself. */
export function useAssets(): AssetInfo[] {
  const hasToken = ENV.qusdc !== zeroAddress
  const { data } = useReadContracts({
    contracts: [
      { address: ENV.qusdc, abi: erc20Abi, functionName: 'symbol' },
      { address: ENV.qusdc, abi: erc20Abi, functionName: 'decimals' },
    ],
    query: { enabled: hasToken },
  })
  return useMemo(() => {
    if (!hasToken) return [NATIVE]
    const symbol = (data?.[0]?.result as string | undefined) ?? 'TOKEN'
    const decimals = Number(data?.[1]?.result ?? 18)
    return [NATIVE, { address: ENV.qusdc, symbol, decimals, native: false }]
  }, [hasToken, data])
}
