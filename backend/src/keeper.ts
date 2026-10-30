import { formatEther, type Address, type Hex } from 'viem'
import { escrowAbi } from './abi.js'

export interface KeeperClient {
  readContract: (args: { address: Address; abi: any; functionName: string; args?: any[] }) => Promise<any>
  getBalance: (args: { address: Address }) => Promise<bigint>
  waitForTransactionReceipt?: (args: { hash: Hex }) => Promise<any>
}

export interface KeeperWalletClient {
  writeContract: (args: any) => Promise<Hex>
}

export interface KeeperLogger {
  log: (msg: string) => void
  warn: (msg: string) => void
  error: (msg: string) => void
}

export interface KeeperOptions {
  escrowAddress: Address
  account: { address: Address }
  client: KeeperClient
  walletClient: KeeperWalletClient
  minGasBalance?: bigint
  pollIntervalMs?: number
  logger?: KeeperLogger
  now?: () => number
}

export interface PollResult {
  scanned: number
  defaulted: number
  skippedLowGas: boolean
}

export class Keeper {
  readonly escrowAddress: Address
  readonly account: { address: Address }
  private readonly client: KeeperClient
  private readonly walletClient: KeeperWalletClient
  readonly minGasBalance: bigint
  readonly pollIntervalMs: number
  private readonly logger: KeeperLogger
  private readonly now: () => number

  private timer?: NodeJS.Timeout
  private scanning = false
  private readonly terminalAgreements = new Set<string>()

  constructor(opts: KeeperOptions) {
    this.escrowAddress = opts.escrowAddress
    this.account = opts.account
    this.client = opts.client
    this.walletClient = opts.walletClient
    this.minGasBalance = opts.minGasBalance ?? 1_000_000_000_000_000n // 0.001 QIE default
    this.pollIntervalMs = opts.pollIntervalMs ?? 15_000
    this.logger = opts.logger ?? console
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000))
  }

  start(): void {
    if (this.timer) return
    this.logger.log(`[keeper] Started scanning escrow ${this.escrowAddress} with keeper account ${this.account.address}`)
    void this.poll()
    this.timer = setInterval(() => {
      void this.poll()
    }, this.pollIntervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  async poll(): Promise<PollResult> {
    if (this.scanning) {
      return { scanned: 0, defaulted: 0, skippedLowGas: false }
    }
    this.scanning = true

    try {
      // 1. Gas-balance check: warning in logs and skip, not crash, when low
      const balance = await this.client.getBalance({ address: this.account.address })
      if (balance < this.minGasBalance) {
        this.logger.warn(
          `[keeper] Low gas balance: ${formatEther(balance)} QIE (min: ${formatEther(this.minGasBalance)} QIE). Skipping default scan.`,
        )
        return { scanned: 0, defaulted: 0, skippedLowGas: true }
      }

      // 2. Query nextAgreementId
      const nextId = BigInt(
        await this.client.readContract({
          address: this.escrowAddress,
          abi: escrowAbi,
          functionName: 'nextAgreementId',
        }),
      )

      let scanned = 0
      let defaulted = 0

      // 3. Scan agreements from 1 to nextId - 1
      for (let id = 1n; id < nextId; id++) {
        const idKey = id.toString()
        if (this.terminalAgreements.has(idKey)) continue

        const agreement = await this.client.readContract({
          address: this.escrowAddress,
          abi: escrowAbi,
          functionName: 'getAgreement',
          args: [id],
        })

        const status = Number(agreement?.status ?? agreement?.[8] ?? 0)
        const deadline = BigInt(agreement?.deadline ?? agreement?.[7] ?? 0n)

        // Status 2 (Settled) or 3 (Defaulted) are terminal
        if (status === 2 || status === 3) {
          this.terminalAgreements.add(idKey)
          continue
        }

        // Status 1 is Open
        if (status === 1) {
          scanned++
          const currentTimestamp = BigInt(this.now())
          if (currentTimestamp > deadline) {
            try {
              const hash = await this.walletClient.writeContract({
                address: this.escrowAddress,
                abi: escrowAbi,
                functionName: 'triggerDefault',
                args: [id],
                account: this.account,
              })
              this.logger.log(`[keeper] Triggered default for agreement #${id}: tx=${hash}`)
              if (this.client.waitForTransactionReceipt) {
                await this.client.waitForTransactionReceipt({ hash })
              }
              this.terminalAgreements.add(idKey)
              defaulted++
            } catch (err) {
              this.logger.error(
                `[keeper] Failed to trigger default for agreement #${id}: ${err instanceof Error ? err.message : String(err)}`,
              )
            }
          }
        }
      }

      return { scanned, defaulted, skippedLowGas: false }
    } catch (err) {
      this.logger.error(`[keeper] Poll scan error: ${err instanceof Error ? err.message : String(err)}`)
      return { scanned: 0, defaulted: 0, skippedLowGas: false }
    } finally {
      this.scanning = false
    }
  }
}
