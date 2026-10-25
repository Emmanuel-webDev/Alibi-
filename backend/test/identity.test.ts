import { describe, expect, it } from 'vitest'
import { identityIdFor, identityIdForDid, identityIdForWallet, looksLikeWalletAddress, normalizeHandle } from '../src/identity.js'

const a = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

describe('identity anchors', () => {
  it('wallet anchor ignores address case and differs per wallet', () => {
    expect(identityIdForWallet(a as `0x${string}`)).toBe(identityIdForWallet(a.toLowerCase() as `0x${string}`))
    expect(identityIdForWallet(a as `0x${string}`)).not.toBe(identityIdForWallet('0x5de4111afa1a4b94908f83103eb1f1706367c2e6'))
    expect(identityIdForWallet(a as `0x${string}`)).toMatch(/^0x[0-9a-f]{64}$/)
  })
  it('named (sandbox) anchor normalises case, whitespace and @, and never collides with a wallet anchor', () => {
    expect(normalizeHandle(' @Alice.QIE ')).toBe('alice.qie')
    expect(identityIdFor('Alice.qie')).toBe(identityIdFor(' @alice.qie '))
    expect(identityIdFor('alice.qie')).not.toBe(identityIdFor('merchant.qie'))
    expect(identityIdFor(a)).not.toBe(identityIdForWallet(a as `0x${string}`))
  })
  it('DID anchor is exact (trim only), stable across wallets, and distinct from the other anchors', () => {
    expect(identityIdForDid(' did:qie:abc ')).toBe(identityIdForDid('did:qie:abc'))
    expect(identityIdForDid('did:qie:abc')).not.toBe(identityIdForDid('did:qie:ABC'))
    expect(identityIdForDid(a)).not.toBe(identityIdForWallet(a as `0x${string}`))
  })
  it('recognises wallet addresses', () => {
    expect(looksLikeWalletAddress(a)).toBe(true)
    expect(looksLikeWalletAddress('alice.qie')).toBe(false)
  })
})
