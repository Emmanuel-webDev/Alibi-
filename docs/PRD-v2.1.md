# Alibi Protocol PRD v2.1

## Decisions (built)
- Identity anchor: hash of the per-person QIE Pass DID (`subject` of the credential from claim-and-verify), after the user approves in QIE Wallet and signs once. Fallback anchor: the verified wallet. Extra wallets join via the same DID, or via a bound wallet's signed authorization. Irrevocable links. Named demo identities exist only in the testnet Judge sandbox.
- Credit is earned (tiers by settled deals, distinct counterparties, age), optionally stake-backed; no free leverage. New identities post 100%.
- Escrow with bond, permissionless default (0.5% keeper bounty), FIFO debt claims per identity per asset.
- Slashing router garnishes payments to any linked wallet; payouts push-or-credit so a reverting creditor cannot block a payment.
- Attestation: EIP-712 signed by a relayer after QIE Pass approval and a wallet-ownership signature, behind an `IAttestationVerifier` adapter so QIE's native ECDSA credential format can replace it.
- Testnet (1983) first; mainnet needs `ALLOW_MAINNET=true`, `Finalize`, and sign-off.

## Confirmed (QIE KYC Share Integration Guide)
Base URL https://pass-api.qie.digital, paths under /api/v1. Auth headers X-Public-Key, X-Timestamp (ms), X-Signature = HMAC-SHA256(publicKey + timestamp, secret). `GET /partners/verification-requests/is-verified?identifier=<wallet|name.qie>` returns `{data:{isVerified}}`, silent, false for unknown/unverified/revoked/expired. Consent for share requests is in QIE Wallet. Testnet chain 1983, RPC https://rpc1testnet.qie.digital/.

## Confirmed by a live sandbox run
is-verified true for a verified wallet; verification request reaches consent_given after approval in QIE Wallet; claim-and-verify returns a credential with top-level `subject` (a DID) and a `verification` block (signatureValid, commitmentValid, notExpired, notRevoked). Not used: KYC Share (Sumsub copy), which needs pairing and a data-sharing agreement and would import personal data.

## Open
Same DID from a second verified address (a derived account is not verified: tested; the DID is opaque: tested); duplicate-DID prevention; repeat claim-and-verify; id.qie.digital/verify query parameters; mainnet chain ID/RPC; QUSDC address/decimals.

## Risk controls (built)
Per-identity unsecured caps (defaults 50 / 200 QIE); protocol-wide unsecured limit per asset (zero = none); creditor-set minimum bond share and minimum tier; owner pause for new agreements only; bond rounding up; stake seized first. Bust-out by colluding verified people is bounded by these, not prevented.

## Non-goals / limits
No claim of perfect sybil resistance. No coverage of payments outside the router. Unaudited.
