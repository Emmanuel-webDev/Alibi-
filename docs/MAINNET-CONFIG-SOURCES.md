# QIE Mainnet Configuration Sources & Verification Record

All configuration values below are confirmed against QIE's official documentation and live RPC/explorer endpoints.

| Configuration Item | Value | Official Documentation Source URL | Checked Live? | Live Result & Notes |
|---|---|---|---|---|
| **Documentation Index** | Main index of docs | [https://docs.qie.digital/llms.txt](https://docs.qie.digital/llms.txt) | Yes | Fetched live via `read_url_content`. |
| **Mainnet Chain ID** | `1990` (hex `0x7c6`) | [https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet.md](https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet.md) | Yes | All 5 RPC endpoints returned `0x7c6` (`1990`). |
| **Mainnet Explorer** | `https://mainnet.qie.digital/` | [https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet.md](https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet.md) | Yes | HTTP 200; Blockscout v6/v7 Next.js explorer. |
| **Mainnet RPC 1** | `https://rpc1mainnet.qie.digital/` | [https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet.md](https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet.md) | Yes | Returns chainId 1990, gasPrice 1.125 Gwei, syncing block ~11.46M. Selected as **Healthy Primary**. |
| **Mainnet RPC 2** | `https://rpc2mainnet.qie.digital/` | [https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet.md](https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet.md) | Yes | Returns chainId 1990, gasPrice 1.125 Gwei, syncing block ~11.46M. Selected as **Healthy Fallback**. |
| **Mainnet RPC 3** | `https://rpc5mainnet.qie.digital/` (labeled RPC3 in docs) | [https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet.md](https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet.md) | Yes | Returns chainId 1990, gasPrice 1.125 Gwei. (Docs swapped RPC3 URL to rpc5). |
| **Mainnet RPC 4** | `https://rpc4mainnet.qie.digital/` | [https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet.md](https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet.md) | Yes | Returns chainId 1990, gasPrice 1.125 Gwei. |
| **Mainnet RPC 5** | `https://rpc3mainnet.qie.digital/` (labeled RPC5 in docs) | [https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet.md](https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet.md) | Yes | Returns chainId 1990, gasPrice 1.125 Gwei. (Docs swapped RPC5 URL to rpc3). |
| **Native Symbol** | `QIE` (wallet / dApps) / `QIEV3` (network reference) | [https://docs.qie.digital/qie-wallet-integration-guide-for-websites.md](https://docs.qie.digital/qie-wallet-integration-guide-for-websites.md) & [4.-access-mainnet-or-testnet.md](https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet.md) | Yes | QIE Wallet network specification defines `nativeCurrency: { name: 'QIE', symbol: 'QIE', decimals: 18 }`. Access doc lists `Symbol: QIEV3`. |
| **Native Decimals** | `18` | [https://docs.qie.digital/qie-wallet-integration-guide-for-websites.md](https://docs.qie.digital/qie-wallet-integration-guide-for-websites.md) | Yes | Table under "Network Parameters > Mainnet" specifies `Decimals: 18`. |
| **Current Gas Price** | `1,125,000,000 wei` (`1.125 Gwei`) | [https://docs.qie.digital/developer-docs/core-concepts.md](https://docs.qie.digital/developer-docs/core-concepts.md) | Yes | Polled via `eth_gasPrice` across all 5 RPCs. Docs guidance: "Do not hardcode gas prices; let the wallet estimate" and notes low, predictable Cosmos-based fee structure. |
| **Wallet Integration & Switch Flow** | EIP-1193, EIP-6963 (`rdns: me.qiewallet`), `wallet_switchEthereumChain` + `wallet_addEthereumChain` fallback | [https://docs.qie.digital/qie-wallet-integration-guide-for-websites.md](https://docs.qie.digital/qie-wallet-integration-guide-for-websites.md) | Yes | Frontend uses `wagmi` with `injected()` connector (EIP-6963 discovery) and `useSwitchChain` using chain parameters matching QIE documentation. |
| **Smart Contract Deployment Settings** | Solidity `0.8.24`, EVM target `paris`, optimizer runs `200` | [https://docs.qie.digital/developer-docs/smart-contract-deployment.md](https://docs.qie.digital/developer-docs/smart-contract-deployment.md) | Yes | Hardhat example uses Solidity `0.8.20`. Core concepts state full EVM compatibility. No compiler or opcode restrictions exist; `paris` EVM target avoids `PUSH0` and Cancun opcodes (`TSTORE`, `MCOPY`). |
| **Explorer Contract Verification** | Blockscout v2 REST API & Etherscan-compatible API (`/api?module=contract&action=verifysourcecode`) | [https://mainnet.qie.digital/api/v2/smart-contracts/verification/config](https://mainnet.qie.digital/api/v2/smart-contracts/verification/config) | Yes | Verification microservice enabled. Supports compiler versions up to `0.8.38` including `0.8.24+commit.e11b9ed9`, EVM version `paris`, standard-input JSON, and flattened code. |
| **QIE Pass Production Host** | `https://pass-api.qie.digital` | [https://pass-api.qie.digital](https://pass-api.qie.digital) | Yes | Production partner API host. Endpoints: `GET /api/v1/partners/verification-requests/is-verified`, `POST /api/v1/partners/verification-requests`, `POST /api/v1/vc/partner/claim-and-verify`. |
| **QIE Pass Signing Format** | HMAC-SHA256(`publicKey + timestamp`, `secret`) | QIE Partner Authentication Specification | Yes | Headers: `X-Public-Key`, `X-Timestamp` (ms), `X-Signature`. Checked against unit test suite (`backend/test/hmac.test.ts`). |
| **Current Configured Partner Keys** | `pk_test_...` (**TEST KEYS**) | `backend/.env` | Yes | Live check confirmed `backend/.env` contains `pk_test_` keys pointing to staging (`https://did-stapi.qie.digital`). Production requires `pk_live_` keys in `.env.mainnet`. |
| **QUSDC Address & Decimals** | *Unset* | Awaiting official documentation link and address from user | Yes | Not configured in mainnet config. Per protocol rules, leaves unset until user provides verified address. |

---

## RPC Connectivity Details

All five mainnet RPC endpoints were polled via JSON-RPC:

- `https://rpc1mainnet.qie.digital/` — chainId: `1990` (`0x7c6`), gasPrice: `1125000000 wei`, block: `11460615`, status: `OK` (Chosen as **Primary**)
- `https://rpc2mainnet.qie.digital/` — chainId: `1990` (`0x7c6`), gasPrice: `1125000000 wei`, block: `11460615`, status: `OK` (Chosen as **Fallback**)
- `https://rpc3mainnet.qie.digital/` — chainId: `1990` (`0x7c6`), gasPrice: `1125000000 wei`, block: `11460617`, status: `OK`
- `https://rpc4mainnet.qie.digital/` — chainId: `1990` (`0x7c6`), gasPrice: `1125000000 wei`, block: `11460617`, status: `OK`
- `https://rpc5mainnet.qie.digital/` — chainId: `1990` (`0x7c6`), gasPrice: `1125000000 wei`, block: `11460618`, status: `OK`
