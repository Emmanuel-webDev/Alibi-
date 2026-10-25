import type { Config } from '../config.js'
import { authHeaders } from './hmac.js'

/**
 * What Alibi needs from QIE Pass: "is the person behind this wallet verified?". That is exactly one documented call:
 *   GET /api/v1/partners/verification-requests/is-verified?identifier=<0x wallet | name.qie>
 *   -> { "success": true, "data": { "isVerified": true } }
 * No notification is sent to the user and no personal data is returned. (The KYC Share flow is deliberately NOT used:
 * it copies the user's KYC record into the partner's Sumsub account, which Alibi neither needs nor wants.)
 */
export type ConsentStatus = 'pending_consent' | 'consent_given' | 'consent_rejected' | 'expired' | 'other'

export interface QieClient {
  readonly mode: 'mock' | 'live'
  /** silent check, no notification to the user */
  isVerified(identifier: string): Promise<boolean>
  /** asks the user to approve in QIE Wallet (POST /partners/verification-requests) */
  startConsent(wallet: string): Promise<{ requestId: string; status: ConsentStatus }>
  getConsent(requestId: string): Promise<{ status: ConsentStatus; did?: string }>
  /** after consent: POST /vc/partner/claim-and-verify. Returns the per-person DID, only if QIE itself validated the credential. */
  claimSubject(requestId: string): Promise<{ subject: string }>
  /** looks up an existing completed verification request for a wallet (e.g. if 409 already verified) */
  findExistingRequest(wallet: string): Promise<{ requestId: string; did: string; status: ConsentStatus } | null>
}

export class QieApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export const IS_VERIFIED_PATH = '/api/v1/partners/verification-requests/is-verified'
export const REQUESTS_PATH = '/api/v1/partners/verification-requests'
export const CLAIM_PATH = '/api/v1/vc/partner/claim-and-verify'

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {})
const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined)

function toStatus(raw: unknown): ConsentStatus {
  const s = str(raw)
  return s === 'pending_consent' || s === 'consent_given' || s === 'consent_rejected' || s === 'expired' ? s : 'other'
}

export class LiveQieClient implements QieClient {
  readonly mode = 'live' as const

  constructor(
    private readonly cfg: Pick<Config, 'QIE_BASE_URL' | 'QIE_PUBLIC_KEY' | 'QIE_SECRET_KEY'>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(method: 'GET' | 'POST', path: string, query?: Record<string, string>, payload?: unknown): Promise<Json> {
    const url = new URL(this.cfg.QIE_BASE_URL.replace(/\/$/, '') + path)
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v)
    const res = await this.fetchImpl(url, {
      method,
      headers: authHeaders({ publicKey: this.cfg.QIE_PUBLIC_KEY!, secret: this.cfg.QIE_SECRET_KEY! }),
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })
    const text = await res.text()
    let json: Json = {}
    try {
      json = text ? (JSON.parse(text) as Json) : {}
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      // 401/403: bad or revoked keys, clock skew over 5 minutes, suspended account. Never reported as "unverified".
      throw new QieApiError(res.status, `QIE API ${res.status}: ${str(json.message) ?? str(json.error) ?? res.statusText}`)
    }
    return json
  }

  async isVerified(identifier: string): Promise<boolean> {
    const json = await this.call('GET', IS_VERIFIED_PATH, { identifier })
    // false for unknown, unverified, revoked, expired and malformed identifiers. Only a literal true counts.
    return obj(json.data).isVerified === true
  }

  async startConsent(wallet: string) {
    const json = await this.call('POST', REQUESTS_PATH, undefined, { identifier: wallet, requestedClaims: ['age_over_18'] })
    const d = obj(json.data)
    const requestId = str(d.requestId)
    if (!requestId) throw new QieApiError(502, 'QIE response had no requestId')
    return { requestId, status: toStatus(d.status) }
  }

  async getConsent(requestId: string) {
    const json = await this.call('GET', `${REQUESTS_PATH}/${encodeURIComponent(requestId)}`)
    const d = obj(json.data)
    return { status: toStatus(d.status), did: str(d.did) }
  }

  async claimSubject(requestId: string) {
    const json = await this.call('POST', CLAIM_PATH, undefined, { requestId })
    const v = obj(json.verification)
    // QIE reports its own validation of the credential: all four must hold before we trust the subject.
    if (v.signatureValid !== true || v.notExpired !== true || v.notRevoked !== true) {
      throw new QieApiError(409, 'QIE did not validate this credential (signature, expiry or revocation)')
    }
    const subject = str(json.subject)
    if (!subject || !subject.startsWith('did:')) throw new QieApiError(502, 'QIE credential had no DID subject')
    return { subject }
  }

  async findExistingRequest(wallet: string): Promise<{ requestId: string; did: string; status: ConsentStatus } | null> {
    try {
      const json = await this.call('GET', REQUESTS_PATH, { identifier: wallet })
      const list = Array.isArray(json.data) ? (json.data as Json[]) : []
      const match = list.find((item) => {
        const addr = str(item.walletAddress)
        const d = str(item.did)
        const s = str(item.status)
        return addr?.toLowerCase() === wallet.toLowerCase() && (s === 'completed' || s === 'consent_given') && !!d && d.startsWith('did:')
      })
      if (!match) return null
      return {
        requestId: str(match.requestId) ?? str(match._id) ?? '',
        did: str(match.did)!,
        status: toStatus(match.status),
      }
    } catch {
      return null
    }
  }
}

/**
 * Local/demo client. Every wallet counts as verified unless it is listed in `unverified`, so the verification gate
 * can still be demonstrated. The API and UI label this mode on every response.
 */
export class MockQieClient implements QieClient {
  readonly mode = 'mock' as const
  private readonly unverified: Set<string>
  private readonly requests = new Map<string, string>()

  constructor(unverified: string[] = []) {
    this.unverified = new Set(unverified.map((a) => a.toLowerCase()))
  }

  async isVerified(identifier: string): Promise<boolean> {
    return !this.unverified.has(identifier.toLowerCase())
  }

  async startConsent(wallet: string) {
    if (this.unverified.has(wallet.toLowerCase())) throw new QieApiError(409, 'QIE API 409: USER_NOT_VERIFIED')
    const requestId = `mock_${this.requests.size + 1}_${wallet.slice(2, 8).toLowerCase()}`
    this.requests.set(requestId, wallet.toLowerCase())
    return { requestId, status: 'pending_consent' as const }
  }

  /** the mock user approves immediately; each wallet gets its own DID (so use the sandbox or authorize for shared identities) */
  async getConsent(requestId: string) {
    const w = this.requests.get(requestId)
    if (!w) throw new QieApiError(404, 'QIE API 404: unknown request')
    return { status: 'consent_given' as const, did: `did:qie:mock:${w}` }
  }

  async claimSubject(requestId: string) {
    const w = this.requests.get(requestId)
    if (!w) throw new QieApiError(404, 'QIE API 404: unknown request')
    return { subject: `did:qie:mock:${w}` }
  }

  async findExistingRequest(wallet: string): Promise<{ requestId: string; did: string; status: ConsentStatus } | null> {
    for (const [reqId, w] of this.requests.entries()) {
      if (w.toLowerCase() === wallet.toLowerCase()) {
        return { requestId: reqId, did: `did:qie:mock:${w}`, status: 'consent_given' }
      }
    }
    return null
  }
}

export function createQieClient(cfg: Config): QieClient {
  return cfg.QIE_MODE === 'live' ? new LiveQieClient(cfg) : new MockQieClient(cfg.MOCK_UNVERIFIED_WALLETS)
}
