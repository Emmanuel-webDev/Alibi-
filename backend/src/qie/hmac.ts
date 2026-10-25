import { createHmac } from 'node:crypto'

/**
 * QIE Pass partner API authentication (QIE "KYC Share Integration Guide", Authentication):
 *   X-Public-Key : pk_test_... or pk_live_...
 *   X-Timestamp  : current Unix time in MILLISECONDS, as a string (must be within 5 minutes of QIE server time)
 *   X-Signature  : HMAC-SHA256(publicKey + timestamp, apiSecret), hex-encoded
 */
export function signRequest(publicKey: string, timestamp: string | number, secret: string): string {
  return createHmac('sha256', secret).update(publicKey + String(timestamp)).digest('hex')
}

export function authHeaders(args: { publicKey: string; secret: string; now?: number }): Record<string, string> {
  const timestamp = String(args.now ?? Date.now())
  return {
    'X-Public-Key': args.publicKey,
    'X-Timestamp': timestamp,
    'X-Signature': signRequest(args.publicKey, timestamp, args.secret),
    'Content-Type': 'application/json',
  }
}
