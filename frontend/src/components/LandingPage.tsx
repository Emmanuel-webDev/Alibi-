import { useState } from 'react'
import { parseEther } from 'viem'
import { SplitBar } from './SplitBar'
import { DEPLOYMENT } from '../config/deployment'
import { useLiveTierRows } from '../config/tiers'
import { explorerAddress } from '../lib/format'

const PRD_TEXT = `# Alibi Protocol PRD v2.1

## Decisions (built)
- Identity anchor: hash of the per-person QIE Pass DID (subject of the credential from claim-and-verify), after the user approves in QIE Wallet and signs once. Fallback anchor: the verified wallet. Extra wallets join via the same DID, or via a bound wallet's signed authorization. Irrevocable links.
- Credit is earned (tiers by settled deals, distinct counterparties, age), optionally stake-backed; no free leverage. New identities post 100%.
- Escrow with bond, permissionless default (0.5% keeper bounty), FIFO debt claims per identity per asset.
- Slashing router garnishes payments to any linked wallet; payouts push-or-credit so a reverting creditor cannot block a payment.
- Attestation: EIP-712 signed by a relayer after QIE Pass approval and a wallet-ownership signature.
- Testnet (chain 1983) first.`

const README_TEXT = `# Alibi Protocol

Identity-bound credit, under-collateralized escrow and cross-wallet garnishment on QIE.
Built for QIE Mainnet Hackathon 3.0 (DeFi and Financial Infrastructure).

Idea: Credit is tied to a verified QIE identity (.qie handle via QIE Pass), not to a wallet. A person pays a small bond instead of the full amount. If they default, the shortfall becomes debt on the identity and is collected from any payment routed to any wallet linked to it.`

