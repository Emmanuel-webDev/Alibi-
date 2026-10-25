import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface StoredIdentity {
  wallet: string
  requestId: string
  did: string
  createdAt: number
}

export class IdentityStore {
  private readonly entries = new Map<string, StoredIdentity>()

  constructor(private readonly filePath?: string) {
    this.load()
  }

  load(): void {
    if (!this.filePath) return
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf8')
        const data = JSON.parse(raw)
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item && typeof item.wallet === 'string' && typeof item.did === 'string') {
              this.entries.set(item.wallet.toLowerCase(), {
                wallet: item.wallet.toLowerCase(),
                requestId: String(item.requestId ?? ''),
                did: String(item.did),
                createdAt: Number(item.createdAt ?? Date.now()),
              })
            }
          }
        }
      }
    } catch {
      // ignore parse or read errors
    }
  }

  save(): void {
    if (!this.filePath) return
    try {
      const dir = dirname(this.filePath)
      if (dir && !existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      const data = Array.from(this.entries.values())
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8')
    } catch {
      // ignore write errors
    }
  }

  get(wallet: string): StoredIdentity | undefined {
    return this.entries.get(wallet.toLowerCase())
  }

  set(wallet: string, data: { requestId: string; did: string }): void {
    this.entries.set(wallet.toLowerCase(), {
      wallet: wallet.toLowerCase(),
      requestId: data.requestId,
      did: data.did,
      createdAt: Date.now(),
    })
    this.save()
  }

  has(wallet: string): boolean {
    return this.entries.has(wallet.toLowerCase())
  }

  all(): StoredIdentity[] {
    return Array.from(this.entries.values())
  }
}
