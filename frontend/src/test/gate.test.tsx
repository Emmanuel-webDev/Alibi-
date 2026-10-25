import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ value: { state: 'unverified', pass: undefined as unknown, error: undefined as string | undefined, recheck: vi.fn() }, sandbox: { available: false, presets: [] as string[], on: false, setOn: vi.fn() } }))
const wallet = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

vi.mock('wagmi', () => ({ useAccount: () => ({ address: wallet, isConnected: true }) }))
vi.mock('../hooks/useQiePassIdentity', () => ({ useQiePassIdentity: () => state.value }))
vi.mock('../hooks/useBind', () => ({ useBind: () => ({ state: { step: 'idle' }, bind: vi.fn(), authorize: vi.fn(), reset: vi.fn() }) }))
vi.mock('../hooks/useSandbox', () => ({ useSandbox: () => state.sandbox }))

import { QiePassVerificationGate, verifyUrl } from '../components/QiePassVerificationGate'

afterEach(() => {
  cleanup()
  state.value = { state: 'unverified', pass: undefined, error: undefined, recheck: vi.fn() }
  state.sandbox = { available: false, presets: [], on: false, setOn: vi.fn() }
})

describe('QiePassVerificationGate', () => {
  it('unverified: explains, links to QIE Pass, offers a re-check, and has no text input', () => {
    render(<QiePassVerificationGate />)
    expect(screen.getByText(/No verified QIE Pass found/)).toBeTruthy()
    const cta = screen.getByRole('link', { name: 'Verify with QIE Pass' }) as HTMLAnchorElement
    expect(cta.href.startsWith('https://id.qie.digital/verify')).toBe(true)
    expect(cta.href).toContain(`wallet=${wallet}`)
    expect(screen.getByRole('button', { name: 'Re-check verification status' })).toBeTruthy()
    expect(screen.getByText(/Already verified on another wallet/)).toBeTruthy()
    expect(document.querySelectorAll('input').length).toBe(0)
  })

  it('verified but not bound: one bind button, read-only identity, no input', () => {
    state.value = { state: 'verified', pass: { identityId: null, anchor: 'did' }, error: undefined, recheck: vi.fn() }
    render(<QiePassVerificationGate />)
    expect(screen.getByRole('button', { name: 'Bind this wallet to my QIE identity' })).toBeTruthy()
    expect(screen.getByText(/QIE Pass verified/)).toBeTruthy()
    expect(screen.getByText(/approve sharing your QIE identity in QIE Wallet/)).toBeTruthy()
    expect(document.querySelectorAll('input').length).toBe(0)
  })

  it('disconnected asks to connect', () => {
    state.value = { state: 'disconnected', pass: undefined, error: undefined, recheck: vi.fn() }
    render(<QiePassVerificationGate />)
    expect(screen.getByText(/Connect your QIE Wallet/)).toBeTruthy()
  })

  it('renders nothing once the wallet is bound', () => {
    state.value = { state: 'linked', pass: undefined, error: undefined, recheck: vi.fn() }
    const { container } = render(<QiePassVerificationGate />)
    expect(container.innerHTML).toBe('')
  })

  it('sandbox presets are one-click buttons only when sandbox mode is on', () => {
    state.sandbox = { available: true, presets: ['alice.qie', 'merchant.qie'], on: true, setOn: vi.fn() }
    render(<QiePassVerificationGate />)
    expect(screen.getByRole('button', { name: 'Simulate QIE Pass callback for merchant.qie' })).toBeTruthy()
    expect(document.querySelectorAll('input').length).toBe(0)
  })

  it('verify URL carries the wallet and a redirect', () => {
    expect(verifyUrl(wallet, 'http://localhost:5173')).toBe(`https://id.qie.digital/verify?wallet=${wallet}&redirect_uri=http%3A%2F%2Flocalhost%3A5173`)
  })

  it('error state shows the QIE error message directly', () => {
    state.value = { state: 'error', pass: undefined, error: 'QIE Pass: Verification failed', recheck: vi.fn() }
    render(<QiePassVerificationGate />)
    expect(screen.getByText('QIE Pass: Verification failed')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('friendly message shown when wallet is already verified on QIE Pass', () => {
    state.value = { state: 'error', pass: undefined, error: 'Your wallet is already verified with QIE Pass. Using your existing verified identity.', recheck: vi.fn() }
    render(<QiePassVerificationGate />)
    expect(screen.getByText(/Your wallet is already verified with QIE Pass/)).toBeTruthy()
  })
})
