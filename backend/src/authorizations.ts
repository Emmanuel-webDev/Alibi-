import type { Address, Hex } from 'viem'

interface Auth {
  primary: Address
  /** the primary's on-chain identity at authorization time */
  identityId: Hex
  expiresAt: number
}

/**
 * A verified primary wallet can authorize ONE other wallet to join its identity. The authorization is stored here only
 * until the joining wallet claims it (or it expires); the proof is the primary wallet's own signature, checked first.
 */
export class AuthorizationStore {
  private readonly map = new Map<string, Auth>()

  constructor(
    private readonly ttlMs = 30 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  set(wallet: Address, primary: Address, identityId: Hex): number {
    const expiresAt = this.now() + this.ttlMs
    this.map.set(wallet.toLowerCase(), { primary, identityId, expiresAt })
    return expiresAt
  }

  get(wallet: Address): Auth | undefined {
    const a = this.map.get(wallet.toLowerCase())
    if (!a) return undefined
    if (a.expiresAt < this.now()) {
      this.map.delete(wallet.toLowerCase())
      return undefined
    }
    return a
  }

  clear(wallet: Address) {
    this.map.delete(wallet.toLowerCase())
  }
}
