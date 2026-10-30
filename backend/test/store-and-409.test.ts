import { existsSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { createApp } from '../src/app.js'
import type { Attestor } from '../src/attest.js'
import { ChallengeStore } from '../src/challenge.js'
import type { Config } from '../src/config.js'
import { identityIdForDid } from '../src/identity.js'
import { QieApiError, type ConsentStatus, type QieClient } from '../src/qie/client.js'
import { IdentityStore } from '../src/qie/store.js'

const zero = '0x0000000000000000000000000000000000000000'
const acctA = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
const acctB = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')

const testStorePath = resolve(process.cwd(), `tmp-test-store-${Date.now()}.json`)

describe('IdentityStore persistence', () => {
  afterAll(() => {
    if (existsSync(testStorePath)) unlinkSync(testStorePath)
  })

  it('persists mapping to disk and survives reload/restart', () => {
    const store1 = new IdentityStore(testStorePath)
    store1.set(acctA.address, { requestId: 'req_123', did: 'did:qie:persisted_user' })
    expect(store1.get(acctA.address)?.did).toBe('did:qie:persisted_user')

    // Simulate restart with a new instance loading the same file
    const store2 = new IdentityStore(testStorePath)
    expect(store2.get(acctA.address)?.did).toBe('did:qie:persisted_user')
    expect(store2.get(acctA.address)?.requestId).toBe('req_123')
    expect(store2.get(acctB.address)).toBeUndefined()
  })
})

describe('409 path and stored DID reuse', () => {
  let server: Server
  let base: string
  let store: IdentityStore

  const fakeAttestor = {
    address: zero,
    identityOf: async () => '0x' + '00'.repeat(32),
    sign: async (a: { wallet: string; identityId: string; kycVerified: boolean }) => ({
      attestation: { wallet: a.wallet, identityId: a.identityId, kycVerified: a.kycVerified, issuedAt: '1', expiresAt: '2', nonce: '0' },
      signature: '0x1234',
      attestor: zero,
    }),
  } as unknown as Attestor

  class Mock409QieClient implements QieClient {
    readonly mode = 'live' as const
    findExistingCalled = false

    async isVerified(identifier: string): Promise<boolean> {
      return identifier.toLowerCase() === acctA.address.toLowerCase() || identifier.toLowerCase() === acctB.address.toLowerCase()
    }

    async startConsent(_wallet: string): Promise<{ requestId: string; status: ConsentStatus }> {
      throw new QieApiError(409, 'QIE API 409: Your wallet is already verified with this partner')
    }

    async getConsent(_requestId: string): Promise<{ status: ConsentStatus; did?: string }> {
      return { status: 'consent_given', did: 'did:qie:existing_user_a' }
    }

    async claimSubject(_requestId: string): Promise<{ subject: string }> {
      return { subject: 'did:qie:existing_user_a' }
    }

    async findExistingRequest(wallet: string): Promise<{ requestId: string; did: string; status: ConsentStatus } | null> {
      this.findExistingCalled = true
      if (wallet.toLowerCase() === acctA.address.toLowerCase()) {
        return { requestId: 'req_existing_a', did: 'did:qie:existing_user_a', status: 'consent_given' }
      }
      return null
    }
  }

  const qieMock = new Mock409QieClient()

  beforeAll(async () => {
    store = new IdentityStore()
    const cfg = {
      PORT: 0, CORS_ORIGIN: '*', CHAIN_ID: 1983, RPC_URL: 'http://x', START_BLOCK: 0n,
      VERIFIER_ADDRESS: zero, REGISTRY_ADDRESS: zero, ESCROW_ADDRESS: zero, ROUTER_ADDRESS: zero,
      ATTESTATION_TTL_SECONDS: 3600, AUTHORIZATION_TTL_SECONDS: 1800, SANDBOX_ENABLED: false, IDENTITY_ANCHOR: 'did',
      QIE_STORE_PATH: '',
    } as unknown as Config

    const app = createApp({
      cfg,
      qie: qieMock,
      attestor: fakeAttestor,
      indexer: { recent: () => [], lastError: undefined, nextBlock: 0n },
      challenges: new ChallengeStore(1983),
      store,
    })
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(() => {
    server?.close()
  })

  it('409 path: recovers existing request and returns ready status without failing', async () => {
    const res = await fetch(`${base}/api/bind/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet: acctA.address }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('ready')
    expect(json.requestId).toBe('req_existing_a')
    expect(json.reused).toBe(true)
    expect(qieMock.findExistingCalled).toBe(true)
    expect(store.get(acctA.address)?.did).toBe('did:qie:existing_user_a')
  })

  it('reuse of stored DID for the right wallet only: allows wallet A to attest', async () => {
    // Challenge for wallet A
    const chal = await (await fetch(`${base}/api/challenge?wallet=${acctA.address}&purpose=self`)).json()
    const sig = await acctA.signMessage({ message: chal.message })

    const attestRes = await fetch(`${base}/api/attest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet: acctA.address, signature: sig, requestId: 'req_existing_a' }),
    })
    expect(attestRes.status).toBe(200)
    const attestJson = await attestRes.json()
    expect(attestJson.identityId).toBe(identityIdForDid('did:qie:existing_user_a'))
    expect(attestJson.attestation.wallet).toBe(acctA.address)
  })

  it('refusal for a different wallet: wallet B cannot use wallet A stored DID or requestId', async () => {
    // Challenge for wallet B
    const chal = await (await fetch(`${base}/api/challenge?wallet=${acctB.address}&purpose=self`)).json()
    const sig = await acctB.signMessage({ message: chal.message })

    // Wallet B attempts to attest with Wallet A's requestId
    const hijackRes = await fetch(`${base}/api/attest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet: acctB.address, signature: sig, requestId: 'req_existing_a' }),
    })
    // Wallet B has no consent and cannot hijack wallet A's stored DID
    expect(hijackRes.status).toBe(409)
    const err = await hijackRes.json()
    expect(err.error).toBe('consent_required')
  })
})
