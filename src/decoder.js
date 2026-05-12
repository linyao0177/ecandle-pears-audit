/* Cloud-event decoder.
 *
 * The eCandle cloud companion mirrors device-signed audit events into a
 * Hypercore feed with `valueEncoding: 'json'`. Each entry follows this
 * shape (from companion/src/hypercoreWriter.ts):
 *
 *   {
 *     schema: 'ecandle-cloud-event-v1',
 *     ts: '2026-05-08T13:39:46.123Z',
 *     type: 'device_authenticated',
 *     paymentHashHex: '<leaf hash hex, 64 chars>',   // device-signed leaf
 *     txHash:         '<ed25519 sig hex, 128 chars>', // device signature
 *     deviceEthAddr:  '0x…',
 *     recipient:      'device_feed_block(service_delivered)#1',
 *     payloadJson:    { type: 'service_delivered', payment_hash: '0x…', actual_duration_s: 5, … },
 *   }
 *
 * Verifiable invariant: ed25519.verify(sig=txHash, msg=paymentHashHex, key=devicePubkey)
 * must hold for every event with `type === 'device_authenticated'`.
 *
 * Boot blocks and payment blocks both arrive as 'device_authenticated';
 * the inner `payloadJson.type` discriminates further ('boot',
 * 'payment_received', 'service_delivered', …).
 */

export const SCHEMA = 'ecandle-cloud-event-v1'

export function isVerifiableEvent (e) {
  return (
    e &&
    e.schema === SCHEMA &&
    e.type === 'device_authenticated' &&
    typeof e.paymentHashHex === 'string' &&
    typeof e.txHash === 'string' &&
    /^[0-9a-fA-F]{64}$/.test(e.paymentHashHex) &&
    /^[0-9a-fA-F]{128}$/.test(e.txHash)
  )
}

/* Pretty label for an event row (mirrors the web audit page layout). */
export function eventLabel (e) {
  const inner = e?.payloadJson || {}
  const innerType = typeof inner.type === 'string' ? inner.type : null
  const surfaceType = innerType || e?.type || 'unknown'
  const recipient = e?.recipient || ''
  const hash = typeof inner.payment_hash === 'string'
    ? inner.payment_hash.slice(0, 18) + '…'
    : ''
  return { surfaceType, recipient, hash }
}

/* Convert a hex string (with or without 0x prefix) to Uint8Array. */
export function hexToBytes (hex) {
  if (typeof hex !== 'string') throw new TypeError('hexToBytes: input must be a string')
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length % 2 !== 0) throw new Error('hexToBytes: odd-length input')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}
