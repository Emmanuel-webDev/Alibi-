import { createPublicClient, http } from 'viem'
import { loadConfig } from './config.js'
import { Attestor } from './attest.js'
import { ChallengeStore } from './challenge.js'
import { createApp } from './app.js'
import { Indexer } from './indexer.js'
import { createQieClient } from './qie/client.js'
import { Keeper } from './keeper.js'
import { createWalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const cfg = loadConfig()
const client = createPublicClient({ transport: http(cfg.RPC_URL) })

// sanity check: the RPC must be the chain the contracts were deployed to
const actualChain = await client.getChainId()
if (actualChain !== cfg.CHAIN_ID) {
  throw new Error(`RPC reports chain ${actualChain} but CHAIN_ID=${cfg.CHAIN_ID}. Refusing to start (wrong network).`)
}

const attestor = new Attestor(cfg.ATTESTOR_PRIVATE_KEY as `0x${string}`, cfg.CHAIN_ID, cfg.VERIFIER_ADDRESS as `0x${string}`, cfg.REGISTRY_ADDRESS as `0x${string}`, client)

const indexer = Indexer.forAddresses(
  client,
  {
    registry: cfg.REGISTRY_ADDRESS as `0x${string}`,
    escrow: cfg.ESCROW_ADDRESS as `0x${string}`,
    router: cfg.ROUTER_ADDRESS as `0x${string}`,
    vault: cfg.VAULT_ADDRESS as `0x${string}` | undefined,
  },
  cfg.START_BLOCK,
)
indexer.start()

if (cfg.KEEPER_ENABLED && cfg.KEEPER_PRIVATE_KEY) {
  const keeperAccount = privateKeyToAccount(cfg.KEEPER_PRIVATE_KEY as `0x${string}`)
  const walletClient = createWalletClient({
    account: keeperAccount,
    transport: http(cfg.RPC_URL),
  })
  const keeper = new Keeper({
    escrowAddress: cfg.ESCROW_ADDRESS as `0x${string}`,
    account: keeperAccount,
    client,
    walletClient,
    minGasBalance: cfg.KEEPER_MIN_GAS_WEI,
    pollIntervalMs: cfg.KEEPER_POLL_INTERVAL_MS,
  })
  keeper.start()
}

const qie = createQieClient(cfg)
const app = createApp({ cfg, qie, attestor, indexer, challenges: new ChallengeStore(cfg.CHAIN_ID) })

app.listen(cfg.PORT, () => {
  console.log(`Alibi relayer on :${cfg.PORT}  chain=${cfg.CHAIN_ID}  qie=${qie.mode}  attestor=${attestor.address}`)
  if (qie.mode === 'mock') console.log('!! QIE_MODE=mock: identities are NOT verified by QIE Pass. Local/demo use only.')
})
