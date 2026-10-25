import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const accountState = vi.hoisted(() => ({
  address: undefined as `0x${string}` | undefined,
  isConnected: false,
}))

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: accountState.address,
    isConnected: accountState.isConnected,
    chainId: 1983,
  }),
  useConnect: () => ({
    connect: vi.fn(),
    connectors: [{ id: 'injected', name: 'Injected' }],
    isPending: false,
    error: null,
  }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }),
  useReadContract: () => ({ data: undefined, isLoading: false }),
  useReadContracts: () => ({ data: undefined, isLoading: false }),
  usePublicClient: () => ({ waitForTransactionReceipt: vi.fn() }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
  useWriteContract: () => ({ writeContractAsync: vi.fn() }),
}))

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '../App'
import { LandingPage } from '../components/LandingPage'
import { REAL_TIER_CONFIG, getStaticTierRows } from '../config/tiers'

const testQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

afterEach(() => {
  cleanup()
  accountState.address = undefined
  accountState.isConnected = false
  window.history.pushState(null, '', '/')
})

describe('LandingPage', () => {
  it('renders without a wallet connected and displays hero sentence and live testnet status', () => {
    accountState.isConnected = false
    accountState.address = undefined

    render(<LandingPage onNavigate={vi.fn()} />)

    // Hero plain sentence (exact phrasing requirement)
    expect(
      screen.getByText(
        'Alibi lets a verified person borrow or pay with less than full collateral, because their credit follows their QIE Pass identity and not a single wallet.',
      ),
    ).toBeTruthy()

    // Key headings
    expect(screen.getByRole('heading', { name: 'Debt follows the person, not the wallet.' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'The problem' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Who it is for' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'What you need to use it' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Tiers' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Creditor rules' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Honest limits' })).toBeTruthy()

    // Prerequisite plain statement
    expect(screen.getByText('Unverified wallets cannot use credit.')).toBeTruthy()

    // Two problem paragraphs
    expect(screen.getByText(/DeFi needs 150% collateral because it can’t tell one person from many wallets/)).toBeTruthy()
    expect(screen.getByText(/Alibi uses QIE Pass to tie a credit limit to one verified person/)).toBeTruthy()

    // Numbered how-it-works sequence
    expect(screen.getByText(/Verify with QIE Pass/)).toBeTruthy()
    expect(screen.getByText(/Bind your wallet to your identity/)).toBeTruthy()
    expect(screen.getByText(/Optionally authorize other wallets to join the same identity/)).toBeTruthy()
    expect(screen.getByText(/Open an agreement with a bond set by your tier/)).toBeTruthy()
    expect(screen.getByText(/Settle on time to build reputation, or default and lose the bond and the tier/)).toBeTruthy()
    expect(screen.getByText(/If you default, payments routed through Alibi are garnished to repay the creditor/)).toBeTruthy()

    // Honest limits
    expect(screen.getByText('The contracts are unaudited and this is a testnet build.')).toBeTruthy()
    expect(screen.getByText('Wallets you never bind are invisible to Alibi.')).toBeTruthy()
    expect(screen.getByText(/Friends who are each verified can still cooperate to extract up to their caps/)).toBeTruthy()
    expect(screen.getByText('The attestor key is trusted, and there is no recovery path yet.')).toBeTruthy()
    expect(screen.getByText('Credit limits are small by design.')).toBeTruthy()
  })

  it('"Launch app" goes to /app', () => {
    const onNavigate = vi.fn()
    render(<LandingPage onNavigate={onNavigate} />)

    // There is a primary Launch app button
    const launchBtns = screen.getAllByRole('button', { name: 'Launch app' })
    expect(launchBtns.length).toBeGreaterThanOrEqual(1)

    fireEvent.click(launchBtns[0]!)
    expect(onNavigate).toHaveBeenCalledWith('/app')
  })

  it('in full App, navigating to /app renders the app shell and "Launch app" triggers route change', () => {
    render(
      <QueryClientProvider client={testQueryClient}>
        <App />
      </QueryClientProvider>,
    )

    // Initially at /, renders LandingPage
    expect(screen.getByText(/Alibi lets a verified person borrow or pay with less than full collateral/)).toBeTruthy()

    // Click Launch app
    const launchBtn = screen.getByTestId('launch-app-btn')
    fireEvent.click(launchBtn)

    // URL is updated to /app
    expect(window.location.pathname).toBe('/app')
  })

  it('tier table matches the real config values', () => {
    render(<LandingPage onNavigate={vi.fn()} />)

    const table = screen.getByTestId('tier-table')
    expect(table).toBeTruthy()

    const staticRows = getStaticTierRows()
    expect(staticRows).toHaveLength(4)

    // Check Unverified
    expect(screen.getByRole('row', { name: /Unverified/ })).toBeTruthy()
    expect(table.textContent).toContain('100%')

    // Check New
    expect(screen.getByRole('row', { name: /New/ })).toBeTruthy()
    expect(table.textContent).toContain('10%')

    // Check Base
    const baseRow = screen.getByRole('row', { name: /Base/ })
    expect(baseRow.textContent).toContain(String(REAL_TIER_CONFIG.base.minDeals))
    expect(baseRow.textContent).toContain(String(REAL_TIER_CONFIG.base.minCounterparties))
    expect(baseRow.textContent).toContain('25%')
    expect(baseRow.textContent).toContain('50 QIE')

    // Check Proven
    const provenRow = screen.getByRole('row', { name: /Proven/ })
    expect(provenRow.textContent).toContain(String(REAL_TIER_CONFIG.proven.minDeals))
    expect(provenRow.textContent).toContain(String(REAL_TIER_CONFIG.proven.minCounterparties))
    expect(provenRow.textContent).toContain('10%')
    expect(provenRow.textContent).toContain('200 QIE')

    // Two mandatory lines
    expect(screen.getByText('Any default drops an identity back to New.')).toBeTruthy()
    expect(screen.getByText('Staking raises your limit on top of your tier cap.')).toBeTruthy()
  })

  it('there is no text input for an identity anywhere on the landing page', () => {
    render(<LandingPage onNavigate={vi.fn()} />)

    // No text inputs exist on the landing page
    const textInputs = document.querySelectorAll('input[type="text"], input:not([type])')
    expect(textInputs.length).toBe(0)

    // Entirely no inputs for identity
    const allInputs = document.querySelectorAll('input')
    expect(allInputs.length).toBe(0)
  })

  it('creditor rules button navigates to the creditor rules panel in /app', () => {
    const onNavigate = vi.fn()
    render(<LandingPage onNavigate={onNavigate} />)

    const rulesBtn = screen.getByRole('button', { name: /Open creditor rules panel/ })
    expect(rulesBtn).toBeTruthy()

    fireEvent.click(rulesBtn)
    expect(onNavigate).toHaveBeenCalledWith('/app?tab=agreements#creditor-rules')
  })
})
