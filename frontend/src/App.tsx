import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { parseEther } from 'viem'
import { ConnectBar } from './components/ConnectBar'
import { CreditEscrowDashboard } from './components/CreditEscrowDashboard'
import { IdentityPassportCard } from './components/IdentityPassportCard'
import { JudgeSandbox } from './components/JudgeSandbox'
import { LandingPage } from './components/LandingPage'
import { SlashingRouterWidget } from './components/SlashingRouterWidget'
import { SplitBar } from './components/SplitBar'
import { SandboxProvider, useSandbox } from './hooks/useSandbox'
import { Notice } from './components/ui'
import { contractsConfigured, isTestnet } from './config/env'
import { NATIVE, useAssets, type AssetInfo } from './hooks/useAssets'
import { useRouter } from './hooks/useRouter'
import { api } from './lib/api'

const TABS = [
  { id: 'identity', label: 'Identity' },
  { id: 'agreements', label: 'Agreements' },
  { id: 'pay', label: 'Pay' },
  { id: 'sandbox', label: 'Judge sandbox' },
] as const
type TabId = (typeof TABS)[number]['id']

function SandboxToggle() {
  const { available, on, setOn } = useSandbox()
  if (!available) return null
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full px-3 text-sm font-semibold text-ink hover:bg-paper">
      <input type="checkbox" className="h-4 w-4 accent-ink" checked={on} onChange={(e) => setOn(e.target.checked)} />
      Judge sandbox mode
    </label>
  )
}

function Shell({ onNavigate, initialTab, hash }: { onNavigate: (to: string) => void; initialTab?: string; hash?: string }) {
  const defaultTab: TabId = (initialTab && TABS.some((t) => t.id === initialTab) ? initialTab : hash?.includes('creditor-rules') ? 'agreements' : 'identity') as TabId
  const [tab, setTab] = useState<TabId>(defaultTab)
  const assets = useAssets()
  const [chosen, setChosen] = useState<AssetInfo>(NATIVE)
  const asset = assets.find((a) => a.address === chosen.address) ?? assets[0]!
  const relayer = useQuery({ queryKey: ['relayer-config'], queryFn: api.config, retry: false, refetchInterval: 30_000 })

  useEffect(() => {
    if (initialTab && TABS.some((t) => t.id === initialTab)) {
      setTab(initialTab as TabId)
    } else if (hash?.includes('creditor-rules')) {
      setTab('agreements')
    }
  }, [initialTab, hash])

  useEffect(() => {
    if (hash) {
      const id = hash.replace(/^#/, '')
      const el = document.getElementById(id)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' })
      }
    }
  }, [tab, hash])

  const selectTab = (t: TabId) => {
    setTab(t)
    onNavigate(`/app?tab=${t}`)
  }

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
      <a href="#main" className="sr-only rounded-full bg-ink px-4 py-2 font-semibold text-shell focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50">
        Skip to content
      </a>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 py-5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate('/')}
            className="font-display text-2xl font-bold tracking-tight text-ink hover:opacity-80 transition-opacity"
            title="Return to landing page"
          >
            Alibi
          </button>
          <button
            onClick={() => onNavigate('/')}
            className="text-xs font-semibold text-slate underline underline-offset-2 hover:text-ink transition-colors"
          >
            ← Overview
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SandboxToggle />
          <ConnectBar />
        </div>
      </header>

      {(!isTestnet || relayer.data?.qieMode === 'mock' || relayer.isError || !contractsConfigured) && (
        <div className="panel mb-2 space-y-2 p-3 sm:p-4">
          {!isTestnet && <Notice tone="bad">You are on QIE Mainnet. Transactions here move real funds.</Notice>}
          {relayer.data?.qieMode === 'mock' && <Notice tone="warn">Mock verification is on. The relayer is not talking to QIE Pass, so no wallet here is really verified. Use this for local testing only.</Notice>}
          {relayer.isError && <Notice tone="warn">Can’t reach the Alibi relayer. You need it to link an identity. Everything else still works.</Notice>}
          {!contractsConfigured && <Notice tone="bad">Contract addresses are missing. Set the VITE_*_ADDRESS values in .env (see .env.example) and restart.</Notice>}
        </div>
      )}

      <section className="pb-12 pt-10 sm:pb-16 sm:pt-16" aria-labelledby="hero-title">
        <h1 id="hero-title" className="max-w-[14ch] text-[2.75rem] font-bold leading-[1] sm:text-7xl">
          Debt follows the person, not the wallet.
        </h1>
        <p className="mt-6 max-w-[56ch] text-lg leading-relaxed text-slate">
          Pay with a small bond instead of the full amount. If you default, what you owe is taken from the next payment to any wallet linked to your QIE identity.
        </p>
        <figure className="mt-12 max-w-4xl">
          <figcaption className="mb-4 text-[15px] text-slate">Someone sends 1,000 QIE to a wallet whose owner owes 450:</figcaption>
          <SplitBar size="hero" segments={[{ value: parseEther('450'), tone: 'garnish', label: 'Goes to the creditor' }, { value: parseEther('550'), tone: 'net', label: 'Reaches the wallet' }]} />
        </figure>
      </section>

      <nav aria-label="Sections" className="sticky top-0 z-10 -mx-4 bg-shell/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <ul className="flex w-max max-w-full gap-1 overflow-x-auto rounded-full border border-rule bg-paper p-1">
          {TABS.map((t) => (
            <li key={t.id}>
              <button
                aria-current={tab === t.id ? 'page' : undefined}
                onClick={() => selectTab(t.id)}
                className={`min-h-[40px] whitespace-nowrap rounded-full px-4 text-[15px] font-semibold transition-colors sm:px-5 ${tab === t.id ? 'bg-ink text-shell' : 'text-slate hover:text-ink'}`}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main id="main" tabIndex={-1} className="mt-4 space-y-4 outline-none">
        {tab === 'identity' && <IdentityPassportCard asset={asset} />}
        {tab === 'agreements' && <CreditEscrowDashboard assets={assets} asset={asset} setAsset={setChosen} />}
        {tab === 'pay' && <SlashingRouterWidget assets={assets} asset={asset} setAsset={setChosen} />}
        {tab === 'sandbox' && <JudgeSandbox />}
      </main>

      <footer className="mt-16 border-t border-rule pt-8 text-[14px] leading-relaxed text-slate">
        <h2 className="font-sans text-sm font-semibold text-ink" style={{ letterSpacing: 0 }}>What Alibi can and can’t collect</h2>
        <p className="mt-2 max-w-[68ch]">
          Debt is taken from payments sent through Alibi’s router to any wallet linked to the identity. Money sent some other way is out of reach. Credit limits are earned and capped per asset, so two identities working together can only cheat each other up to that cap.
        </p>
      </footer>
    </div>
  )
}

export default function App() {
  const { isApp, navigate, tab, hash } = useRouter()

  return (
    <SandboxProvider>
      {isApp ? (
        <Shell onNavigate={navigate} initialTab={tab} hash={hash} />
      ) : (
        <LandingPage onNavigate={navigate} />
      )}
    </SandboxProvider>
  )
}
