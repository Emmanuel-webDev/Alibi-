import { privateKeyToAccount } from 'viem/accounts'
import type { Address, Hex, PublicClient } from 'viem'
import { registryAbi } from './abi.js'

export const ATTESTATION_TYPES = {
  Attestation: [
    { name: 'wallet', type: 'address' },
    { name: 'identityId', type: 'bytes32' },
    { name: 'kycVerified', type: 'bool' },
    { name: 'issuedAt', type: 'uint64' },
    { name: 'expiresAt', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const

export interface AttestationMessage {
  wallet: Address
  identityId: Hex
  kycVerified: boolean
  issuedAt: bigint
  expiresAt: bigint
  nonce: bigint
}

export interface SignedAttestation {
  /** JSON-safe: bigints are decimal strings */
  attestation: {
    wallet: Address
    identityId: Hex
    kycVerified: boolean
    issuedAt: string
    expiresAt: string
    nonce: string
  }
  signature: Hex
  attestor: Address
}

export function eip712Domain(chainId: number, verifyingContract: Address) {
  return { name: 'AlibiAttestation', version: '1', chainId, verifyingContract } as const
}

export class Attestor {
  private readonly account
  constructor(
    privateKey: Hex,
    private readonly chainId: number,
    private readonly verifier: Address,
    private readonly registry: Address,
    private readonly client: Pick<PublicClient, 'readContract' | 'getBlock'>,
  ) {
    this.account = privateKeyToAccount(privateKey)
  }

  get address(): Address {
    return this.account.address
  }

  /** The identity a wallet is bound to on chain (zero bytes32 if unbound). */
  async identityOf(wallet: Address): Promise<Hex> {
    return (await this.client.readContract({ address: this.registry, abi: registryAbi, functionName: 'identityOf', args: [wallet] })) as Hex
  }

  /** Sign an attestation for `wallet`, using the registry's current single-use nonce and CHAIN time. */
  async sign(args: { wallet: Address; identityId: Hex; kycVerified: boolean; ttlSeconds: number }): Promise<SignedAttestation> {
    const [nonce, block] = await Promise.all([
      this.client.readContract({ address: this.registry, abi: registryAbi, functionName: 'attestationNonce', args: [args.wallet] }),
      this.client.getBlock(),
    ])
    // use chain time, not server time: the contract validates against block.timestamp
    const issuedAt = block.timestamp
    const message: AttestationMessage = {
      wallet: args.wallet,
      identityId: args.identityId,
      kycVerified: args.kycVerified,
      issuedAt,
      expiresAt: issuedAt + BigInt(args.ttlSeconds),
      nonce: nonce as bigint,
    }
    const signature = await this.account.signTypedData({
      domain: eip712Domain(this.chainId, this.verifier),
      types: ATTESTATION_TYPES,
      primaryType: 'Attestation',
      message,
    })
    return {
      attestation: {
        wallet: message.wallet,
        identityId: message.identityId,
        kycVerified: message.kycVerified,
        issuedAt: message.issuedAt.toString(),
        expiresAt: message.expiresAt.toString(),
        nonce: message.nonce.toString(),
      },
      signature,
      attestor: this.account.address,
    }
  }
}
