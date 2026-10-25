import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { isAddress, type Address, type Hex } from 'viem'
import type { Config } from './config.js'
import { Attestor } from './attest.js'
import { ChallengeStore } from './challenge.js'
import { AuthorizationStore } from './authorizations.js'
import { identityIdFor, identityIdForDid, identityIdForWallet, normalizeHandle } from './identity.js'
import type { Indexer } from './indexer.js'
import { QieApiError, type ConsentStatus, type QieClient } from './qie/client.js'
import { IdentityStore } from './qie/store.js'

/** tiny fixed-window limiter: good enough for a hackathon relayer, swap for a real one behind a proxy */
function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>()
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown'
    const now = Date.now()
    const h = hits.get(key)
    if (!h || h.reset < now) {
      hits.set(key, { n: 1, reset: now + windowMs })
      return next()
    }
    h.n += 1
    if (h.n > max) {
      res.setHeader('Retry-After', String(Math.ceil((h.reset - now) / 1000)))
      return res.status(429).json({ error: 'rate_limited' })
    }
    next()
  }
}

const walletSchema = z.string().refine((s): s is Address => isAddress(s, { strict: false }), 'invalid address')
const sigSchema = z.string().regex(/^0x[0-9a-fA-F]+$/)

/** Named demo identities for the Judge Sandbox (testnet + mock only). */
export const SANDBOX_PRESETS = ['alice.qie', 'merchant.qie'] as const

export interface AppDeps {
  cfg: Config
  qie: QieClient
  attestor: Pick<Attestor, 'address' | 'sign' | 'identityOf'>
  indexer: Pick<Indexer, 'recent' | 'lastError' | 'nextBlock'>
  challenges: ChallengeStore
  authorizations?: AuthorizationStore
  store?: IdentityStore
}

