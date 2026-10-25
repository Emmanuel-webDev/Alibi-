import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { authHeaders, signRequest } from '../src/qie/hmac.js'

describe('QIE Pass request signing (per the KYC Share guide)', () => {
  it('signature = HMAC-SHA256(publicKey + timestamp, secret), hex', () => {
    const expected = createHmac('sha256', 'sk').update('pk_test_abc' + '1700000000000').digest('hex')
    expect(signRequest('pk_test_abc', 1700000000000, 'sk')).toBe(expected)
    expect(signRequest('pk_test_abc', '1700000000000', 'sk')).toBe(expected)
  })
  it('sends the three documented headers with a millisecond timestamp', () => {
    const h = authHeaders({ publicKey: 'pk_test_abc', secret: 'sk', now: 1700000000123 })
    expect(h['X-Public-Key']).toBe('pk_test_abc')
    expect(h['X-Timestamp']).toBe('1700000000123')
    expect(h['X-Signature']).toBe(signRequest('pk_test_abc', '1700000000123', 'sk'))
  })
  it('changes with the secret and the timestamp, never with the body or path', () => {
    expect(signRequest('pk', 1, 'a')).not.toBe(signRequest('pk', 1, 'b'))
    expect(signRequest('pk', 1, 'a')).not.toBe(signRequest('pk', 2, 'a'))
  })
})
