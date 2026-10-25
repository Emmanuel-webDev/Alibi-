import { ENV } from './env'
import type { Address } from 'viem'

export interface DeployedContract {
  name: string
  address: Address
  description: string
}

export const DEPLOYMENT = {
  chainId: ENV.chainId,
  chainName: 'QIE Testnet',
  isTestnet: ENV.chainId === 1983,
  explorerUrl: ENV.explorer,
  rpcUrl: ENV.rpcUrl,
  deployed: true,
  contracts: [
    {
      name: 'AlibiIdentityRegistry',
      address: ENV.registry,
      description: 'Binds wallets to QIE Pass identity, stores credit tiers, stake, and debt queues.',
    },
    {
      name: 'AlibiCreditEscrow',
      address: ENV.escrow,
      description: 'Holds upfront bonds, validates creditor policies, and manages agreement settlements and defaults.',
    },
    {
      name: 'AlibiSlashingRouter',
      address: ENV.router,
      description: 'Routes payments to wallets and intercepts debt recovery (garnishment) via FIFO queue.',
    },
    {
      name: 'AlibiGatedVault',
      address: ENV.vault,
      description: 'Credit-gated vault enforcing tier minimums and garnishing yield or releases.',
    },
    {
      name: 'Eip712AttestationVerifier',
      address: (import.meta.env.VITE_VERIFIER_ADDRESS as Address | undefined) ?? '0xba9dE0CE99D28866CD1c8f18A80326341c8Aa699' as Address,
      description: 'Verifies EIP-712 cryptographic attestations signed by the Alibi relayer.',
    },
  ],
} as const