export function LandingPage({ onNavigate }: { onNavigate: (to: string) => void }) {
  const { rows: tierRows, isLive: tierIsLive } = useLiveTierRows()
  const [docModal, setDocModal] = useState<'readme' | 'prd' | null>(null)

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 pb-20 sm:px-6 lg:px-8">
      {/* Skip link */}
      <a
        href="#main-content"
        className="sr-only rounded-full bg-ink px-4 py-2 font-semibold text-shell focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
      >
        Skip to content
      </a>

      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-4 border-b border-rule/60 py-5">
        <div className="flex items-center gap-3">
          <span className="font-display text-2xl font-bold tracking-tight text-ink">Alibi</span>
        </div>

        <nav aria-label="Page navigation" className="hidden items-center gap-6 text-sm font-medium text-slate md:flex">
          <a href="#the-problem" className="transition-colors hover:text-ink">The problem</a>
          <a href="#how-it-works" className="transition-colors hover:text-ink">How it works</a>
          <a href="#who-it-is-for" className="transition-colors hover:text-ink">Who it is for</a>
          <a href="#tiers" className="transition-colors hover:text-ink">Tiers</a>
          <a href="#limits" className="transition-colors hover:text-ink">Limits</a>
        </nav>

        <div>
          <button
            onClick={() => onNavigate('/app')}
            className="btn btn-primary"
            data-testid="launch-app-btn"
          >
            Launch app
          </button>
        </div>
      </header>

      <main id="main-content" className="space-y-20 pt-8 sm:space-y-24 sm:pt-12">
        {/* Hero */}
        <section aria-labelledby="hero-heading" className="space-y-8">
          <h1 id="hero-heading" className="max-w-[15ch] font-display text-4xl font-bold leading-[1.05] tracking-tight text-ink sm:text-6xl lg:text-7xl">
            Debt follows the person, not the wallet.
          </h1>

          {/* One plain sentence required by prompt */}
          <p className="max-w-prose text-lg leading-relaxed text-slate sm:text-xl">
            Alibi lets a verified person borrow or pay with less than full collateral, because their credit follows their QIE Pass identity and not a single wallet.
          </p>

          <div className="pt-2">
            <button
              onClick={() => onNavigate('/app')}
              className="btn btn-primary text-base px-6 py-3"
            >
              Launch app
            </button>
          </div>

          {/* Visual proof: SplitBar showing garnishment mechanism */}
          <figure className="mt-8 max-w-3xl rounded-2xl border border-rule/80 bg-paper/60 p-4 sm:p-6">
            <figcaption className="mb-3 text-sm text-slate">
              How cross-wallet recovery works: someone sends 1,000 QIE to a wallet whose owner owes 450:
            </figcaption>
            <SplitBar
              size="hero"
              segments={[
                { value: parseEther('450'), tone: 'garnish', label: 'Goes to the creditor (debt repayment)' },
                { value: parseEther('550'), tone: 'net', label: 'Reaches the recipient wallet' },
              ]}
            />
          </figure>
        </section>

        {/* The problem */}
        <section id="the-problem" aria-labelledby="problem-heading" className="panel p-6 sm:p-8 lg:p-10">
          <h2 id="problem-heading" className="font-display text-2xl font-bold leading-tight sm:text-3xl">
            The problem
          </h2>
          <div className="mt-4 space-y-4 max-w-prose text-[15px] leading-relaxed text-slate">
            <p>
              DeFi needs 150% collateral because it can’t tell one person from many wallets. Without identity, every borrower is anonymous, so protocols cannot distinguish ten distinct participants from one person running ten wallets to extract borrowed funds and disappear.
            </p>
            <p>
              Alibi uses QIE Pass to tie a credit limit to one verified person. Because your reputation and outstanding liabilities attach directly to your verified person rather than a single address, your credit record and obligations follow you across any wallet you bind.
            </p>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" aria-labelledby="how-it-works-heading" className="panel p-6 sm:p-8 lg:p-10">
          <h2 id="how-it-works-heading" className="font-display text-2xl font-bold leading-tight sm:text-3xl">
            How it works
          </h2>
          <p className="mt-2 max-w-prose text-[15px] text-slate">
            A real sequence of steps from verification to debt resolution:
          </p>

          <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                num: '1',
                title: 'Verify with QIE Pass',
                text: 'Complete identity verification on QIE Pass once. No personal identity details are typed into Alibi.',
              },
              {
                num: '2',
                title: 'Bind your wallet',
                text: 'Bind your wallet to your identity (you sign it, and no ID is typed in). The relayer verifies your DID cryptographically.',
              },
              {
                num: '3',
                title: 'Authorize extra wallets',
                text: 'Optionally authorize other wallets to join the same identity so all your addresses share one credit capacity.',
              },
              {
                num: '4',
                title: 'Open an agreement',
                text: 'Open an agreement with a bond set by your tier instead of locking the entire 100% upfront.',
              },
              {
                num: '5',
                title: 'Settle or default',
                text: 'Settle on time to build reputation, or default and lose the bond and the tier back to New.',
              },
              {
                num: '6',
                title: 'Cross-wallet garnishment',
                text: 'If you default, payments routed through Alibi are garnished to repay the creditor until the debt is cleared.',
              },
            ].map((step) => (
              <li
                key={step.num}
                className="flex flex-col rounded-2xl border border-rule bg-paper p-5 transition-shadow hover:border-slate/40"
              >
                <span className="font-display text-2xl font-bold tabular-nums text-magenta">{step.num}</span>
                <h3 className="mt-2 font-display text-base font-semibold text-ink">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Who it is for */}
        <section id="who-it-is-for" aria-labelledby="who-heading" className="panel p-6 sm:p-8 lg:p-10">
          <h2 id="who-heading" className="font-display text-2xl font-bold leading-tight sm:text-3xl">
            Who it is for
          </h2>
          <p className="mt-2 max-w-prose text-[15px] text-slate">
            Three roles participating in the Alibi credit economy:
          </p>

          <div className="mt-6 grid gap-5 sm:grid-cols-3">
            <div className="rounded-2xl border border-rule bg-paper p-5">
              <h3 className="font-display text-lg font-semibold text-ink">Borrowers and buyers</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate">
                A verified person who wants to pay with a smaller bond.
              </p>
            </div>
            <div className="rounded-2xl border border-rule bg-paper p-5">
              <h3 className="font-display text-lg font-semibold text-ink">Creditors and merchants</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate">
                They set their own minimum tier and minimum bond.
              </p>
            </div>
            <div className="rounded-2xl border border-rule bg-paper p-5">
              <h3 className="font-display text-lg font-semibold text-ink">QIE apps</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate">
                Integrate Alibi as a credit primitive.
              </p>
            </div>
          </div>
        </section>

        {/* What you need to use it */}
        <section aria-labelledby="prereqs-heading" className="panel p-6 sm:p-8 lg:p-10">
          <h2 id="prereqs-heading" className="font-display text-2xl font-bold leading-tight sm:text-3xl">
            What you need to use it
          </h2>
          <p className="mt-2 max-w-prose text-[15px] text-slate">
            To participate on QIE Testnet, you need four things:
          </p>

          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            <li className="flex items-start gap-3 rounded-xl border border-rule bg-paper p-3.5">
              <span className="text-verdigris font-bold">✓</span>
              <div>
                <strong className="block text-sm text-ink">A QIE Wallet</strong>
                <span className="text-xs text-slate">Browser extension or mobile wallet connected to QIE Testnet (1983).</span>
              </div>
            </li>
            <li className="flex items-start gap-3 rounded-xl border border-rule bg-paper p-3.5">
              <span className="text-verdigris font-bold">✓</span>
              <div>
                <strong className="block text-sm text-ink">A QIE Pass verification</strong>
                <span className="text-xs text-slate">
                  Verify at{' '}
                  <a
                    href="https://id.qie.digital/verify"
                    target="_blank"
                    rel="noreferrer"
                    className="underline text-ink hover:text-magenta"
                  >
                    id.qie.digital/verify
                  </a>
                  .
                </span>
              </div>
            </li>
            <li className="flex items-start gap-3 rounded-xl border border-rule bg-paper p-3.5">
              <span className="text-verdigris font-bold">✓</span>
              <div>
                <strong className="block text-sm text-ink">A small amount of QIE for gas</strong>
                <span className="text-xs text-slate">Testnet tokens from the QIE faucet to submit contract transactions.</span>
              </div>
            </li>
            <li className="flex items-start gap-3 rounded-xl border border-rule bg-paper p-3.5">
              <span className="text-verdigris font-bold">✓</span>
              <div>
                <strong className="block text-sm text-ink">The relayer reachable</strong>
                <span className="text-xs text-slate">The Alibi backend service that issues attestation signatures.</span>
              </div>
            </li>
          </ul>

          <div className="mt-6 rounded-xl border border-rule bg-paper p-4 text-sm font-semibold text-ink">
            Unverified wallets cannot use credit.
          </div>
        </section>

        {/* Tiers table */}
        <section id="tiers" aria-labelledby="tiers-heading" className="panel p-6 sm:p-8 lg:p-10">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="tiers-heading" className="font-display text-2xl font-bold leading-tight sm:text-3xl">
              Tiers
            </h2>
            <span className="text-xs text-slate">
              {tierIsLive ? 'Read live from registry contract' : 'Read from contract tierConfig and deploy defaults'}
            </span>
          </div>

          <p className="mt-2 max-w-prose text-[15px] text-slate">
            Credit limits and bond floors are earned through verified history:
          </p>

          <div className="mt-6 overflow-x-auto rounded-2xl border border-rule bg-paper">
            <table className="w-full min-w-[38rem] border-collapse text-left text-sm" data-testid="tier-table">
              <thead>
                <tr className="border-b border-rule bg-paper-deep/60 text-xs font-semibold uppercase tracking-wider text-slate">
                  <th scope="col" className="px-4 py-3.5 sm:px-6">Tier</th>
                  <th scope="col" className="px-4 py-3.5 sm:px-6">Minimum settled deals</th>
                  <th scope="col" className="px-4 py-3.5 sm:px-6">Minimum different counterparties</th>
                  <th scope="col" className="px-4 py-3.5 sm:px-6">Minimum age</th>
                  <th scope="col" className="px-4 py-3.5 sm:px-6">Bond floor</th>
                  <th scope="col" className="px-4 py-3.5 sm:px-6">Unsecured cap</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule/80">
                {tierRows.map((r) => (
                  <tr key={r.tier} className="transition-colors hover:bg-paper-deep/40">
                    <th scope="row" className="whitespace-nowrap px-4 py-3.5 font-semibold text-ink sm:px-6">
                      {r.tier}
                    </th>
                    <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-slate sm:px-6">
                      {r.minDeals}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-slate sm:px-6">
                      {r.minCounterparties}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-slate sm:px-6">
                      {r.minAge}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 font-medium tabular-nums text-ink sm:px-6">
                      {r.bondFloor}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 font-semibold tabular-nums text-ink sm:px-6">
                      {r.unsecuredCap}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 space-y-1 text-sm leading-relaxed text-slate">
            <p>Any default drops an identity back to New.</p>
            <p>Staking raises your limit on top of your tier cap.</p>
          </div>
        </section>

        {/* Creditor rules */}
        <section id="creditor-rules-info" aria-labelledby="creditor-rules-heading" className="panel p-6 sm:p-8 lg:p-10">
          <h2 id="creditor-rules-heading" className="font-display text-2xl font-bold leading-tight sm:text-3xl">
            Creditor rules
          </h2>
          <div className="mt-4 max-w-prose space-y-3 text-[15px] leading-relaxed text-slate">
            <p>
              A creditor can set a minimum tier and a minimum bond for anyone who owes them. When another user creates an agreement with you as the recipient, Alibi automatically quotes the upfront bond according to your policy.
            </p>
            <p>
              Rules apply to agreements created after they are set. The default is no rule.
            </p>
          </div>
          <div className="mt-6">
            <button
              onClick={() => onNavigate('/app?tab=agreements#creditor-rules')}
              className="btn btn-secondary"
            >
              Open creditor rules panel →
            </button>
          </div>
        </section>

        {/* Honest limits */}
        <section id="limits" aria-labelledby="limits-heading" className="panel p-6 sm:p-8 lg:p-10">
          <h2 id="limits-heading" className="font-display text-2xl font-bold leading-tight sm:text-3xl">
            Honest limits
          </h2>
          <ul className="mt-4 space-y-2.5 max-w-prose text-[15px] leading-relaxed text-slate list-disc pl-5">
            <li>The contracts are unaudited and this is a testnet build.</li>
            <li>Wallets you never bind are invisible to Alibi.</li>
            <li>Friends who are each verified can still cooperate to extract up to their caps. Caps limit this, they don’t prevent it.</li>
            <li>The attestor key is trusted, and there is no recovery path yet.</li>
            <li>Credit limits are small by design.</li>
          </ul>
        </section>
      </main>

      {/* Footer */}
      <footer className="mt-20 border-t border-rule pt-10 text-[14px] text-slate">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-3">
            <h3 className="font-sans text-sm font-semibold text-ink">Contract addresses (QIE Testnet)</h3>
            <ul className="space-y-1.5 text-xs font-mono">
              {DEPLOYMENT.contracts.map((c) => (
                <li key={c.name} className="flex flex-col">
                  <span className="font-sans font-medium text-ink">{c.name}:</span>
                  <a
                    href={explorerAddress(DEPLOYMENT.explorerUrl, c.address)}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-slate underline hover:text-ink"
                    title={c.address}
                  >
                    {c.address}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3">
            <h3 className="font-sans text-sm font-semibold text-ink">Protocol documentation</h3>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setDocModal('readme')}
                className="text-left text-sm underline hover:text-ink"
              >
                View README
              </button>
              <button
                onClick={() => setDocModal('prd')}
                className="text-left text-sm underline hover:text-ink"
              >
                View PRD v2.1
              </button>
              <a
                href="https://id.qie.digital/verify"
                target="_blank"
                rel="noreferrer"
                className="text-sm underline hover:text-ink"
              >
                QIE Pass verification portal
              </a>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="font-sans text-sm font-semibold text-ink">Alibi Protocol</h3>
            <p className="text-xs leading-relaxed text-slate">
              Identity-bound credit, under-collateralized escrow, and cross-wallet garnishment for the QIE blockchain.
            </p>
            <button
              onClick={() => onNavigate('/app')}
              className="btn btn-primary min-h-[38px] py-1.5 text-xs font-semibold"
            >
              Launch app
            </button>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-rule/60 pt-6 text-xs text-slate">
          <span>Testnet build • Chain {DEPLOYMENT.chainId}</span>
          <a href="#main-content" className="underline hover:text-ink">Back to top ↑</a>
        </div>
      </footer>

      {/* Document modal */}
      {docModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setDocModal(null)}
        >
          <div
            className="panel max-h-[85vh] w-full max-w-2xl overflow-y-auto p-6 sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-rule pb-3">
              <h3 className="font-display text-xl font-bold text-ink">
                {docModal === 'readme' ? 'Alibi Protocol README' : 'Alibi PRD v2.1'}
              </h3>
              <button
                onClick={() => setDocModal(null)}
                className="btn-quiet text-sm font-bold"
                aria-label="Close dialog"
              >
                ✕ Close
              </button>
            </div>
            <pre className="mt-4 whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate">
              {docModal === 'readme' ? README_TEXT : PRD_TEXT}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