export function createApp({ cfg, qie, attestor, indexer, challenges, authorizations = new AuthorizationStore(cfg.AUTHORIZATION_TTL_SECONDS * 1000), store = new IdentityStore(cfg.QIE_STORE_PATH) }: AppDeps) {
  const app = express()

  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true)
        const allowed = cfg.CORS_ORIGIN.split(',').map((s) => s.trim())
        if (allowed.includes('*') || allowed.includes(origin)) return callback(null, true)
        // Allow any localhost or 127.0.0.1 port (e.g. 5173, 5174) in local dev
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          return callback(null, true)
        }
        callback(new Error('Not allowed by CORS'))
      },
    }),
  )
  app.use(express.json({ limit: '10kb' }))
  app.use('/api', rateLimit(60, 60_000))

  /** open "approve in QIE Wallet" requests, keyed by QIE requestId. In memory; a restart just means the user approves again. */
  const binds = new Map<string, { wallet: Address; createdAt: number; subject?: string; claiming?: boolean }>()
  const BIND_TTL_MS = 60 * 60_000
  const liveBind = (id: string, wallet: Address) => {
    const b = binds.get(id)
    if (!b || Date.now() - b.createdAt > BIND_TTL_MS || b.wallet.toLowerCase() !== wallet.toLowerCase()) return undefined
    return b
  }

  const sign = (wallet: Address, identityId: Hex) => attestor.sign({ wallet, identityId, kycVerified: true, ttlSeconds: cfg.ATTESTATION_TTL_SECONDS })

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, mode: qie.mode, indexerError: indexer.lastError ?? null })
  })

  /** Public, non-secret configuration for the frontend. */
  app.get('/api/config', (_req, res) => {
    res.json({
      chainId: cfg.CHAIN_ID,
      qieMode: qie.mode,
      attestor: attestor.address,
      sandbox: { enabled: cfg.SANDBOX_ENABLED, presets: cfg.SANDBOX_ENABLED ? SANDBOX_PRESETS : [] },
      contracts: {
        verifier: cfg.VERIFIER_ADDRESS,
        registry: cfg.REGISTRY_ADDRESS,
        escrow: cfg.ESCROW_ADDRESS,
        router: cfg.ROUTER_ADDRESS,
        vault: cfg.VAULT_ADDRESS ?? null,
      },
    })
  })

  /** Helper for the seed script and docs: the identity anchor for a verified wallet, or for a sandbox preset. */
  app.get('/api/identity-id', (req, res) => {
    const q = z.object({ wallet: walletSchema.optional(), preset: z.string().min(1).max(60).optional() }).safeParse(req.query)
    if (!q.success || (!q.data.wallet && !q.data.preset)) return res.status(400).json({ error: 'wallet or preset required' })
    if (q.data.wallet) return res.json({ wallet: q.data.wallet, identityId: identityIdForWallet(q.data.wallet as Address) })
    res.json({ preset: normalizeHandle(q.data.preset!), identityId: identityIdFor(q.data.preset!) })
  })

  /**
   * Called automatically when a wallet connects. Asks QIE Pass whether the person behind this wallet is verified
   * (silent: no notification, no personal data) and reports any pending "join this identity" authorization.
   */
  app.get('/api/pass-status', async (req, res, next) => {
    try {
      const q = z.object({ wallet: walletSchema }).safeParse(req.query)
      if (!q.success) return res.status(400).json({ error: 'wallet required' })
      const wallet = q.data.wallet as Address
      const isVerified = await qie.isVerified(wallet)
      const pending = authorizations.get(wallet)
      res.json({
        wallet,
        isVerified,
        // wallet anchor: known up front. did anchor: derived from the QIE DID after the user approves, so unknown until binding.
        identityId: isVerified && cfg.IDENTITY_ANCHOR === 'wallet' ? identityIdForWallet(wallet) : null,
        anchor: cfg.IDENTITY_ANCHOR,
        pendingJoin: pending ? { primary: pending.primary, identityId: pending.identityId, expiresAt: pending.expiresAt } : null,
        mode: qie.mode,
      })
    } catch (e) {
      next(e)
    }
  })

  /** DID anchor, step 1: ask QIE Pass to prompt the user in QIE Wallet to approve sharing their verified identity with Alibi. */
  app.post('/api/bind/start', async (req, res, next) => {
    try {
      const body = z.object({ wallet: walletSchema }).safeParse(req.body)
      if (!body.success) return res.status(400).json({ error: 'wallet required' })
      const wallet = body.data.wallet as Address
      if (!(await qie.isVerified(wallet))) return res.status(409).json({ error: 'not_verified' })

      // Check persistent store for this exact wallet first
      const stored = store.get(wallet)
      if (stored && stored.wallet.toLowerCase() === wallet.toLowerCase()) {
        binds.set(stored.requestId, { wallet, createdAt: Date.now(), subject: stored.did })
        return res.status(200).json({ requestId: stored.requestId, status: 'ready', mode: qie.mode, reused: true })
      }

      try {
        const started = await qie.startConsent(wallet)
        binds.set(started.requestId, { wallet, createdAt: Date.now() })
        res.status(201).json({ requestId: started.requestId, status: started.status, mode: qie.mode })
      } catch (err) {
        // If QIE reports already verified (HTTP 409), look up existing completed request for this wallet
        if (err instanceof QieApiError && (err.status === 409 || err.message.includes('409') || err.message.toLowerCase().includes('already verified'))) {
          const existing = await qie.findExistingRequest(wallet)
          if (existing && existing.did) {
            store.set(wallet, { requestId: existing.requestId, did: existing.did })
            binds.set(existing.requestId, { wallet, createdAt: Date.now(), subject: existing.did })
            return res.status(200).json({ requestId: existing.requestId, status: 'ready', mode: qie.mode, reused: true })
          }
        }
        throw err
      }
    } catch (e) {
      next(e)
    }
  })

  /** DID anchor, step 2: poll. Once the user approves, the credential is claimed and validated by QIE (once). */
  app.get('/api/bind/status', async (req, res, next) => {
    try {
      const q = z.object({ wallet: walletSchema, requestId: z.string().min(1).max(200) }).safeParse(req.query)
      if (!q.success) return res.status(400).json({ error: 'wallet and requestId required' })
      const b = liveBind(q.data.requestId, q.data.wallet as Address)
      if (!b) return res.status(404).json({ error: 'unknown_or_expired_request' })
      if (b.subject) {
        store.set(q.data.wallet as Address, { requestId: q.data.requestId, did: b.subject })
        return res.json({ status: 'ready', mode: qie.mode })
      }
      const c = await qie.getConsent(q.data.requestId)
      if (c.status === 'consent_given' && !b.claiming) {
        b.claiming = true
        try {
          b.subject = (await qie.claimSubject(q.data.requestId)).subject
          store.set(q.data.wallet as Address, { requestId: q.data.requestId, did: b.subject })
        } finally {
          b.claiming = false
        }
        return res.json({ status: 'ready', mode: qie.mode })
      }
      const status: ConsentStatus | 'ready' = c.status
      res.json({ status, mode: qie.mode })
    } catch (e) {
      next(e)
    }
  })

  /** A single-use message the wallet must sign. purpose: self | join | authorize (+target) | sandbox (+preset). */
  app.get('/api/challenge', (req, res) => {
    const q = z
      .object({ wallet: walletSchema, purpose: z.enum(['self', 'join', 'authorize', 'sandbox']), target: z.string().max(60).optional() })
      .safeParse(req.query)
    if (!q.success) return res.status(400).json({ error: 'wallet and purpose required' })
    const wallet = q.data.wallet as Address
    let scope: string
    switch (q.data.purpose) {
      case 'self':
        scope = 'self'
        break
      case 'join': {
        const a = authorizations.get(wallet)
        if (!a) return res.status(404).json({ error: 'no_pending_authorization' })
        scope = `join:${a.primary.toLowerCase()}`
        break
      }
      case 'authorize': {
        if (!q.data.target || !isAddress(q.data.target, { strict: false })) return res.status(400).json({ error: 'target wallet required' })
        scope = `authorize:${q.data.target.toLowerCase()}`
        break
      }
      case 'sandbox': {
        if (!cfg.SANDBOX_ENABLED) return res.status(404).json({ error: 'sandbox_disabled' })
        const preset = normalizeHandle(q.data.target ?? '')
        if (!(SANDBOX_PRESETS as readonly string[]).includes(preset)) return res.status(400).json({ error: 'unknown_preset' })
        scope = `sandbox:${preset}`
        break
      }
    }
    res.json(challenges.issue(wallet, scope))
  })

  /** A verified primary wallet authorizes one other wallet (which it also controls) to join its identity. */
  app.post('/api/authorize', async (req, res, next) => {
    try {
      const body = z.object({ primary: walletSchema, wallet: walletSchema, signature: sigSchema }).safeParse(req.body)
      if (!body.success) return res.status(400).json({ error: 'primary, wallet, signature required' })
      const primary = body.data.primary as Address
      const wallet = body.data.wallet as Address
      if (primary.toLowerCase() === wallet.toLowerCase()) return res.status(400).json({ error: 'same_wallet' })
      if (!(await qie.isVerified(primary))) return res.status(409).json({ error: 'not_verified' })
      // the identity being shared is whatever the primary is bound to on chain
      const identityId = await attestor.identityOf(primary)
      if (/^0x0+$/.test(identityId)) return res.status(409).json({ error: 'primary_not_bound' })
      const ok = await challenges.consume(primary, `authorize:${wallet.toLowerCase()}`, body.data.signature as Hex)
      if (!ok) return res.status(401).json({ error: 'wallet_signature_invalid_or_expired' })
      const expiresAt = authorizations.set(wallet, primary, identityId)
      res.json({ ok: true, wallet, primary, expiresAt })
    } catch (e) {
      next(e)
    }
  })

  /**
   * Verified identity + proven wallet control => a signed EIP-712 attestation for the registry.
   * If an authorization from a verified primary wallet is pending for this wallet, it joins that identity;
   * otherwise the wallet must itself be QIE-verified and becomes the primary of its own identity.
   */
  app.post('/api/attest', async (req, res, next) => {
    try {
      const body = z.object({ wallet: walletSchema, signature: sigSchema, requestId: z.string().min(1).max(200).optional() }).safeParse(req.body)
      if (!body.success) return res.status(400).json({ error: 'wallet, signature required' })
      const wallet = body.data.wallet as Address
      const signature = body.data.signature as Hex

      const auth = authorizations.get(wallet)
      if (auth) {
        if (!(await qie.isVerified(auth.primary))) return res.status(409).json({ error: 'not_verified' })
        if (!(await challenges.consume(wallet, `join:${auth.primary.toLowerCase()}`, signature))) return res.status(401).json({ error: 'wallet_signature_invalid_or_expired' })
        const signed = await sign(wallet, auth.identityId)
        authorizations.clear(wallet)
        return res.json({ ...signed, identityId: auth.identityId, via: 'join', primary: auth.primary, mode: qie.mode })
      }

      if (!(await qie.isVerified(wallet))) return res.status(409).json({ error: 'not_verified' })

      let identityId: Hex
      if (cfg.IDENTITY_ANCHOR === 'did') {
        // the DID comes only from a QIE request that THIS wallet's owner approved (or recovered on bind/start)
        const b = body.data.requestId ? liveBind(body.data.requestId, wallet) : undefined
        if (!b?.subject) return res.status(409).json({ error: 'consent_required' })
        if (!(await challenges.consume(wallet, 'self', signature))) return res.status(401).json({ error: 'wallet_signature_invalid_or_expired' })
        identityId = identityIdForDid(b.subject)
        binds.delete(body.data.requestId!) // single use
      } else {
        if (!(await challenges.consume(wallet, 'self', signature))) return res.status(401).json({ error: 'wallet_signature_invalid_or_expired' })
        identityId = identityIdForWallet(wallet)
      }
      const signed = await sign(wallet, identityId)
      res.json({ ...signed, identityId, via: 'self', primary: wallet, mode: qie.mode })
    } catch (e) {
      next(e)
    }
  })

  /** Judge Sandbox: testnet + mock only. One click, one wallet signature, no typing. */
  app.post('/api/sandbox/attest', async (req, res, next) => {
    try {
      if (!cfg.SANDBOX_ENABLED) return res.status(404).json({ error: 'sandbox_disabled' })
      const body = z.object({ wallet: walletSchema, preset: z.string().min(1).max(60), signature: sigSchema }).safeParse(req.body)
      if (!body.success) return res.status(400).json({ error: 'wallet, preset, signature required' })
      const preset = normalizeHandle(body.data.preset)
      if (!(SANDBOX_PRESETS as readonly string[]).includes(preset)) return res.status(400).json({ error: 'unknown_preset' })
      const wallet = body.data.wallet as Address
      if (!(await challenges.consume(wallet, `sandbox:${preset}`, body.data.signature as Hex))) return res.status(401).json({ error: 'wallet_signature_invalid_or_expired' })
      const signed = await sign(wallet, identityIdFor(preset))
      res.json({ ...signed, identityId: identityIdFor(preset), via: 'sandbox', preset, mode: qie.mode })
    } catch (e) {
      next(e)
    }
  })

  app.get('/api/events', (req, res) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), contract: z.enum(['registry', 'escrow', 'router', 'vault']).optional() }).safeParse(req.query)
    if (!q.success) return res.status(400).json({ error: 'bad query' })
    res.json({ nextBlock: indexer.nextBlock.toString(), events: indexer.recent(q.data.limit, q.data.contract) })
  })

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof QieApiError) {
      // QIE-side problem: bad partner keys, clock skew, suspended account...
      const sanitized = err.message.replace(/pk_[a-zA-Z0-9_]+/g, '[REDACTED]').replace(/sk_[a-zA-Z0-9_]+/g, '[REDACTED]')
      return res.status(502).json({ error: 'qie_api_error', detail: sanitized, status: err.status })
    }
    console.error('[error]', err instanceof Error ? err.message : err)
    res.status(500).json({ error: 'internal_error' })
  })

  return app
}
