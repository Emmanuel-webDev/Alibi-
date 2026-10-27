import { defineChain } from 'viem'
import { ENV, isTestnet } from './env'

/** QIE chain definition. Configuration is loaded dynamically from environment (VITE_CHAIN_ID, etc.). */
export const qieChain = defineChain({
  id: ENV.chainId,
  name: ENV.chainName,
  nativeCurrency: { name: ENV.symbol, symbol: ENV.symbol, decimals: ENV.decimals },
  rpcUrls: { default: { http: [ENV.rpcUrl] } },
  blockExplorers: { default: { name: 'QIE Explorer', url: ENV.explorer } },
  testnet: isTestnet,
})
