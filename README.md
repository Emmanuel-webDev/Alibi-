# Alibi Protocol

Identity-bound credit, under-collateralized escrow and cross-wallet garnishment on QIE.
Built for QIE Mainnet Hackathon 3.0 (DeFi and Financial Infrastructure).

**Idea.** Credit is tied to a verified QIE identity (`.qie` handle via QIE Pass), not to a wallet. A person pays a small bond instead of the full amount. If they default, the shortfall becomes debt on the identity and is collected from any payment routed to any wallet linked to it.

## Layout

| Path | What |
|---|---|
| `contracts/` | Solidity 0.8.24 + Foundry: identity registry, escrow, slashing router, EIP-712 verifier, gated vault, guard modifiers. 90 tests. |
| `backend/` | Relayer (TypeScript/Express): QIE Pass client (mock or live), wallet-ownership challenge, EIP-712 attestor, event indexer, keeper. 43 tests. |
| `frontend/` | React 18 + wagmi v2 + Tailwind. Tabs: Identity, Agreements, Pay, Judge sandbox. 23 tests. |
| `deployments/` | Canonical deployment records (`1983.json` for QIE testnet). |
| `scripts/` | Tooling: `export-abis.mjs` exports Foundry contract ABIs to backend and frontend. |
| `docs/` | Architecture specs: `PRD-v2.1.md` and `MAINNET-CHECKLIST.md`. |

## How it works

1. The user connects a wallet. Nothing is typed. The relayer asks QIE Pass (`GET .../partners/verification-requests/is-verified?identifier=<wallet>`) whether the person behind that wallet is verified. Silent, no personal data.
2. Not verified: the UI shows a gate with **Verify with QIE Pass** (opens id.qie.digital/verify) and **Re-check**; it also re-checks automatically.
3. Verified: **Bind this wallet** does three things. QIE Pass prompts the user in QIE Wallet to approve (`POST /partners/verification-requests`, polled until `consent_given`). The relayer then claims the credential (`POST /vc/partner/claim-and-verify`), accepts it only if QIE reports signature, expiry and revocation all valid, and takes its per-person DID (`subject`). The wallet signs one challenge, and the relayer signs an EIP-712 attestation `wallet -> identityId = hash(DID)`. `registry.linkWallet` verifies it. Links are irrevocable.
4. More wallets: QIE Pass verifies one address (a second account derived from the same recovery phrase is NOT verified, tested in the sandbox), so extra wallets join by authorization: the bound, verified wallet authorizes the new address (Identity tab), and the new wallet then shows a one-click "Add this wallet". If QIE ever verifies a second address for the same person, it lands on the same identity through the same DID.
5. Tiers are earned: New (100% bond), Base, Proven (lower floors), by settled deals with distinct verified counterparties and age. Stake is optional and is slashed first.
6. Missed deadline: anyone can call `triggerDefault` (0.5% keeper bounty). Bond and stake go to the creditor; the rest is debt on the identity.
7. `routePayment` pays a recipient; if its identity has debt, claims are paid first (FIFO, bounded by `maxClaims`), the rest is forwarded.

**What QIE Pass gives us (confirmed by a live sandbox run).** Request signing is `HMAC-SHA256(publicKey + timestamp, secret)`. `is-verified` returns a boolean. After the user consents, `claim-and-verify` returns a credential whose top-level `subject` is a `did:qie:…` string, plus QIE's own `verification` block. The KYC Share flow (which copies KYC data into your own Sumsub account) is deliberately not used. `IDENTITY_ANCHOR=wallet` remains as a fallback.

## Bust-out defenses (colluding friends building trust, then defaulting)

Reputation can be faked cheaply (the only cost of a wash deal is the 0.5% fee), so Alibi limits how much a faked reputation can borrow, and lets the people who bear the loss set their own rules:

- **Low per-identity caps.** Defaults are 50 QIE (Base) and 200 QIE (Proven) of unsecured credit per asset. Raise them only when you have evidence.
- **Protocol-wide limit.** `globalUnsecuredCap[asset]` caps the total unsecured exposure of ALL identities together (open unsecured agreements plus unpaid debt). It is safe by default: if unset (zero), no one gets unsecured credit. A burst of defaults cannot drain more than this.
- **Creditor rules.** Anyone being paid can call `setCreditorPolicy(minBondBps, minTier)`: payers must lock at least that share up front and have reached at least that tier. The UI quotes with `quoteFor`, which applies them.
- **Emergency pause.** The owner can pause NEW agreements. Settling, defaulting and collecting are never paused.

These make a bust-out less profitable and bounded. They do not make it impossible: a colluding group can still take up to the caps, once per verified person who is willing to burn their KYC identity. Do not describe the system as bust-out proof.

## Run locally (no secrets needed)

