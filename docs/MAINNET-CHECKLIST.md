# Alibi Protocol — Mainnet Preparation Checklist

> [!CAUTION]
> **READ-ONLY CHECKLIST — DO NOT EXECUTE AUTOMATICALLY.**
> This document specifies the mandatory security requirements, operational boundaries, and verification gates before any mainnet deployment or configuration. `ALLOW_MAINNET` must remain unset until every pre-flight requirement below is satisfied and signed off.

---

## 1. Key Management and Separation

Mainnet requires **three distinct, purpose-dedicated private keys**. None of these may be a personal wallet, developer hot wallet, or shared key.

- [ ] **Deployer Key**:
  - Used solely for broadcasting deployment scripts (`Deploy.s.sol`, `Finalize.s.sol`).
  - Ownership of core contracts (`AlibiIdentityRegistry`, `AlibiCreditEscrow`, `AlibiAttestationVerifier`, `AlibiGatedVault`) must be transferred to a cold multisig or hardware governance wallet via `Finalize.s.sol`.
  - Never reused for attestations or keeper actions.
- [ ] **Attestor Key**:
  - Dedicated production signing key used exclusively by the relayer to sign EIP-712 `wallet -> identityId` attestations.
  - Configured via `ATTESTOR_PRIVATE_KEY` in secure, untracked server `.env` or vault secrets manager.
  - Never shares an address with the deployer or keeper.
- [ ] **Keeper Key**:
  - Dedicated automated account used by the relayer's keeper service (`KEEPER_PRIVATE_KEY`) to sweep expired defaults and call `triggerDefault(id)`.
  - Funded with minimal operating gas only.
  - Automatically monitored for low gas balance (skips without crashing when low).
  - Never shares an address with the deployer or attestor.
- [ ] **Secret Storage**:
  - All keys must live only in untracked `.env` files or secure secret stores (AWS Secrets Manager / Vault).
  - Zero private keys, seed phrases, or sensitive credentials may ever be committed to git.

---

## 2. Conservative Exposure Caps

Do **not** reuse the elevated testnet demo caps (`200 QIE` Base / `2,000 QIE` Proven / `5,000 QIE` Global). Mainnet must launch with conservative risk boundaries:

| Parameter | Mainnet Setting | Purpose |
|---|---|---|
| **New Tier Cap** | `0 QIE` (100% bond floor) | First-time identities cannot borrow without full collateral. |
| **Base Tier Cap (`BASE_CAP_WEI`)** | `50 QIE` (`50000000000000000000`) | Entry credit tier after initial settlement history. |
| **Proven Tier Cap (`PROVEN_CAP_WEI`)** | `200 QIE` (`200000000000000000000`) | Advanced credit tier after counterparty diversity & aging. |
| **Global Unsecured Cap (`GLOBAL_UNSECURED_CAP_WEI`)** | `1,000 QIE` (`1000000000000000000000`) | Protocol-wide circuit breaker across all outstanding debt & exposure. |

> [!NOTE]
> Caps should only be adjusted upward gradually after extensive mainnet settlement data and counterparty history have accrued.

---

## 3. SeedDemo Guard Verification

The demo seeding script gives throwaway identities immediate Proven reputation and grant funding for hackathon demonstrations. It must never run on mainnet.

- [ ] `contracts/script/SeedDemo.s.sol` contains a strict runtime chain ID guard:
  ```solidity
  require(block.chainid == 1983, "SeedDemo can only run on QIE testnet (chain 1983)");
  ```
- [ ] Running `SeedDemo.s.sol` against any mainnet chain ID will immediately revert at the EVM level.
- [ ] `Finalize.s.sol` calls `registry.disableSeeding()`, permanently disabling on-chain reputation seeding in the contract bytecode.

---

## 4. Live Environment & Relayer Configuration

All mock and testnet demo flags must be permanently disabled in the production relayer environment:

- [ ] `IDENTITY_ANCHOR=did`:
  - Anchors identity strictly to QIE Pass's per-person DID (`subject` in credential).
- [ ] `QIE_BASE_URL=https://pass-api.qie.digital`:
  - Points to the live QIE Pass partner production endpoint.
- [ ] `QIE_MODE=live`:
  - Full cryptographic verification with live `pk_live_` partner credentials and HMAC-SHA256 request signatures.
- [ ] `SANDBOX_ENABLED=false`:
  - Judge Sandbox endpoints disabled; relayer refuses startup if enabled outside mock/1983.
- [ ] `KEEPER_ENABLED`:
  - Set to `true` (with dedicated `KEEPER_PRIVATE_KEY`) or `false` based on relayer operational requirements.

---

## 5. Persistent Identity Store

The backend persists wallet-to-DID authorization mappings in `data/identities.json` (or `QIE_STORE_PATH`).

- [ ] Confirm `data/identities.json` is ignored by `.gitignore` and never committed.
- [ ] Establish automated encrypted off-site backups for `data/identities.json`.
- [ ] Verify file system permissions restrict access solely to the relayer runtime process.

---

## 6. Known Limits and Trust Assumptions (from README)

Every stakeholder and operator must review and acknowledge these protocol limits honestly:

1. **Contracts are unaudited**:
   The smart contracts have undergone extensive unit, integration, invariant, and on-chain staging tests, but have not undergone an external third-party security audit.
2. **Attestor key is trusted**:
   The relayer attestor is a trusted component. A compromised attestor key could attest arbitrary wallets to identities. Key rotation is supported via `registry.setAttestor`, and the key must be kept strictly segregated from the deployer.
3. **Unbound wallets are invisible**:
   Cross-wallet garnishment and debt collection only apply to payments routed through Alibi's `AlibiSlashingRouter` or `AlibiGatedVault`. Direct transfers outside the protocol contracts do not trigger garnishment.
4. **Bust-out is bounded and not prevented**:
   Sybil resistance is anchored to one KYC profile producing one DID. Colluding parties can build reputation and default up to their tier and global caps once per burned KYC identity. The protocol bounds potential losses through tight caps and creditor policies; it does not eliminate default risk entirely.
5. **No recovery path**:
   Defaulted debt remains permanently recorded against the on-chain identity until satisfied. Identity-to-wallet links are irrevocable, and there is no backdoor recovery path for burned identities or lost private keys.

---

## 7. Operational Pre-Flight Sign-Off

Before running `Finalize.s.sol`, setting `ALLOW_MAINNET=true`, or initiating mainnet transactions, this sign-off must be completed in full by the lead operator:

```text
================================================================================
                    ALIBI PROTOCOL MAINNET SIGN-OFF
================================================================================

Operator Name / Title : ____________________________________________________

Verification Date     : ________________________ (YYYY-MM-DD)

Deployer Address (Safe): 0x__________________________________________________
Attestor Address       : 0x__________________________________________________
Keeper Address         : 0x__________________________________________________

Target Mainnet Chain ID: ________________________
Confirmed RPC URL      : ____________________________________________________

[ ] I have verified that 3 distinct private keys are configured in secure storage.
[ ] I have verified that conservative caps (50 / 200 / 1000 QIE) are configured.
[ ] I have verified that SeedDemo is guarded and cannot execute on mainnet.
[ ] I have verified that QIE_MODE=live, IDENTITY_ANCHOR=did, and SANDBOX_ENABLED=false.
[ ] I have reviewed the unaudited status and honest trust limits outlined above.

Operator Signature     : ____________________________________________________
================================================================================
```
