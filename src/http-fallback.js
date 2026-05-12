/* HTTP fallback for environments where the Hypercore producer isn't
 * reachable over Hyperswarm.
 *
 * Background: our current production Hypercore writer runs in a Cloud
 * Run container. Cloud Run's networking model doesn't accept inbound
 * UDP, which Hyperswarm needs for hole-punched peer connections —
 * peer-to-peer replication against Cloud Run never establishes. This
 * is a deployment constraint, not a protocol limitation; once the
 * producer moves to a host with a normal network (the eCandle GCP
 * VPS, a Pear-runtime host, anywhere with UDP egress AND ingress) the
 * Hyperswarm path will work without code changes.
 *
 * Until then this fallback lets the CLI exercise the verification logic
 * end-to-end. It fetches the producer's HTTP endpoint that exposes the
 * Hypercore contents as JSON, decodes the events, and feeds them to the
 * same verify code path as the Hyperswarm reader. The verification
 * itself is unchanged — the device's ed25519 signature is verified
 * against the device pubkey regardless of how the events arrived.
 *
 * Trust model with this fallback:
 *   ✓ Device signature is still verified locally — the operator can't
 *     forge a signature
 *   ✗ Feed integrity (Hypercore Merkle tree) is not verified — a
 *     malicious operator could drop or reorder events
 *
 * For the "local-first" claim to hold strictly, the Hyperswarm path
 * is required. See the README for the migration roadmap.
 */

const DEFAULT_COMPANION_URL =
  process.env.ECANDLE_COMPANION_URL ||
  'https://ecandle-companion-487249444915.asia-east1.run.app'

export async function fetchEventsViaHttp ({ companionUrl = DEFAULT_COMPANION_URL, verbose = false } = {}) {
  const url = `${companionUrl.replace(/\/$/, '')}/api/hypercore-events`
  if (verbose) console.error(`[http] GET ${url}`)
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`http ${res.status} from ${url}`)
  const body = await res.json()
  if (!Array.isArray(body?.events)) {
    throw new Error('http response missing events array')
  }
  if (verbose) console.error(`[http] received ${body.events.length} events (cloud-side count=${body.count})`)
  return body.events
}
