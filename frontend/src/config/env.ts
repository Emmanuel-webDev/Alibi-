import { isAddress, zeroAddress, type Address } from 'viem'

const raw = import.meta.env

function addr(name: string): Address {
  const v = (raw[name] as string | undefined)?.trim()
  return v && isAddress(v) ? (v as Address) : zeroAddress
}

export const ENV = {
  chainId: Number(raw.VITE_CHAIN_ID ?? 1983),
  rpcUrl: (raw.VITE_RPC_URL as string | undefined) ?? 'https://rpc2testnet.qie.digital/',
  explorer: (raw.VITE_EXPLORER_URL as string | undefined) ?? 'https://testnet.qie.digital',
  apiUrl: ((raw.VITE_API_URL as string | undefined) ?? 'http://localhost:8787').replace(/\/$/, ''),
  registry: addr('VITE_REGISTRY_ADDRESS'),
  escrow: addr('VITE_ESCROW_ADDRESS'),
  router: addr('VITE_ROUTER_ADDRESS'),
  vault: addr('VITE_VAULT_ADDRESS'),
  qusdc: addr('VITE_QUSDC_ADDRESS'),
  demoMerchant: ((raw.VITE_DEMO_MERCHANT as string | undefined) ?? '').trim(),
} as const

export const QIE_TESTNET_ID = 1983
export const isTestnet = ENV.chainId === QIE_TESTNET_ID
export const contractsConfigured = ENV.registry !== zeroAddress && ENV.escrow !== zeroAddress && ENV.router !== zeroAddress
