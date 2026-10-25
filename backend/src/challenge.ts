import { randomBytes } from 'node:crypto'
import { verifyMessage, type Address, type Hex } from 'viem'

interface Pending {
  message: string
  expiresAt: number
}

const HEADLINES: Record<string, string> = {
  self: 'Alibi Protocol: bind this wallet to its QIE Pass identity.',
  join: 'Alibi Protocol: add this wallet to a QIE-verified identity.',
  authorize: 'Alibi Protocol: authorize another wallet to join your identity.',
  sandbox: 'Alibi Protocol (TESTNET SANDBOX): bind this wallet to a demo identity.',
}

/**
 * Wallet-ownership challenges. Before the attestor signs anything, the wallet in question must sign a single-use
 * message bound to (wallet, scope, chain). `scope` says what the signature authorizes, for example:
 *   self                   bind this wallet to its own verified identity
 *   authorize:<wallet>     a verified primary wallet lets <wallet> join its identity
 *   join:<primary>         the joining wallet accepts
 *   sandbox:<preset>       testnet demo identity
 * EOA signatures only (QIE Wallet is an EOA wallet).
 */
export class ChallengeStore {
  private readonly pending = new Map<string, Pending>()

  constructor(
    private readonly chainId: number,
    private readonly ttlMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  private key(wallet: Address, scope: string) {
    return `${wallet.toLowerCase()}|${scope.toLowerCase()}`
  }

  issue(wallet: Address, scope: string): { message: string; expiresAt: number } {
    this.sweep()
    const expiresAt = this.now() + this.ttlMs
    const kind = scope.split(':')[0] ?? 'self'
    const message = [
      HEADLINES[kind] ?? HEADLINES.self,
      '',
      `Wallet: ${wallet}`,
      `Scope: ${scope}`,
      `Chain ID: ${this.chainId}`,
      `Nonce: ${randomBytes(12).toString('hex')}`,
      `Expires: ${new Date(expiresAt).toISOString()}`,
      '',
      'Signing this message costs no gas and does not move any funds.',
    ].join('\n')
    this.pending.set(this.key(wallet, scope), { message, expiresAt })
    return { message, expiresAt }
  }

  /** Verifies and CONSUMES the challenge (single use, even when the signature is wrong). */
  async consume(wallet: Address, scope: string, signature: Hex): Promise<boolean> {
    const k = this.key(wallet, scope)
    const p = this.pending.get(k)
    if (!p) return false
    this.pending.delete(k)
    if (p.expiresAt < this.now()) return false
    try {
      return await verifyMessage({ address: wallet, message: p.message, signature })
    } catch {
      return false
    }
  }

  private sweep() {
    const t = this.now()
    for (const [k, v] of this.pending) if (v.expiresAt < t) this.pending.delete(k)
  }
}
