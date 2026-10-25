import 'dotenv/config'
import { z } from 'zod'

const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'must be a 0x address')
const privateKey = z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'must be a 0x-prefixed 32-byte hex key')

const schema = z
  .object({
    PORT: z.coerce.number().int().default(8787),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),

    // chain
    CHAIN_ID: z.coerce.number().int().default(1983),
    RPC_URL: z.string().url().default('https://rpc2testnet.qie.digital/'),
    START_BLOCK: z.coerce.bigint().default(0n),

    // contracts (written by `forge script Deploy`; see deployments/<chainId>.json)
    VERIFIER_ADDRESS: address,
    REGISTRY_ADDRESS: address,
    ESCROW_ADDRESS: address,
    ROUTER_ADDRESS: address,
    VAULT_ADDRESS: address.optional(),

    // the attestor key signs EIP-712 attestations. Treat it like a production signing key.
    ATTESTOR_PRIVATE_KEY: privateKey,
    ATTESTATION_TTL_SECONDS: z.coerce.number().int().min(60).max(30 * 24 * 3600).default(7 * 24 * 3600),
    AUTHORIZATION_TTL_SECONDS: z.coerce.number().int().min(60).default(1800),

    // QIE Pass partner API (host only; paths start with /api/v1). Sandbox (pk_test_) and production (pk_live_) use different hosts.
    QIE_MODE: z.enum(['mock', 'live']).default('mock'),
    QIE_BASE_URL: z.string().url().default('https://pass-api.qie.digital'),
    QIE_PUBLIC_KEY: z.string().optional(),
    QIE_SECRET_KEY: z.string().optional(),
    /** did = anchor on QIE Pass's per-person DID (needs the user to approve in QIE Wallet once). wallet = anchor on the verified wallet. */
    IDENTITY_ANCHOR: z.enum(['did', 'wallet']).default('did'),
    /** mock mode only: comma-separated wallets that report as NOT verified (to demo the verification gate) */
    MOCK_UNVERIFIED_WALLETS: z
      .string()
      .default('')
      .transform((s) => s.split(',').map((a) => a.trim()).filter(Boolean)),
    /** Judge Sandbox: testnet-only endpoint that issues demo-identity attestations. Never enable anywhere real. */
    SANDBOX_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    /** Persistent store for wallet -> { requestId, did, createdAt } mapping */
    QIE_STORE_PATH: z.string().default('data/identities.json'),

    // keeper: optional bot that triggers defaults on expired agreements
    KEEPER_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    KEEPER_PRIVATE_KEY: privateKey.optional(),
    KEEPER_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).default(15000),
    KEEPER_MIN_GAS_WEI: z.coerce.bigint().default(1000000000000000n), // 0.001 QIE
  })
  .superRefine((v, ctx) => {
    if (v.SANDBOX_ENABLED && (v.QIE_MODE !== 'mock' || v.CHAIN_ID !== 1983)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SANDBOX_ENABLED requires QIE_MODE=mock and CHAIN_ID=1983 (testnet only)', path: ['SANDBOX_ENABLED'] })
    }
    if (v.QIE_MODE === 'live' && (!v.QIE_PUBLIC_KEY || !v.QIE_SECRET_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'QIE_MODE=live requires QIE_PUBLIC_KEY and QIE_SECRET_KEY',
        path: ['QIE_PUBLIC_KEY'],
      })
    }
    if (v.KEEPER_ENABLED) {
      if (!v.KEEPER_PRIVATE_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'KEEPER_ENABLED=true requires KEEPER_PRIVATE_KEY',
          path: ['KEEPER_PRIVATE_KEY'],
        })
      } else if (v.KEEPER_PRIVATE_KEY.toLowerCase() === v.ATTESTOR_PRIVATE_KEY.toLowerCase()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'KEEPER_PRIVATE_KEY must not be the same as ATTESTOR_PRIVATE_KEY',
          path: ['KEEPER_PRIVATE_KEY'],
        })
      }
    }
  })

export type Config = z.infer<typeof schema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`)
  }
  return parsed.data
}
