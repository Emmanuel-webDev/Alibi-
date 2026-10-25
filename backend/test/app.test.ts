import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { createApp } from '../src/app.js'
import type { Attestor } from '../src/attest.js'
import { ChallengeStore } from '../src/challenge.js'
import type { Config } from '../src/config.js'
import { identityIdFor, identityIdForDid, identityIdForWallet } from '../src/identity.js'
import { MockQieClient } from '../src/qie/client.js'

const zero = '0x0000000000000000000000000000000000000000'
const baseCfg = {
  PORT: 0, CORS_ORIGIN: '*', CHAIN_ID: 1983, RPC_URL: 'http://x', START_BLOCK: 0n,
  VERIFIER_ADDRESS: zero, REGISTRY_ADDRESS: zero, ESCROW_ADDRESS: zero, ROUTER_ADDRESS: zero,
  ATTESTATION_TTL_SECONDS: 3600, AUTHORIZATION_TTL_SECONDS: 1800, SANDBOX_ENABLED: false, IDENTITY_ANCHOR: 'did',
} as unknown as Config

const primary = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
const second = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const stranger = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a')
type Acct = typeof primary

/** wallets that are "bound on chain" in these tests: wallet -> identityId */
const bound = new Map<string, string>()
const fakeAttestor = {
  address: zero,
  identityOf: async (w: string) => bound.get(w.toLowerCase()) ?? '0x' + '00'.repeat(32),
  sign: async (a: { wallet: string; identityId: string; kycVerified: boolean }) => ({
    attestation: { wallet: a.wallet, identityId: a.identityId, kycVerified: a.kycVerified, issuedAt: '1', expiresAt: '2', nonce: '0' },
    signature: '0x1234',
    attestor: zero,
  }),
} as unknown as Attestor

async function start(cfg: Config) {
  const app = createApp({
    cfg, qie: new MockQieClient([stranger.address]), attestor: fakeAttestor,
    indexer: { recent: () => [], lastError: undefined, nextBlock: 0n },
    challenges: new ChallengeStore(1983),
  })
  const server = app.listen(0)
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}

let server: Server
let base = ''
let walletServer: Server
let walletBase = ''
let sbServer: Server
let sbBase = ''
beforeAll(async () => {
  ;({ server, base } = await start(baseCfg))
  ;({ server: sbServer, base: sbBase } = await start({ ...baseCfg, SANDBOX_ENABLED: true } as Config))
  ;({ server: walletServer, base: walletBase } = await start({ ...baseCfg, IDENTITY_ANCHOR: 'wallet' } as Config))
})
afterAll(() => {
  server.close()
  sbServer.close()
  walletServer.close()
})

