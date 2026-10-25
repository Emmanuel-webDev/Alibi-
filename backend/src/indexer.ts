import type { Abi, Address, PublicClient } from 'viem'
import { escrowAbi, registryAbi, routerAbi, vaultAbi } from './abi.js'

export interface IndexedEvent {
  contract: 'registry' | 'escrow' | 'router' | 'vault'
  event: string
  blockNumber: string
  txHash: string
  logIndex: number
  args: Record<string, unknown>
}

const jsonSafe = (v: unknown): unknown => {
  if (typeof v === 'bigint') return v.toString()
  if (Array.isArray(v)) return v.map(jsonSafe)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x)]))
  return v
}

/** Events worth showing in the live feed. */
const WATCHED: Record<IndexedEvent['contract'], Set<string>> = {
  registry: new Set(['WalletLinked', 'DefaultRecorded', 'DebtConsumed', 'StakeSlashed', 'ReputationUpdated', 'ReputationSeeded']),
  escrow: new Set(['AgreementCreated', 'AgreementSettled', 'AgreementDefaulted']),
  router: new Set(['CrossWalletGarnishmentExecuted', 'PaymentRouted']),
  vault: new Set(['Withdrawn', 'GrantClaimed']),
}

/**
 * A small, dependency-free log indexer: polls the Alibi contracts in bounded block chunks and keeps the most recent
 * events in memory for the dashboard's live feed. The frontend also watches chain events directly; this exists so the
 * history survives a page reload and so judges can curl it.
 */
export class Indexer {
  private readonly events: IndexedEvent[] = []
  private cursor: bigint
  private timer?: NodeJS.Timeout
  private running = false
  lastError?: string

  constructor(
    private readonly client: Pick<PublicClient, 'getBlockNumber' | 'getContractEvents'>,
    private readonly contracts: { name: IndexedEvent['contract']; address: Address; abi: Abi }[],
    startBlock: bigint,
    private readonly maxEvents = 1000,
    private readonly chunk = 2000n,
  ) {
    this.cursor = startBlock
  }

  static forAddresses(
    client: Pick<PublicClient, 'getBlockNumber' | 'getContractEvents'>,
    a: { registry: Address; escrow: Address; router: Address; vault?: Address },
    startBlock: bigint,
  ) {
    const contracts: { name: IndexedEvent['contract']; address: Address; abi: Abi }[] = [
      { name: 'registry', address: a.registry, abi: registryAbi as Abi },
      { name: 'escrow', address: a.escrow, abi: escrowAbi as Abi },
      { name: 'router', address: a.router, abi: routerAbi as Abi },
    ]
    if (a.vault) contracts.push({ name: 'vault', address: a.vault, abi: vaultAbi as Abi })
    return new Indexer(client, contracts, startBlock)
  }

  /** Index everything from the cursor to the chain head. Safe to call repeatedly. */
  async poll(): Promise<number> {
    if (this.running) return 0
    this.running = true
    let added = 0
    try {
      const head = await this.client.getBlockNumber({ cacheTime: 0 }) // viem caches the head for ~4s by default; a stale head would skip the newest blocks
      while (this.cursor <= head) {
        const to = this.cursor + this.chunk - 1n < head ? this.cursor + this.chunk - 1n : head
        // collect the whole chunk first: if any contract's query fails, nothing from this chunk is kept, so a retry cannot double-count
        const found: IndexedEvent[] = []
        for (const c of this.contracts) {
          const logs = await this.client.getContractEvents({ address: c.address, abi: c.abi, fromBlock: this.cursor, toBlock: to })
          for (const l of logs) {
            const name = (l as { eventName?: string }).eventName
            if (!name || !WATCHED[c.name].has(name)) continue
            found.push({
              contract: c.name,
              event: name,
              blockNumber: String(l.blockNumber),
              txHash: String(l.transactionHash),
              logIndex: Number(l.logIndex),
              args: jsonSafe((l as { args?: unknown }).args ?? {}) as Record<string, unknown>,
            })
          }
        }
        this.events.push(...found)
        added += found.length
        this.cursor = to + 1n
      }
      this.events.sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || a.logIndex - b.logIndex)
      if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents)
      this.lastError = undefined
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
    } finally {
      this.running = false
    }
    return added
  }

  start(intervalMs = 4000) {
    void this.poll()
    this.timer = setInterval(() => void this.poll(), intervalMs)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
  }

  recent(limit = 50, contract?: string): IndexedEvent[] {
    const list = contract ? this.events.filter((e) => e.contract === contract) : this.events
    return list.slice(-limit).reverse()
  }

  get nextBlock(): bigint {
    return this.cursor
  }
}
