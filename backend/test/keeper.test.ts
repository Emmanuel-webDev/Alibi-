import { describe, expect, it, vi } from 'vitest'
import { parseEther, type Address, type Hex } from 'viem'
import { Keeper, type KeeperClient, type KeeperWalletClient } from '../src/keeper.js'
import { loadConfig } from '../src/config.js'

describe('Keeper unit tests with fake chain client', () => {
  const escrowAddress: Address = '0x1111111111111111111111111111111111111111'
  const keeperAccount = { address: '0x2222222222222222222222222222222222222222' as Address }

  it('expired agreement gets defaulted', async () => {
    const writtenCalls: any[] = []

    const fakeClient: KeeperClient = {
      getBalance: async () => parseEther('1.0'), // Healthy balance (1 QIE)
      readContract: async ({ functionName, args }) => {
        if (functionName === 'nextAgreementId') return 2n // 1 agreement (id = 1)
        if (functionName === 'getAgreement' && args?.[0] === 1n) {
          return {
            payer: '0x3333333333333333333333333333333333333333',
            creditor: '0x4444444444444444444444444444444444444444',
            asset: '0x0000000000000000000000000000000000000000',
            payerIdentity: '0x1234',
            total: parseEther('10'),
            bond: parseEther('1'),
            createdAt: 1000n,
            deadline: 1500n, // expired relative to now = 2000
            status: 1, // Status.Open
          }
        }
        throw new Error(`Unexpected function ${functionName}`)
      },
      waitForTransactionReceipt: async () => ({ status: 'success' }),
    }

    const fakeWalletClient: KeeperWalletClient = {
      writeContract: async (args) => {
        writtenCalls.push(args)
        return '0xabcd1234' as Hex
      },
    }

    const logs: string[] = []
    const keeper = new Keeper({
      escrowAddress,
      account: keeperAccount,
      client: fakeClient,
      walletClient: fakeWalletClient,
      minGasBalance: parseEther('0.001'),
      now: () => 2000, // now > deadline (1500)
      logger: {
        log: (m) => logs.push(m),
        warn: (m) => logs.push(m),
        error: (m) => logs.push(m),
      },
    })

    const res = await keeper.poll()

    expect(res.scanned).toBe(1)
    expect(res.defaulted).toBe(1)
    expect(res.skippedLowGas).toBe(false)
    expect(writtenCalls).toHaveLength(1)
    expect(writtenCalls[0].functionName).toBe('triggerDefault')
    expect(writtenCalls[0].args).toEqual([1n])
  })

  it('settled agreement is ignored', async () => {
    const writtenCalls: any[] = []

    const fakeClient: KeeperClient = {
      getBalance: async () => parseEther('1.0'),
      readContract: async ({ functionName, args }) => {
        if (functionName === 'nextAgreementId') return 2n
        if (functionName === 'getAgreement' && args?.[0] === 1n) {
          return {
            payer: '0x3333333333333333333333333333333333333333',
            creditor: '0x4444444444444444444444444444444444444444',
            asset: '0x0000000000000000000000000000000000000000',
            payerIdentity: '0x1234',
            total: parseEther('10'),
            bond: parseEther('1'),
            createdAt: 1000n,
            deadline: 1500n,
            status: 2, // Status.Settled
          }
        }
        throw new Error(`Unexpected function ${functionName}`)
      },
    }

    const fakeWalletClient: KeeperWalletClient = {
      writeContract: async (args) => {
        writtenCalls.push(args)
        return '0xabcd1234' as Hex
      },
    }

    const keeper = new Keeper({
      escrowAddress,
      account: keeperAccount,
      client: fakeClient,
      walletClient: fakeWalletClient,
      minGasBalance: parseEther('0.001'),
      now: () => 2000,
    })

    const res = await keeper.poll()

    expect(res.scanned).toBe(0)
    expect(res.defaulted).toBe(0)
    expect(res.skippedLowGas).toBe(false)
    expect(writtenCalls).toHaveLength(0) // No default called for settled agreement
  })

  it('low gas balance skips without crashing and logs a warning', async () => {
    const writtenCalls: any[] = []
    const warnings: string[] = []

    const fakeClient: KeeperClient = {
      getBalance: async () => parseEther('0.00005'), // Below 0.001 QIE threshold
      readContract: async () => {
        throw new Error('Should not be called when balance is low')
      },
    }

    const fakeWalletClient: KeeperWalletClient = {
      writeContract: async (args) => {
        writtenCalls.push(args)
        return '0xabcd1234' as Hex
      },
    }

    const keeper = new Keeper({
      escrowAddress,
      account: keeperAccount,
      client: fakeClient,
      walletClient: fakeWalletClient,
      minGasBalance: parseEther('0.001'),
      logger: {
        log: () => {},
        warn: (m) => warnings.push(m),
        error: () => {},
      },
    })

    // Must not throw / crash
    const res = await keeper.poll()

    expect(res.skippedLowGas).toBe(true)
    expect(res.scanned).toBe(0)
    expect(res.defaulted).toBe(0)
    expect(writtenCalls).toHaveLength(0)
    expect(warnings.some((w) => w.includes('Low gas balance'))).toBe(true)
  })

  describe('Keeper config validation', () => {
    const baseEnv: NodeJS.ProcessEnv = {
      VERIFIER_ADDRESS: '0x1111111111111111111111111111111111111111',
      REGISTRY_ADDRESS: '0x2222222222222222222222222222222222222222',
      ESCROW_ADDRESS: '0x3333333333333333333333333333333333333333',
      ROUTER_ADDRESS: '0x4444444444444444444444444444444444444444',
      ATTESTOR_PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    }

    it('defaults KEEPER_ENABLED to false', () => {
      const cfg = loadConfig({ ...baseEnv })
      expect(cfg.KEEPER_ENABLED).toBe(false)
    })

    it('fails when KEEPER_ENABLED=true without KEEPER_PRIVATE_KEY', () => {
      expect(() => loadConfig({ ...baseEnv, KEEPER_ENABLED: 'true' })).toThrow(
        /KEEPER_ENABLED=true requires KEEPER_PRIVATE_KEY/,
      )
    })

    it('fails when KEEPER_PRIVATE_KEY is the same as ATTESTOR_PRIVATE_KEY', () => {
      expect(() =>
        loadConfig({
          ...baseEnv,
          KEEPER_ENABLED: 'true',
          KEEPER_PRIVATE_KEY: baseEnv.ATTESTOR_PRIVATE_KEY,
        }),
      ).toThrow(/KEEPER_PRIVATE_KEY must not be the same as ATTESTOR_PRIVATE_KEY/)
    })

    it('accepts distinct KEEPER_PRIVATE_KEY when KEEPER_ENABLED=true', () => {
      const cfg = loadConfig({
        ...baseEnv,
        KEEPER_ENABLED: 'true',
        KEEPER_PRIVATE_KEY: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      })
      expect(cfg.KEEPER_ENABLED).toBe(true)
      expect(cfg.KEEPER_PRIVATE_KEY).toBe('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
    })
  })
})
