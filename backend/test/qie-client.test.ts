import { describe, expect, it } from 'vitest'
import { CLAIM_PATH, IS_VERIFIED_PATH, LiveQieClient, MockQieClient, QieApiError, REQUESTS_PATH } from '../src/qie/client.js'

const cfg = { QIE_BASE_URL: 'https://pass-api.qie.digital', QIE_PUBLIC_KEY: 'pk_test_abc', QIE_SECRET_KEY: 'sk' }
const wallet = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

function fakeFetch(status: number, body: unknown, seen: { url?: URL; headers?: Record<string, string> } = {}) {
  return (async (url: URL, init: RequestInit) => {
    seen.url = url
    seen.headers = init.headers as Record<string, string>
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
}

describe('LiveQieClient.isVerified', () => {
  it('calls the documented endpoint with the identifier and auth headers', async () => {
    const seen: { url?: URL; headers?: Record<string, string> } = {}
    const c = new LiveQieClient(cfg, fakeFetch(200, { success: true, data: { isVerified: true } }, seen))
    expect(await c.isVerified(wallet)).toBe(true)
    expect(seen.url?.pathname).toBe(IS_VERIFIED_PATH)
    expect(seen.url?.searchParams.get('identifier')).toBe(wallet)
    expect(seen.headers?.['X-Public-Key']).toBe('pk_test_abc')
    expect(seen.headers?.['X-Signature']).toMatch(/^[0-9a-f]{64}$/)
  })
  it('only a literal true counts as verified', async () => {
    for (const data of [{ isVerified: false }, { isVerified: 'true' }, {}, undefined]) {
      expect(await new LiveQieClient(cfg, fakeFetch(200, { success: true, data })).isVerified(wallet)).toBe(false)
    }
  })
  it('treats auth and account problems as errors, not as "unverified"', async () => {
    await expect(new LiveQieClient(cfg, fakeFetch(401, { message: 'Invalid signature' })).isVerified(wallet)).rejects.toBeInstanceOf(QieApiError)
    await expect(new LiveQieClient(cfg, fakeFetch(403, { message: 'suspended' })).isVerified(wallet)).rejects.toThrow(/403/)
    await expect(new LiveQieClient(cfg, fakeFetch(500, {})).isVerified(wallet)).rejects.toThrow(/500/)
  })
})

describe('MockQieClient', () => {
  it('verifies everyone except the configured wallets', async () => {
    const m = new MockQieClient([wallet])
    expect(await m.isVerified(wallet.toLowerCase())).toBe(false)
    expect(await m.isVerified('0x5de4111afa1a4b94908f83103eb1f1706367c2e6')).toBe(true)
  })
})

function sequence(responses: { status: number; body: unknown }[], urls: string[] = []) {
  let i = 0
  return (async (url: URL) => {
    urls.push(url.pathname)
    const r = responses[i++]!
    return new Response(JSON.stringify(r.body), { status: r.status })
  }) as unknown as typeof fetch
}

describe('LiveQieClient consent + credential claim (shapes seen in the QIE sandbox)', () => {
  it('start -> poll -> claim returns the DID, only when QIE validated the credential', async () => {
    const urls: string[] = []
    const c = new LiveQieClient(
      cfg,
      sequence(
        [
          { status: 200, body: { success: true, data: { requestId: 'r1', status: 'pending_consent', userStatus: 'verified' } } },
          { status: 200, body: { success: true, data: { status: 'consent_given', did: 'did:qie:abc', requestId: 'r1' } } },
          { status: 200, body: { success: true, subject: 'did:qie:abc', verification: { signatureValid: true, commitmentValid: true, notExpired: true, notRevoked: true } } },
        ],
        urls,
      ),
    )
    expect(await c.startConsent(wallet)).toEqual({ requestId: 'r1', status: 'pending_consent' })
    expect(await c.getConsent('r1')).toEqual({ status: 'consent_given', did: 'did:qie:abc' })
    expect(await c.claimSubject('r1')).toEqual({ subject: 'did:qie:abc' })
    expect(urls).toEqual([REQUESTS_PATH, `${REQUESTS_PATH}/r1`, CLAIM_PATH])
  })
  it('rejects a credential QIE did not validate, or without a DID subject', async () => {
    const bad = { success: true, subject: 'did:qie:abc', verification: { signatureValid: true, notExpired: true, notRevoked: false } }
    await expect(new LiveQieClient(cfg, sequence([{ status: 200, body: bad }])).claimSubject('r1')).rejects.toThrow(/did not validate/)
    const noDid = { success: true, subject: 'abc', verification: { signatureValid: true, notExpired: true, notRevoked: true } }
    await expect(new LiveQieClient(cfg, sequence([{ status: 200, body: noDid }])).claimSubject('r1')).rejects.toThrow(/no DID/)
  })
  it('maps unknown statuses to "other" and surfaces QIE errors', async () => {
    const c = new LiveQieClient(cfg, sequence([{ status: 200, body: { data: { status: 'weird' } } }, { status: 409, body: { message: 'USER_NOT_VERIFIED' } }]))
    expect((await c.getConsent('r1')).status).toBe('other')
    await expect(c.startConsent(wallet)).rejects.toThrow(/USER_NOT_VERIFIED/)
  })
})
