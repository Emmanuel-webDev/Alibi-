import 'dotenv/config'
import { createPublicClient, createWalletClient, http, zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Attestor } from '../src/attest.js'
import { registryAbi } from '../src/abi.js'
import { identityIdForDid } from '../src/identity.js'
import fs from 'fs'

async function main() {
  const pk = process.env.ATTESTOR_PRIVATE_KEY
  if (!pk) throw new Error('Missing ATTESTOR_PRIVATE_KEY')
  const account = privateKeyToAccount(pk as `0x${string}`)
  const rpc = process.env.RPC_URL ?? 'https://rpc2testnet.qie.digital/'
  const client = createPublicClient({ transport: http(rpc) })
  const wallet = createWalletClient({ account, transport: http(rpc) })

  const identities = JSON.parse(fs.readFileSync('data/identities.json', 'utf8'))
  const item = identities.find((i: any) => i.wallet.toLowerCase() === account.address.toLowerCase())
  if (!item || !item.did) throw new Error('No stored DID for wallet')

  const identityId = identityIdForDid(item.did)
  console.log('Wallet:', account.address)
  console.log('Identity ID from stored DID:', identityId)

  const attestor = new Attestor(
    pk as `0x${string}`,
    Number(process.env.CHAIN_ID ?? 1983),
    process.env.VERIFIER_ADDRESS as `0x${string}`,
    process.env.REGISTRY_ADDRESS as `0x${string}`,
    client,
  )

  const signed = await attestor.sign({
    wallet: account.address,
    identityId,
    kycVerified: true,
    ttlSeconds: Number(process.env.ATTESTATION_TTL_SECONDS ?? 604800),
  })

  console.log('Attestation signed. Simulating linkWallet on registry:', process.env.REGISTRY_ADDRESS)
  try {
    const sim = await client.simulateContract({
      account,
      address: process.env.REGISTRY_ADDRESS as `0x${string}`,
      abi: registryAbi,
      functionName: 'linkWallet',
      args: [
        {
          wallet: signed.attestation.wallet,
          identityId: signed.attestation.identityId,
          kycVerified: signed.attestation.kycVerified,
          issuedAt: BigInt(signed.attestation.issuedAt),
          expiresAt: BigInt(signed.attestation.expiresAt),
          nonce: BigInt(signed.attestation.nonce),
        },
        signed.signature,
      ],
    })
    console.log('Simulation SUCCESSFUL!')
  } catch (err: any) {
    console.error('SIMULATION REVERTED:', err?.shortMessage || err?.message || err)
    if (err?.cause) console.error('CAUSE:', err.cause)
    process.exit(1)
  }

  const txHash = await wallet.writeContract({
    address: process.env.REGISTRY_ADDRESS as `0x${string}`,
    abi: registryAbi,
    functionName: 'linkWallet',
    args: [
      {
        wallet: signed.attestation.wallet,
        identityId: signed.attestation.identityId,
        kycVerified: signed.attestation.kycVerified,
        issuedAt: BigInt(signed.attestation.issuedAt),
        expiresAt: BigInt(signed.attestation.expiresAt),
        nonce: BigInt(signed.attestation.nonce),
      },
      signed.signature,
    ],
    gas: 500000n,
  })
  console.log('linkWallet tx submitted:', txHash)
  const receipt = await client.waitForTransactionReceipt({ hash: txHash })
  console.log('linkWallet tx confirmed in block:', receipt.blockNumber.toString())

  const boundId = await client.readContract({
    address: process.env.REGISTRY_ADDRESS as `0x${string}`,
    abi: registryAbi,
    functionName: 'identityOf',
    args: [account.address],
  })
  const tier = await client.readContract({
    address: process.env.REGISTRY_ADDRESS as `0x${string}`,
    abi: registryAbi,
    functionName: 'tierOf',
    args: [boundId],
  })
  const identity = (await client.readContract({
    address: process.env.REGISTRY_ADDRESS as `0x${string}`,
    abi: registryAbi,
    functionName: 'getIdentity',
    args: [boundId],
  })) as any
  const debt = (await client.readContract({
    address: process.env.REGISTRY_ADDRESS as `0x${string}`,
    abi: registryAbi,
    functionName: 'debtOutstanding',
    args: [boundId, zeroAddress],
  })) as bigint

  const TIER_NAMES = ['Unverified', 'New', 'Base', 'Proven']
  console.log('--- ON-CHAIN VERIFICATION ---')
  console.log('Bound Identity ID:', boundId)
  console.log('Tier:', tier, '(' + TIER_NAMES[tier] + ')')
  console.log('Debt owed:', debt.toString(), 'QIE')
  console.log('Settled deals:', identity.settledDeals)
  console.log('Defaults:', identity.defaultCount)
  console.log('Linked wallets:', identity.walletCount)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
