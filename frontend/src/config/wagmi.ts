import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { qieChain } from './qieChain'
import { ENV } from './env'

/**
 * QIE Wallet injects a standard EIP-1193 provider, so the generic injected connector (plus EIP-6963 discovery,
 * which wagmi enables by default) is all that is needed. No WalletConnect project id required.
 */
export const wagmiConfig = createConfig({
  chains: [qieChain],
  connectors: [injected()],
  transports: { [qieChain.id]: http(ENV.rpcUrl) },
  pollingInterval: 2_000,
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
