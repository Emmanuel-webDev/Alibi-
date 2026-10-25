import { encodePacked, keccak256, toBytes, type Address, type Hex } from 'viem'

export function normalizeHandle(input: string): string {
  return input.trim().toLowerCase().replace(/^@/, '')
}

export function looksLikeWalletAddress(input: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(input.trim())
}

/**
 * The on-chain identity anchor for a real user: a domain-separated hash of the wallet that QIE Pass verified
 * (the "primary" wallet). QIE's API tells us whether a wallet's owner is verified, but returns no handle or
 * per-person ID, so the verified wallet is the strongest anchor the documented API supports. No PII.
 */
export function identityIdForWallet(primary: Address): Hex {
  return keccak256(encodePacked(['string', 'address'], ['alibi:qie-verified-wallet:v1', primary.toLowerCase() as Address]))
}

/** Anchor for NAMED demo identities (Judge Sandbox only, e.g. "alice.qie"). Never used for real users. */
export function identityIdFor(handle: string): Hex {
  return keccak256(toBytes(`alibi:qie-identity:v1:${normalizeHandle(handle)}`))
}

/**
 * Anchor from QIE Pass's per-person DID (the `subject` of the credential returned by claim-and-verify).
 * The DID maps to one KYC profile, so every wallet that person binds lands on the same identity. The string is hashed
 * exactly as QIE returns it (trimmed only), so two different DIDs can never collide by case-folding.
 */
export function identityIdForDid(did: string): Hex {
  return keccak256(toBytes(`alibi:qie-did:v1:${did.trim()}`))
}
