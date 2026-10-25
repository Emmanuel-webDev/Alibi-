import { defineChain } from 'viem'
import { ENV, isTestnet } from './env'

/** QIE chain definition. Testnet is chain 1983; mainnet is selected purely by environment (VITE_CHAIN_ID). */
export const qieChain = defineChain({
  id: ENV.chainId,
  name: isTestnet ? 'QIE Testnet' : 'QIE Mainnet',
  nativeCurrency: { name: 'QIE', symbol: 'QIE', decimals: 18 },
  rpcUrls: { default: { http: [ENV.rpcUrl] } },
  blockExplorers: { default: { name: 'QIE Explorer', url: ENV.explorer } },
  testnet: isTestnet,
})
