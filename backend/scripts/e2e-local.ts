/**
 * End-to-end rehearsal of the Judge Sandbox against a LOCAL chain (anvil --chain-id 1983) with the real contracts
 * and the real relayer code (mock QIE Pass). It proves the whole pipeline, not just the pieces:
 *
 *   QIE Pass is-verified (mock) -> wallet challenge -> EIP-712 attestation -> registry.linkWallet (Wallet A = primary),
 *   Wallet B joins via the primary's authorization
 *   -> 500 QIE deal at the 10% tier -> real 15s wait -> triggerDefault -> 450 debt
 *   -> 1,000 QIE routed to Wallet B -> 450 garnished, 550 lands, identity solvent.
 *
 *   anvil --port 8546 --chain-id 1983
 *   (cd contracts && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8546 --broadcast)
 *   npm run e2e
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import { createPublicClient, createWalletClient, formatEther, http, parseEther, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { escrowAbi, registryAbi, routerAbi } from '../src/abi.js'
import { createApp } from '../src/app.js'
import { Attestor } from '../src/attest.js'
import { ChallengeStore } from '../src/challenge.js'
import { loadConfig } from '../src/config.js'
import { Indexer } from '../src/indexer.js'
import { identityIdForDid } from '../src/identity.js'
import { MockQieClient } from '../src/qie/client.js'

const RPC = process.env.E2E_RPC ?? 'http://127.0.0.1:8546'
const here = dirname(fileURLToPath(import.meta.url))
const dep = JSON.parse(readFileSync(resolve(here, '../../deployments/1983.json'), 'utf8')) as Record<string, string>

// anvil's well-known dev keys (LOCAL ONLY)
const keys = {
  owner: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  attestor: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  walletA: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  walletB: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  merchant: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  payer: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
} as const

const acct = Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, privateKeyToAccount(v)])) as Record<keyof typeof keys, ReturnType<typeof privateKeyToAccount>>

// the deployment used anvil account #1 (0x7099...) as attestor; the relayer here signs with #2, so authorise it
const publicClient = createPublicClient({ transport: http(RPC) })
const wallet = (k: keyof typeof keys) => createWalletClient({ account: acct[k], transport: http(RPC) })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const eth = (n: bigint) => `${formatEther(n)} QIE`
let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}
async function send(hash: Hex) {
  const r = await publicClient.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`tx reverted: ${hash}`)
  return r
}

const verifierAbi = [{ type: 'function', name: 'setAttestor', stateMutability: 'nonpayable', inputs: [{ name: 'attestor', type: 'address' }, { name: 'allowed', type: 'bool' }], outputs: [] }] as const

async function main() {
  const chainId = await publicClient.getChainId()
  if (chainId !== 1983) throw new Error(`expected chain 1983, got ${chainId}`)
  console.log(`\nAlibi e2e on local chain ${chainId}  registry=${dep.registry}\n`)

  // authorise the relayer key as an attestor (owner action)
  await send(await wallet('owner').writeContract({ address: dep.verifier as Address, abi: verifierAbi, functionName: 'setAttestor', args: [acct.attestor.address, true], chain: null }))

  // real relayer code, in-process
  const cfg = loadConfig({
    VERIFIER_ADDRESS: dep.verifier, REGISTRY_ADDRESS: dep.registry, ESCROW_ADDRESS: dep.escrow, ROUTER_ADDRESS: dep.router,
    ATTESTOR_PRIVATE_KEY: keys.attestor, CHAIN_ID: '1983', RPC_URL: RPC, QIE_MODE: 'mock', CORS_ORIGIN: '*',
  } as NodeJS.ProcessEnv)
  const attestor = new Attestor(cfg.ATTESTOR_PRIVATE_KEY as Hex, 1983, cfg.VERIFIER_ADDRESS as Address, cfg.REGISTRY_ADDRESS as Address, publicClient)
  const indexer = Indexer.forAddresses(publicClient, { registry: dep.registry as Address, escrow: dep.escrow as Address, router: dep.router as Address }, 0n)
  const app = createApp({ cfg, qie: new MockQieClient(), attestor, indexer, challenges: new ChallengeStore(1983) })
  const server = app.listen(0)
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = async (p: string, b: unknown) => (await fetch(api + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json() as Promise<any>

  try {
    // ---- Step 1: one verified primary wallet, a second wallet that joins it
    console.log('Step 1  Bind Wallet A (QIE-verified) and Wallet B (authorized by A) to one identity')
    const identityId = identityIdForDid(`did:qie:mock:${acct.walletA.address.toLowerCase()}`)
    const status = (await (await fetch(`${api}/api/pass-status?wallet=${acct.walletA.address}`)).json()) as { isVerified: boolean }
    check('QIE Pass (mock) reports Wallet A verified', status.isVerified)

    const getJson = async (path: string) => (await (await fetch(api + path)).json()) as any
    const sig = async (w: keyof typeof keys, qs: string) => acct[w].signMessage({ message: (await getJson(`/api/challenge?wallet=${acct[w].address}&${qs}`)).message })
    const linkOnChain = async (w: keyof typeof keys, att: any) => {
      const a = att.attestation
      await send(
        await wallet(w).writeContract({
          address: dep.registry as Address, abi: registryAbi, functionName: 'linkWallet', chain: null,
          args: [{ wallet: a.wallet, identityId: a.identityId, kycVerified: a.kycVerified, issuedAt: BigInt(a.issuedAt), expiresAt: BigInt(a.expiresAt), nonce: BigInt(a.nonce) }, att.signature],
        }),
      )
    }

    // DID anchor: consent in QIE Wallet (mock approves at once) -> QIE-validated credential -> wallet signature -> attestation
    const started = await post('/api/bind/start', { wallet: acct.walletA.address })
    const consent = await getJson(`/api/bind/status?wallet=${acct.walletA.address}&requestId=${started.requestId}`)
    check('QIE consent approved and credential claimed', consent.status === 'ready')
    await linkOnChain('walletA', await post('/api/attest', { wallet: acct.walletA.address, signature: await sig('walletA', 'purpose=self'), requestId: started.requestId }))
    const auth = await post('/api/authorize', { primary: acct.walletA.address, wallet: acct.walletB.address, signature: await sig('walletA', `purpose=authorize&target=${acct.walletB.address}`) })
    check('Wallet A authorized Wallet B to join its identity', auth.ok === true)
    await linkOnChain('walletB', await post('/api/attest', { wallet: acct.walletB.address, signature: await sig('walletB', 'purpose=join') }))
    const idA = await publicClient.readContract({ address: dep.registry as Address, abi: registryAbi, functionName: 'identityOf', args: [acct.walletA.address] })
    const idB = await publicClient.readContract({ address: dep.registry as Address, abi: registryAbi, functionName: 'identityOf', args: [acct.walletB.address] })
    check('both wallets resolve to the same identity', idA === identityId && idB === identityId)

    // a fresh identity must NOT get cheap credit
    const [freshBond] = await publicClient.readContract({ address: dep.registry as Address, abi: registryAbi, functionName: 'quoteBond', args: [identityId, '0x0000000000000000000000000000000000000000', parseEther('500')] })
    check('fresh verified identity must post 100% (no free leverage)', freshBond === parseEther('500'), eth(freshBond))

    // demo-only: seed the demo identity's reputation (public event; disabled forever before mainnet launch)
    const since = BigInt(Math.floor(Date.now() / 1000) - 31 * 86400)
    await send(await wallet('owner').writeContract({ address: dep.registry as Address, abi: registryAbi, functionName: 'seedReputation', args: [identityId, 10, 4, since], chain: null }))
    const [bond] = await publicClient.readContract({ address: dep.registry as Address, abi: registryAbi, functionName: 'quoteBond', args: [identityId, '0x0000000000000000000000000000000000000000', parseEther('500')] })
    check('seeded demo identity unlocks the 10% bond tier', bond === parseEther('50'), eth(bond))

    // ---- Step 2: 500 QIE deal, real 15 second deadline, real default
    console.log('\nStep 2  Open a 500 QIE deal from Wallet A, let 15s elapse, trigger default')
    const merchantBefore = await publicClient.getBalance({ address: acct.merchant.address })
    const create = await send(await wallet('walletA').writeContract({ address: dep.escrow as Address, abi: escrowAbi, functionName: 'createAgreement', args: [acct.merchant.address, '0x0000000000000000000000000000000000000000', parseEther('500'), 15n], value: bond, chain: null }))
    check('agreement opened with a 50 QIE bond', create.status === 'success')
    process.stdout.write('        waiting 16s for the real deadline')
    for (let i = 0; i < 16; i++) { await sleep(1000); process.stdout.write('.') }
    console.log()
    await send(await wallet('payer').writeContract({ address: dep.escrow as Address, abi: escrowAbi, functionName: 'triggerDefault', args: [1n], chain: null }))
    const debt = await publicClient.readContract({ address: dep.registry as Address, abi: registryAbi, functionName: 'debtOutstanding', args: [identityId, '0x0000000000000000000000000000000000000000'] })
    check('default recorded 450 QIE of debt on the identity', debt === parseEther('450'), eth(debt))

    // ---- Step 3: pay Wallet B through the router
    console.log('\nStep 3  1,000 QIE is routed to the brand-new Wallet B')
    const mBefore = await publicClient.getBalance({ address: acct.merchant.address })
    const bBefore = await publicClient.getBalance({ address: acct.walletB.address })
    const [prevG, prevN] = await publicClient.readContract({ address: dep.router as Address, abi: routerAbi, functionName: 'previewSplit', args: [acct.walletB.address, '0x0000000000000000000000000000000000000000', parseEther('1000')] })
    check('previewSplit predicts 450 / 550', prevG === parseEther('450') && prevN === parseEther('550'))
    await send(await wallet('payer').writeContract({ address: dep.router as Address, abi: routerAbi, functionName: 'routePayment', args: [acct.walletB.address, '0x0000000000000000000000000000000000000000', parseEther('1000')], value: parseEther('1000'), chain: null }))
    const mAfter = await publicClient.getBalance({ address: acct.merchant.address })
    const bAfter = await publicClient.getBalance({ address: acct.walletB.address })
    check('creditor garnished exactly 450 QIE', mAfter - mBefore === parseEther('450'), eth(mAfter - mBefore))
    check('550 QIE lands in Wallet B', bAfter - bBefore === parseEther('550'), eth(bAfter - bBefore))
    const solvent = !(await publicClient.readContract({ address: dep.registry as Address, abi: registryAbi, functionName: 'hasActiveDebt', args: [identityId] }))
    check('identity restored to solvent', solvent)
    console.log(`        (creditor total over the whole story: ${eth(mAfter - merchantBefore)}; 0.25 QIE went to the keeper)`)

    // ---- indexer sees it
    await indexer.poll()
    if (indexer.lastError) console.log('        indexer error:', indexer.lastError)
    const names = indexer.recent(100).map((e) => e.event)
    check('indexer captured the garnishment and default events', names.includes('CrossWalletGarnishmentExecuted') && names.includes('AgreementDefaulted'), names.slice(0, 6).join(', '))
  } finally {
    server.close()
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
