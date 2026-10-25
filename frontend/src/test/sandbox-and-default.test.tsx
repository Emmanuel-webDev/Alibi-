import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const accountState = vi.hoisted(() => ({ address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' }))
const mockAgreements = vi.hoisted(() => ({ list: [] as any[] }))

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: accountState.address, isConnected: true }),
  useReadContract: () => ({ data: undefined }),
  useWriteContract: () => ({ writeContractAsync: vi.fn() }),
  usePublicClient: () => ({ waitForTransactionReceipt: vi.fn() }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
}))

vi.mock('../hooks/useAlibiIdentity', () => ({
  TIER_NAMES: ['Unverified', 'New', 'Base', 'Proven'],
  useAlibiIdentity: () => ({ identityId: '0x1234', linked: true, tier: 3, tierName: 'Proven', floorBps: 1000 }),
  useIdentityBalances: () => ({ debt: 0n, freeCapacity: 1000n }),
}))

vi.mock('../hooks/useAgreements', () => ({
  STATUS: { None: 0, Open: 1, Settled: 2, Defaulted: 3 },
  STATUS_LABEL: { 1: 'Open', 2: 'Settled', 3: 'Defaulted' },
  useAgreements: () => ({ mine: mockAgreements.list, loading: false }),
}))

vi.mock('../hooks/useNow', () => ({
  useNow: () => 1700000000,
}))

vi.mock('../hooks/useTx', () => ({
  useTx: () => ({ state: { busy: false }, run: vi.fn(), ensureAllowance: vi.fn(), writeContractAsync: vi.fn() }),
}))

import { JudgeSandbox } from '../components/JudgeSandbox'
import { CreditEscrowDashboard } from '../components/CreditEscrowDashboard'
import { NATIVE } from '../hooks/useAssets'

afterEach(() => {
  cleanup()
  accountState.address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  mockAgreements.list = []
})

describe('JudgeSandbox presets', () => {
  it('renders three preset buttons defaulting to 0.1 QIE with no free-text amount box', () => {
    render(<JudgeSandbox />)
    const b01 = screen.getByRole('button', { name: '0.1 QIE' })
    const b05 = screen.getByRole('button', { name: '0.5 QIE' })
    const b1 = screen.getByRole('button', { name: '1 QIE' })
    expect(b01).toBeTruthy()
    expect(b05).toBeTruthy()
    expect(b1).toBeTruthy()

    // Default is 0.1 QIE
    expect(screen.getByText(/Open a 0.1 QIE deal/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open the 0.1 QIE deal' })).toBeTruthy()

    // No free-text box for amount
    expect(document.querySelector('input[name="deal-size"]')).toBeNull()
    expect(document.querySelector('input[name="deal-amount"]')).toBeNull()

    // Clicking 0.5 QIE updates deal and payment title
    fireEvent.click(b05)
    expect(screen.getByText(/Open a 0.5 QIE deal/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open the 0.5 QIE deal' })).toBeTruthy()

    // Clicking 1 QIE updates deal
    fireEvent.click(b1)
    expect(screen.getByText(/Open a 1 QIE deal/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open the 1 QIE deal' })).toBeTruthy()
  })
})

describe('Default action in AgreementRow', () => {
  const expiredAgreement = {
    id: 1n,
    payer: '0x1111111111111111111111111111111111111111',
    creditor: '0x2222222222222222222222222222222222222222',
    asset: NATIVE.address,
    total: 1000000000000000000n,
    bond: 100000000000000000n,
    createdAt: 1699990000n,
    deadline: 1699999000n, // deadline < now (1700000000)
    status: 1, // Open
  }

  it('shows "Claim default and seize bond" ONLY to the creditor', () => {
    accountState.address = expiredAgreement.creditor
    mockAgreements.list = [expiredAgreement]

    render(<CreditEscrowDashboard assets={[NATIVE]} asset={NATIVE} setAsset={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Claim default and seize bond' })).toBeTruthy()
    expect(screen.queryByText('Past deadline, creditor can claim')).toBeNull()
  })

  it('shows borrower a plain status ("Past deadline, creditor can claim") instead of action button', () => {
    accountState.address = expiredAgreement.payer
    mockAgreements.list = [expiredAgreement]

    render(<CreditEscrowDashboard assets={[NATIVE]} asset={NATIVE} setAsset={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Claim default and seize bond' })).toBeNull()
    expect(screen.getByText('Past deadline, creditor can claim')).toBeTruthy()
  })
})