const post = (b: string, path: string, body: unknown) => fetch(b + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
async function sign(b: string, acct: Acct, qs: string) {
  const c = (await (await fetch(`${b}/api/challenge?wallet=${acct.address}&${qs}`)).json()) as { message: string }
  return acct.signMessage({ message: c.message })
}

const get = async (b: string, path: string) => (await fetch(b + path)).json() as Promise<any>

/** the full DID flow for one wallet: consent -> sign -> attest */
async function didBind(acct: Acct) {
  const started = await (await post(base, '/api/bind/start', { wallet: acct.address })).json()
  const status = await get(base, `/api/bind/status?wallet=${acct.address}&requestId=${started.requestId}`)
  const signature = await sign(base, acct, 'purpose=self')
  const r = await post(base, '/api/attest', { wallet: acct.address, signature, requestId: started.requestId })
  return { started, status, r, j: (await r.json()) as any }
}

describe('pass status (automatic lookup on connect)', () => {
  it('reports verified wallets; with the DID anchor the identity is not known until the user approves', async () => {
    const r = await get(base, `/api/pass-status?wallet=${primary.address}`)
    expect(r.isVerified).toBe(true)
    expect(r.identityId).toBeNull()
    expect(r.anchor).toBe('did')
    expect(r.mode).toBe('mock')
  })
  it('with the wallet anchor the identity is known up front', async () => {
    const r = await get(walletBase, `/api/pass-status?wallet=${primary.address}`)
    expect(r.identityId).toBe(identityIdForWallet(primary.address))
  })
  it('reports unverified wallets', async () => {
    const r = await get(base, `/api/pass-status?wallet=${stranger.address}`)
    expect(r.isVerified).toBe(false)
    expect(r.identityId).toBeNull()
  })
  it('rejects a bad address', async () => {
    expect((await fetch(`${base}/api/pass-status?wallet=nope`)).status).toBe(400)
  })
})

describe('DID anchored binding (QIE Pass consent)', () => {
  it('consent -> claim -> signature -> attestation anchored to the QIE DID', async () => {
    const { started, status, r, j } = await didBind(primary)
    expect(started.status).toBe('pending_consent')
    expect(status.status).toBe('ready')
    expect(r.status).toBe(200)
    expect(j.via).toBe('self')
    expect(j.attestation.wallet).toBe(primary.address)
    expect(j.attestation.identityId).toBe(identityIdForDid(`did:qie:mock:${primary.address.toLowerCase()}`))
  })
  it('refuses an attestation without an approved QIE request', async () => {
    const signature = await sign(base, primary, 'purpose=self')
    expect((await post(base, '/api/attest', { wallet: primary.address, signature })).status).toBe(409)
    expect((await post(base, '/api/attest', { wallet: primary.address, signature, requestId: 'made-up' })).status).toBe(409)
  })
  it("a request approved for one wallet cannot be used by another", async () => {
    const started = await (await post(base, '/api/bind/start', { wallet: primary.address })).json()
    await get(base, `/api/bind/status?wallet=${primary.address}&requestId=${started.requestId}`)
    expect((await fetch(`${base}/api/bind/status?wallet=${second.address}&requestId=${started.requestId}`)).status).toBe(404)
    const signature = await sign(base, second, 'purpose=self')
    expect((await post(base, '/api/attest', { wallet: second.address, signature, requestId: started.requestId })).status).toBe(409)
  })
  it('a request is single use', async () => {
    const started = await (await post(base, '/api/bind/start', { wallet: primary.address })).json()
    await get(base, `/api/bind/status?wallet=${primary.address}&requestId=${started.requestId}`)
    const s1 = await sign(base, primary, 'purpose=self')
    expect((await post(base, '/api/attest', { wallet: primary.address, signature: s1, requestId: started.requestId })).status).toBe(200)
    const s2 = await sign(base, primary, 'purpose=self')
    expect((await post(base, '/api/attest', { wallet: primary.address, signature: s2, requestId: started.requestId })).status).toBe(409)
  })
  it('refuses unverified wallets, wrong signatures and replayed challenges', async () => {
    expect((await post(base, '/api/bind/start', { wallet: stranger.address })).status).toBe(409)
    const started = await (await post(base, '/api/bind/start', { wallet: primary.address })).json()
    await get(base, `/api/bind/status?wallet=${primary.address}&requestId=${started.requestId}`)
    const wrong = await sign(base, second, 'purpose=self')
    expect((await post(base, '/api/attest', { wallet: primary.address, signature: wrong, requestId: started.requestId })).status).toBe(401)
  })
})

describe('wallet anchored binding (fallback mode)', () => {
  it('verified wallet + signature => attestation anchored to that wallet', async () => {
    const signature = await sign(walletBase, primary, 'purpose=self')
    const r = await post(walletBase, '/api/attest', { wallet: primary.address, signature })
    const j = await r.json()
    expect(r.status).toBe(200)
    expect(j.attestation.identityId).toBe(identityIdForWallet(primary.address))
  })
  it('refuses an unverified wallet even with a valid signature', async () => {
    const signature = await sign(walletBase, stranger, 'purpose=self')
    expect((await post(walletBase, '/api/attest', { wallet: stranger.address, signature })).status).toBe(409)
  })
})

describe('adding a second wallet to a bound identity', () => {
  it('primary authorizes, second wallet joins the primary identity on chain', async () => {
    const { j } = await didBind(primary)
    bound.set(primary.address.toLowerCase(), j.attestation.identityId) // pretend linkWallet landed on chain

    const authSig = await sign(base, primary, `purpose=authorize&target=${second.address}`)
    expect((await post(base, '/api/authorize', { primary: primary.address, wallet: second.address, signature: authSig })).status).toBe(200)

    const status = await get(base, `/api/pass-status?wallet=${second.address}`)
    expect(status.pendingJoin.primary).toBe(primary.address)
    expect(status.pendingJoin.identityId).toBe(j.attestation.identityId)

    const joinSig = await sign(base, second, 'purpose=join')
    const r = await post(base, '/api/attest', { wallet: second.address, signature: joinSig })
    const jj = await r.json()
    expect(r.status).toBe(200)
    expect(jj.via).toBe('join')
    expect(jj.attestation.wallet).toBe(second.address)
    expect(jj.attestation.identityId).toBe(j.attestation.identityId)
    expect((await get(base, `/api/pass-status?wallet=${second.address}`)).pendingJoin).toBeNull()
  })
  it('a primary that is not bound on chain cannot authorize', async () => {
    bound.delete(primary.address.toLowerCase())
    const sig = await sign(base, primary, `purpose=authorize&target=${second.address}`)
    expect((await post(base, '/api/authorize', { primary: primary.address, wallet: second.address, signature: sig })).status).toBe(409)
  })
  it('an unverified wallet cannot authorize anyone', async () => {
    const sig = await sign(base, stranger, `purpose=authorize&target=${second.address}`)
    expect((await post(base, '/api/authorize', { primary: stranger.address, wallet: second.address, signature: sig })).status).toBe(409)
  })
  it('a wallet cannot join without an authorization', async () => {
    expect((await fetch(`${base}/api/challenge?wallet=${second.address}&purpose=join`)).status).toBe(404)
  })
})

describe('judge sandbox', () => {
  it('is disabled (404) unless explicitly enabled', async () => {
    expect((await fetch(`${base}/api/challenge?wallet=${primary.address}&purpose=sandbox&target=alice.qie`)).status).toBe(404)
    expect((await post(base, '/api/sandbox/attest', { wallet: primary.address, preset: 'alice.qie', signature: '0x12' })).status).toBe(404)
    expect((await (await fetch(`${base}/api/config`)).json()).sandbox.enabled).toBe(false)
  })
  it('when enabled, two wallets resolve to the same preset identity with one signature each', async () => {
    const cfg = await (await fetch(`${sbBase}/api/config`)).json()
    expect(cfg.sandbox.presets).toEqual(['alice.qie', 'merchant.qie'])
    for (const acct of [primary, second]) {
      const sig = await sign(sbBase, acct, 'purpose=sandbox&target=alice.qie')
      const r = await post(sbBase, '/api/sandbox/attest', { wallet: acct.address, preset: 'alice.qie', signature: sig })
      const j = await r.json()
      expect(r.status).toBe(200)
      expect(j.attestation.identityId).toBe(identityIdFor('alice.qie'))
    }
  })
  it('rejects unknown presets', async () => {
    expect((await fetch(`${sbBase}/api/challenge?wallet=${primary.address}&purpose=sandbox&target=evil.qie`)).status).toBe(400)
  })
})
