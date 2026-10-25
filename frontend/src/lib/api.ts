import type { Address, Hex } from 'viem'
import { ENV } from '../config/env'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const MESSAGES: Record<string, string> = {
  not_verified: 'QIE Pass does not show a verified identity for this wallet.',
  wallet_signature_invalid_or_expired: 'The wallet signature was invalid or expired. Try again.',
  consent_required: 'Approve the request in QIE Wallet first.',
  primary_not_bound: 'Bind your verified wallet first, then authorize others.',
  no_pending_authorization: 'No wallet has authorized this one to join an identity, or the authorization expired.',
  sandbox_disabled: 'Judge sandbox mode is not enabled on this relayer.',
  unknown_preset: 'That demo identity does not exist.',
  qie_api_error: 'QIE Pass returned an error. Check the relayer logs and your partner keys.',
  rate_limited: 'Too many requests. Wait a moment and try again.',
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(ENV.apiUrl + path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  } catch {
    throw new ApiError(0, 'unreachable', `Cannot reach the Alibi relayer at ${ENV.apiUrl}. Is it running?`)
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string; status?: number }
  if (!res.ok) {
    const code = body.error ?? 'error'
    if (code === 'qie_api_error') {
      const detail = (body.detail ?? '').replace(/pk_[a-zA-Z0-9_]+/g, '[REDACTED]').replace(/sk_[a-zA-Z0-9_]+/g, '[REDACTED]')
      const status = body.status
      if (status === 401 || status === 403 || detail.includes('401') || detail.includes('403')) {
        throw new ApiError(res.status, code, 'QIE Pass authentication error. Check your partner keys.')
      }
      if (status === 409 || detail.includes('409') || detail.toLowerCase().includes('already verified')) {
        throw new ApiError(res.status, code, 'Your wallet is already verified with QIE Pass. Using your existing verified identity.')
      }
      throw new ApiError(res.status, code, detail ? `QIE Pass: ${detail}` : 'QIE Pass returned an error.')
    }
    throw new ApiError(res.status, code, MESSAGES[code] ?? body.detail ?? `Request failed (${res.status}).`)
  }
  return body as T
}

export interface RelayerConfig {
  chainId: number
  qieMode: 'mock' | 'live'
  attestor: Address
  sandbox: { enabled: boolean; presets: string[] }
  contracts: { verifier: Address; registry: Address; escrow: Address; router: Address; vault: Address | null }
}

export interface PassStatus {
  wallet: Address
  isVerified: boolean
  /** Known up front only with the wallet anchor. With the DID anchor it is derived after the user approves in QIE Wallet. */
  identityId: Hex | null
  anchor: 'did' | 'wallet'
  /** Set when a verified primary wallet has authorized this wallet to join its identity. */
  pendingJoin: { primary: Address; identityId: Hex; expiresAt: number } | null
  mode: 'mock' | 'live'
}

export interface AttestResponse {
  attestation: { wallet: Address; identityId: Hex; kycVerified: boolean; issuedAt: string; expiresAt: string; nonce: string }
  signature: Hex
  identityId: Hex
  via: 'self' | 'join' | 'sandbox'
  primary?: Address
  preset?: string
  mode: 'mock' | 'live'
}

export type ConsentState = 'pending_consent' | 'consent_given' | 'consent_rejected' | 'expired' | 'other' | 'ready'

export type ChallengePurpose = 'self' | 'join' | 'authorize' | 'sandbox'

export interface IndexedEvent {
  contract: 'registry' | 'escrow' | 'router' | 'vault'
  event: string
  blockNumber: string
  txHash: Hex
  logIndex: number
  args: Record<string, string | boolean | number>
}

export const api = {
  config: () => call<RelayerConfig>('/api/config'),
  passStatus: (wallet: Address) => call<PassStatus>(`/api/pass-status?wallet=${wallet}`),
  challenge: (wallet: Address, purpose: ChallengePurpose, target?: string) =>
    call<{ message: string; expiresAt: number }>(`/api/challenge?wallet=${wallet}&purpose=${purpose}${target ? `&target=${encodeURIComponent(target)}` : ''}`),
  bindStart: (wallet: Address) => call<{ requestId: string; status: ConsentState; mode: 'mock' | 'live' }>('/api/bind/start', { method: 'POST', body: JSON.stringify({ wallet }) }),
  bindStatus: (wallet: Address, requestId: string) => call<{ status: ConsentState; mode: 'mock' | 'live' }>(`/api/bind/status?wallet=${wallet}&requestId=${encodeURIComponent(requestId)}`),
  attest: (body: { wallet: Address; signature: Hex; requestId?: string }) => call<AttestResponse>('/api/attest', { method: 'POST', body: JSON.stringify(body) }),
  authorize: (body: { primary: Address; wallet: Address; signature: Hex }) => call<{ ok: true; expiresAt: number }>('/api/authorize', { method: 'POST', body: JSON.stringify(body) }),
  sandboxAttest: (body: { wallet: Address; preset: string; signature: Hex }) => call<AttestResponse>('/api/sandbox/attest', { method: 'POST', body: JSON.stringify(body) }),
  events: (contract?: IndexedEvent['contract'], limit = 100) =>
    call<{ nextBlock: string; events: IndexedEvent[] }>(`/api/events?limit=${limit}${contract ? `&contract=${contract}` : ''}`),
}
