import 'dotenv/config'
import { createPublicClient, formatEther, http, parseEther, zeroAddress } from 'viem'
import { escrowAbi, registryAbi } from '../src/abi.js'

async function main() {
  const rpc = process.env.RPC_URL ?? 'https://rpc2testnet.qie.digital/'
  const client = createPublicClient({ transport: http(rpc) })
  const registry = process.env.REGISTRY_ADDRESS as `0x${string}`
  const escrow = process.env.ESCROW_ADDRESS as `0x${string}`
  const identityId = '0xac096e78234deff1fc9fec5586163b90b09b651e18a1d1a4cc33a33be7e10de3'
  const wallet = '0x38388ECfd6e5235CE20d360Ea26804180bb2EFF7' as `0x${string}`
  const dummyMerchant = '0x7c852118294e51e653712a81e05800f419141751' as `0x${string}`

  const TIER_NAMES = ['Unverified', 'New', 'Base', 'Proven']

  const tier = (await client.readContract({
    address: registry,
    abi: registryAbi,
    functionName: 'tierOf',
    args: [identityId],
  })) as number

  const id = (await client.readContract({
    address: registry,
    abi: registryAbi,
    functionName: 'getIdentity',
    args: [identityId],
  })) as any

  console.log('=== ON-CHAIN STATUS FOR IDENTITY ===')
  console.log('Identity ID:', identityId)
  console.log('Current Tier:', tier, '(' + TIER_NAMES[tier] + ')')
  console.log('Settled deals:', id.settledDeals)
  console.log('Unique counterparties:', id.uniqueCounterparties)
  console.log('Defaults:', id.defaultCount)

  // Quotes for 0.5 QIE deal
  const dealAmount = parseEther('0.5')

  // 1. Quote for our seeded identity (Tier.Proven)
  const [provenBond] = (await client.readContract({
    address: escrow,
    abi: escrowAbi,
    functionName: 'quoteFor',
    args: [wallet, dummyMerchant, zeroAddress, dealAmount],
  })) as [bigint, number]

  // 2. Quote for a brand-new unseeded wallet (Tier.New)
  const freshWallet = '0x1234567890123456789012345678901234567890' as `0x${string}`
  const [newBond] = (await client.readContract({
    address: escrow,
    abi: escrowAbi,
    functionName: 'quoteFor',
    args: [freshWallet, dummyMerchant, zeroAddress, dealAmount],
  })) as [bigint, number]

  console.log('\n=== QUOTES FOR 0.5 QIE DEAL ===')
  console.log('Deal Total:', formatEther(dealAmount), 'QIE')
  console.log('Quote at Tier New (100% bond):', formatEther(newBond), 'QIE (' + ((Number(newBond) / Number(dealAmount)) * 100) + '%)')
  console.log('Quote at Tier Proven (10% floor):', formatEther(provenBond), 'QIE (' + ((Number(provenBond) / Number(dealAmount)) * 100) + '%)')

  // 3. Creditor minimum bond rule
  // A creditor can call setCreditorPolicy(minBondBps, minTier) on escrow
  // Let's verify how a 50% (5000 bps) creditor policy impacts the quote
  console.log('\n=== CREDITOR POLICY IMPACT (50% MIN BOND = 5000 BPS) ===')
  const creditorPolicyMinBond = (dealAmount * 5000n) / 10000n // 50% of 0.5 QIE = 0.25 QIE
  console.log('Standard Proven quote:', formatEther(provenBond), 'QIE (10%)')
  console.log('Under 50% creditor policy, bond floor rises to:', formatEther(creditorPolicyMinBond), 'QIE (50%)')
}

main().catch(console.error)
