// Usage: node scripts/sync-deployment.mjs <chainId>
// Writes frontend/.env and backend/.env address lines from deployments/<chainId>.json (keeps other values).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const chainId = process.argv[2] ?? '1983'
const file = resolve(here, `../../deployments/${chainId}.json`)
if (!existsSync(file)) { console.error(`No ${file}. Deploy first.`); process.exit(1) }
const d = JSON.parse(readFileSync(file, 'utf8'))

function patch(path, map) {
  const base = existsSync(path) ? readFileSync(path, 'utf8') : readFileSync(path + '.example', 'utf8')
  let out = base
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined) continue
    const re = new RegExp(`^${k}=.*$`, 'm')
    out = re.test(out) ? out.replace(re, `${k}=${v}`) : out + `\n${k}=${v}`
  }
  writeFileSync(path, out)
  console.log('updated', path)
}

patch(resolve(here, '../.env'), {
  VITE_CHAIN_ID: chainId,
  VITE_REGISTRY_ADDRESS: d.registry, VITE_ESCROW_ADDRESS: d.escrow, VITE_ROUTER_ADDRESS: d.router, VITE_VAULT_ADDRESS: d.vault,
})
patch(resolve(here, '../../backend/.env'), {
  CHAIN_ID: chainId,
  VERIFIER_ADDRESS: d.verifier, REGISTRY_ADDRESS: d.registry, ESCROW_ADDRESS: d.escrow, ROUTER_ADDRESS: d.router, VAULT_ADDRESS: d.vault,
})
console.log('Set ATTESTOR_PRIVATE_KEY and QIE_* values in backend/.env yourself. Never paste secrets into chat.')
