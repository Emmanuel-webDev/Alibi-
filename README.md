# Alibi Protocol

**Identity-bound credit for QIE.** Pay with a small bond instead of the full amount. If you default, the debt follows you, not one wallet.

Built for QIE Mainnet Hackathon 3.0, track DeFi and Financial Infrastructure.
Status: working on QIE testnet (chain 1983). Mainnet is not deployed. Contracts are unaudited.

- Demo video: `<link>`
- Testnet app: `<link>`
- Contracts: see [Deployed contracts](#deployed-contracts-qie-testnet)

---

## The problem

DeFi cannot tell one person from a thousand wallets. So every loan, escrow and "pay later" deal has to be over-collateralized, usually 150% or more. A buyer who is perfectly trustworthy still has to lock more than the price of what they are buying. That keeps credit out of payments, freelancing, merchant tabs and small business finance.

Reputation on a wallet does not fix this. A wallet is free to create, so a bad actor drops one and opens another.

## What Alibi does

Alibi ties a credit limit to a **verified person**, using **QIE Pass**, instead of to a wallet.

1. A person verifies once with QIE Pass.
2. Their wallet is bound to an identity derived from their QIE Pass DID. Nothing is typed in.
3. Their tier sets how much of a deal they must lock up front (the bond). A new person locks all of it. A proven person locks a small share.
4. If they miss a deadline, the bond is taken, and the unpaid remainder becomes **debt on the identity**.
5. Any payment later routed through Alibi to **any wallet bound to that identity** repays the debt first.

Starting over costs a new KYC, not a new wallet.

## Who it is for

| Audience | What they get |
|---|---|
| **Buyers and borrowers** with a QIE Pass | Smaller up-front bonds as they build a record of settled deals. |
| **Merchants, freelancers and sellers** (creditors) | Payment protection on credit deals. They set their own minimum tier and minimum bond, so they decide how much risk to take. |
| **QIE apps and wallets** | A credit and escrow primitive to build on. Marketplaces, payroll advances, pay-later and invoicing apps can integrate the contracts and never show Alibi to their users. |

Alibi is infrastructure first. It is not a lending pool and it does not promise large loans.

## What you need to use it

- A QIE Wallet.
- A QIE Pass verification (https://id.qie.digital/verify). Unverified wallets cannot get credit.
- A little QIE for gas.
- The relayer must be reachable to bind an identity. Everything else works without it.

---

## How it works

1. **Connect.** The relayer asks QIE Pass whether the person behind the wallet is verified (`is-verified`). It is a silent yes or no, with no personal data.
2. **Verify if needed.** An unverified wallet sees a gate with a link to QIE Pass and a re-check button.
3. **Bind.** The person approves a consent request in QIE Wallet. The relayer then claims the credential (`claim-and-verify`), accepts it only if QIE reports the signature, expiry and revocation checks as valid, and reads the per-person DID. The wallet signs one challenge, and the relayer signs an EIP-712 attestation that links `wallet -> identityId = hash(DID)`. `registry.linkWallet` verifies it on-chain. Links are permanent.
4. **Add more wallets.** QIE Pass verifies one address (a second account from the same recovery phrase is not verified, tested). So extra wallets join by authorization: the bound wallet authorizes the new address, and the new wallet then adds itself.
5. **Earn a tier.** Settled deals with distinct counterparties, over time, move an identity from New to Base to Proven. Lower tiers pay higher bonds. Staking is optional and raises the limit.
6. **Open an agreement.** The bond is the higher of the tier's bond and the creditor's own minimum.
7. **Settle or default.** Settling on time builds reputation. After the deadline, anyone can call `triggerDefault` and earn a 0.5% keeper bounty. The bond and any stake go to the creditor, and the remainder becomes debt on the identity.
8. **Garnish.** `routePayment` pays a recipient. If the recipient's identity has debt, claims are paid first, oldest first, and the rest is forwarded.

### Tiers

| Tier | How an identity gets there | Effect |
|---|---|---|
| Unverified | No valid QIE Pass binding | No credit. Full bond. |
| New | Verified, little or no history. Any default sends an identity back here. | Highest bond floor. |
| Base | Enough settled deals, enough distinct counterparties, enough age | Lower bond floor, unsecured cap applies |
| Proven | More of the same | Lowest bond floor, higher cap |

The exact thresholds and bond floors are contract configuration (`tierConfig`, `floorBps`). Staking adds to an identity's cap: capacity = tier cap + stake - what is already used. Default caps are 50 QIE (Base) and 200 QIE (Proven) per asset, with a protocol-wide limit of 1,000 QIE of unsecured exposure.

### Creditor rules

A creditor calls `setCreditorPolicy(minBondBps, minTier)`. From then on, every new agreement with that creditor must lock at least that bond share and come from at least that tier. With no policy set, nothing extra is required. A rule applies to agreements created after it is set.

---

## Why a bad actor cannot simply walk away

- A default drops the identity to the New tier, with a full bond again.
- A fresh start needs a new QIE Pass identity.
- Unsecured credit is capped per identity and protocol-wide.
- Creditors choose their own risk limits.
- The owner can pause new agreements. Settling, defaulting and collecting are never paused.

## Limits, stated plainly

Alibi makes abuse more expensive. It does not make it impossible.

- **Sybil resistance is bounded, not eliminated.** Alibi relies on one KYC profile giving one DID. Two things are not yet confirmed with QIE: that one person gets the same DID from a second wallet, and that QIE stops one person from getting a second DID. If either fails, someone could start a clean identity at the New tier with a full bond.
- **Colluding friends can still bust out.** A group of verified people can build records among themselves, then default on real creditors. They can take up to the caps, once per identity, and each one burns their KYC. Caps, the distinct-counterparty rule, age gating and fees limit this. Do not describe the system as bust-out proof.
- **Garnishment only reaches money sent through the router and the gated vault.** Wallets a person never binds are invisible to Alibi.
- **The relayer's attestor key is trusted.** A stolen key could attest any wallet to any identity. It can be rotated with `setAttestor`, and it must be separate from the deployer and keeper keys.
- **No recovery path.** A bound wallet cannot be unlinked.
- **Credit is small by design.**
- **The contracts are unaudited.** Do not use real funds.

## Still to confirm with QIE

- Does a second QIE-verified address of the same person return the same DID?
- Does QIE stop one person from obtaining a second DID?
- Is `claim-and-verify` repeatable per request? (Tested: no. The relayer stores the DID after the first claim.)
- Mainnet chain ID and RPC, and the QUSDC address and decimals.

---

## Deployed contracts (QIE testnet)

Chain ID 1983. RPC: https://rpc2testnet.qie.digital/. Explorer: https://testnet.qie.digital. The record is `deployments/1983.json`.

| Contract | Address |
|---|---|
| AlibiIdentityRegistry | `0x3d3a9226801703efD6A8234b33D8a0Ca7193e19d` |
| AlibiCreditEscrow | `0x2776F50c304A6933B5e5Bb9d096F7345E7faB7E4` |
| AlibiSlashingRouter | `0x7bB06a59bDe0a7c5489FBd0617E539fff465A1Eb` |
| AlibiGatedVault | `0x35646BEc61949F0Cb646f3c94fD1283E3969db8a` |
| Eip712AttestationVerifier | `0x80801469d2952670160e4Fabc271912AbaDA8280` |

## Repository layout

| Path | What |
|---|---|
| `contracts/` | Solidity 0.8.24 and Foundry: identity registry, escrow, slashing router, EIP-712 verifier, gated vault. 90 tests. |
| `backend/` | TypeScript and Express relayer: QIE Pass client (live or mock), wallet challenge, EIP-712 attestor, identity store, event indexer, optional keeper. 43 tests. |
| `frontend/` | React 18, wagmi v2 and Tailwind. Landing page and app: Identity, Agreements, Pay, Judge sandbox. 23 tests. |
| `deployments/` | Deployment record for QIE testnet. |
| `scripts/` | `export-abis.mjs` exports Foundry ABIs to the backend and frontend. |
| `docs/` | `PRD-v2.1.md` and `MAINNET-CHECKLIST.md`. |

## Run locally (no secrets needed)

```bash
# chain
anvil --port 8546 --chain-id 1983 &

# contracts
cd contracts && forge test

# deploy with demo-sized caps so the 500 QIE scenario works (production defaults are much lower)
BASE_CAP_WEI=200000000000000000000 PROVEN_CAP_WEI=2000000000000000000000 \
GLOBAL_UNSECURED_CAP_WEI=5000000000000000000000 \
DEPLOYER_PRIVATE_KEY=<anvil key> ATTESTOR_ADDRESS=<addr> \
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8546 --broadcast

# backend (QIE_MODE=mock). The e2e needs a fresh anvil and deploy each run.
cd ../backend && npm i && npm test && npm run e2e

# frontend
cd ../frontend && npm i && node scripts/sync-deployment.mjs 1983 && npm run dev
```

## Testnet runbook (chain 1983)

Keys live only in untracked `.env` files. Never paste them into chat, issues or commits.

1. Fund a deployer wallet from the QIE testnet faucet. Generate a separate attestor key and a separate keeper key.
2. Deploy: `forge script script/Deploy.s.sol --rpc-url https://rpc2testnet.qie.digital/ --broadcast`. For the demo deal sizes, set the demo caps shown above.
3. `node frontend/scripts/sync-deployment.mjs 1983` fills the address lines in `frontend/.env` and `backend/.env`.
4. In `backend/.env` set `ATTESTOR_PRIVATE_KEY`, `QIE_MODE=live`, `QIE_BASE_URL` and your QIE partner keys. Start with `npm run dev`. A 401 from QIE means a bad or revoked key, or a clock more than 5 minutes off.
5. Real run: connect a QIE-verified wallet and click **Bind this wallet**.
6. Judge sandbox: run a second relayer with `QIE_MODE=mock` and `SANDBOX_ENABLED=true` (it refuses to start unless the chain is 1983). Seed the demo identity with `script/SeedDemo.s.sol`. The sandbox identity's tier is seeded, not earned.

## Mainnet

Not deployed. Before any mainnet step, work through `docs/MAINNET-CHECKLIST.md`: separate deployer, attestor and keeper keys; conservative caps; no seed script; `SANDBOX_ENABLED=false`; explicit sign-off.

## Security notes

- Request signing for QIE Pass is `HMAC-SHA256(publicKey + timestamp, secret)`.
- The KYC Share flow is not used, so Alibi never receives personal data.
- `IDENTITY_ANCHOR=wallet` is a fallback that keys an identity to the verified wallet instead of the DID.
- The relayer stores `wallet -> DID` locally (`QIE_STORE_PATH`). Back it up and keep it out of git.

## License

MIT. See [LICENSE](LICENSE).