```bash
# chain
anvil --port 8546 --chain-id 1983 &
# contracts
cd contracts && forge test
# demo-sized caps so the 500 QIE scenario works (production defaults are much lower):
BASE_CAP_WEI=200000000000000000000 PROVEN_CAP_WEI=2000000000000000000000 GLOBAL_UNSECURED_CAP_WEI=5000000000000000000000 \
DEPLOYER_PRIVATE_KEY=<anvil key> ATTESTOR_ADDRESS=<addr> forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8546 --broadcast
# backend (QIE_MODE=mock). e2e needs a FRESH anvil + deploy each run.
cd ../backend && npm i && npm test && npm run e2e
# frontend
cd ../frontend && npm i && node scripts/sync-deployment.mjs 1983 && npm run dev
```

## Testnet runbook (chain 1983, RPC https://rpc2testnet.qie.digital/)

Keys live only in untracked `.env` files. Never paste them into chat, issues or commits.

1. Fund a deployer wallet from the QIE testnet faucet. Generate a **separate** attestor key.
2. `contracts`: `export DEPLOYER_PRIVATE_KEY=... ATTESTOR_ADDRESS=...`. For the judge demo (500 QIE deal, 10% bond) also set `BASE_CAP_WEI=200e18 PROVEN_CAP_WEI=2000e18 GLOBAL_UNSECURED_CAP_WEI=5000e18` (as wei integers); the defaults are deliberately lower. Then
   `forge script script/Deploy.s.sol --rpc-url https://rpc2testnet.qie.digital/ --broadcast`.
3. `node frontend/scripts/sync-deployment.mjs 1983` fills address lines in `frontend/.env` and `backend/.env`.
4. `backend/.env`: set `ATTESTOR_PRIVATE_KEY`, then `QIE_MODE=live`, `QIE_BASE_URL` (the sandbox host for `pk_test_` keys comes from the QIE partner portal), `QIE_PUBLIC_KEY`, `QIE_SECRET_KEY`. Start with `npm run dev`. A 401 from QIE means a bad key, revoked key or a clock more than 5 minutes off.
5. Real run: connect a QIE-verified wallet, click **Bind this wallet**. For the judge demo with throwaway wallets, run a second relayer in `QIE_MODE=mock` with `SANDBOX_ENABLED=true` (the relayer refuses to start unless mock + chain 1983), turn on **Judge sandbox mode**, and click the demo-identity buttons. Seed the demo identity's history (public, event-logged):
   `REGISTRY=<registry> DEMO_IDENTITY_ID=<id shown in the sandbox> forge script script/SeedDemo.s.sol --rpc-url ... --broadcast`
6. Walk the Judge sandbox end to end on testnet. Do not move to mainnet until this passes with `QIE_MODE=live`.

## Mainnet runbook (only after testnet sign-off)

1. Confirm the mainnet chain ID and RPC from QIE's official docs (not verified here).
2. Deploy with `ALLOW_MAINNET=true`. Use a hardware or multisig owner, not the deployer key.
3. Run `Finalize.s.sol`: `disableSeeding`, `lockModules`, transfer ownership of registry, escrow, verifier and vault to `NEW_OWNER`.
4. Set `VITE_CHAIN_ID`, `VITE_RPC_URL`, `VITE_EXPLORER_URL` for the build; the UI shows a real-funds banner on non-testnet chains.
5. Use the conservative default caps (50 / 200 QIE per identity, 1,000 QIE protocol-wide) or lower. `setGlobalUnsecuredCap` must be set or no unsecured credit exists. Keep the owner key able to `pause()`.

## Honest scope and trust assumptions

- Sybil resistance is **bounded, not eliminated**. Alibi relies on one KYC profile giving one DID. Two things are **not yet tested**: that the same person gets the same DID from a second wallet, and that Sumsub's duplicate-KYC check stops one person from getting a second DID. If either fails, they could start a clean identity (at the New tier, 100% bond). A group of colluding verified people can also bust out up to the caps (see above). Wash trading between colluding identities is limited by fees, per-asset caps, the distinct-counterparty requirement, age gating and stake.
- Garnishment only covers payments sent **through the router** (and the gated vault). Funds sent by other routes are out of reach.
- The relayer/attestor is a trusted party. A compromised attestor key can attest any wallet to any identity. Rotate via `setAttestor`; keep it separate from the deployer.
- Demo seeding is a trusted, public action that is permanently disabled before mainnet.
- Contracts are unaudited.

## Still to confirm with QIE

- Whether a second QIE-verified address of the same person returns the SAME `subject` DID. A derived account in QIE Wallet is not verified (tested), and the DID does not contain the wallet address (tested).
- Whether QIE blocks one person from obtaining a second DID.
- Whether `claim-and-verify` can be called more than once per request.
- Whether `?wallet=` / `redirect_uri=` on id.qie.digital/verify are honored (the UI works without them).
- Mainnet chain ID/RPC and QUSDC address/decimals.

## Hackathon note

Judges may ask you to explain the code. Read `AlibiIdentityRegistry._waterfall`, `AlibiCreditEscrow.triggerDefault` and `backend/src/attest.ts` until you can walk through them unaided.
