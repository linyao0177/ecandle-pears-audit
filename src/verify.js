/* ed25519 signature verification.
 *
 * Uses @noble/ed25519 v3 — `verifyAsync` because the sync `verify` API
 * throws unless `hashes.sha512` is injected. `verifyAsync` uses
 * WebCrypto SHA-512 internally on browser and modern Node.
 *
 * The signed message is the DFEED02 leaf hash for that block (32 bytes,
 * mirrored into the cloud event as `paymentHashHex`). The signature is
 * 64 bytes, mirrored as `txHash`. The verifier key is the device's feed
 * pubkey (32 bytes), which the user provides out-of-band — never read
 * from the feed itself.
 *
 * This sig scheme matches firmware tether-pitch-v14 and later. Earlier
 * firmware signed a Merkle "tree-roots fold" instead, which made verify
 * fail for any block index ≥ 1; we coordinated a fix in May 2026
 * (see ecandle-payment/docs/circle-nanopayment-critique-analysis-2026-05-09.md
 * §13 for context).
 */

import * as ed from '@noble/ed25519'
import { hexToBytes } from './decoder.js'

export async function verifyEvent (event, devicePubkey) {
  if (!event?.txHash || !event?.paymentHashHex) {
    return { verified: false, reason: 'missing sig or leaf' }
  }
  try {
    const sig = hexToBytes(event.txHash)
    const msg = hexToBytes(event.paymentHashHex)
    const ok = await ed.verifyAsync(sig, msg, devicePubkey)
    return { verified: ok, reason: ok ? null : 'signature mismatch' }
  } catch (err) {
    return { verified: false, reason: `verify exception: ${err.message}` }
  }
}
