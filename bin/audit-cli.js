#!/usr/bin/env node
/* eCandle Pears audit CLI — Week 1 smoke test.
 *
 * Pulls the cloud Hypercore feed over Hyperswarm and verifies every
 * event's ed25519 signature against the device pubkey provided on the
 * command line. No HTTP calls.
 *
 * Usage:
 *   node bin/audit-cli.js \
 *     --feed-key <64-hex-chars> \
 *     --device-pubkey <64-hex-chars> \
 *     [--min-length N] [--timeout MS] [--verbose]
 *
 * Or via env:
 *   ECANDLE_FEED_KEY, ECANDLE_DEVICE_PUBKEY
 */

import { FeedReplicator } from '../src/feed-replicator.js'
import { eventLabel, hexToBytes, isVerifiableEvent } from '../src/decoder.js'
import { verifyEvent } from '../src/verify.js'
import { fetchEventsViaHttp } from '../src/http-fallback.js'

function parseArgs (argv) {
  const out = { minLength: 1, timeoutMs: 10_000, verbose: false, mode: 'hyperswarm' }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--feed-key') out.feedKeyHex = argv[++i]
    else if (a === '--device-pubkey') out.devicePubkeyHex = argv[++i]
    else if (a === '--min-length') out.minLength = parseInt(argv[++i], 10)
    else if (a === '--timeout') out.timeoutMs = parseInt(argv[++i], 10)
    else if (a === '--via') out.mode = argv[++i]
    else if (a === '--companion-url') out.companionUrl = argv[++i]
    else if (a === '--verbose' || a === '-v') out.verbose = true
    else if (a === '--help' || a === '-h') { printUsage(); process.exit(0) }
    else { console.error(`unknown arg: ${a}`); printUsage(); process.exit(2) }
  }
  out.feedKeyHex = out.feedKeyHex || process.env.ECANDLE_FEED_KEY
  out.devicePubkeyHex = out.devicePubkeyHex || process.env.ECANDLE_DEVICE_PUBKEY
  return out
}

function printUsage () {
  console.error(`usage: audit-cli.js --device-pubkey <hex64> [options]

Modes:
  --via hyperswarm  (default)  Replicate Hypercore feed peer-to-peer over
                               Hyperswarm. Requires --feed-key. No HTTP.
                               Needs producer with proper UDP networking.
  --via http                   Fall back to producer's REST endpoint when
                               Hyperswarm isn't reachable (e.g., Cloud Run
                               producers). Use --companion-url to override
                               the default endpoint. Device signatures are
                               still verified locally; feed-tree integrity
                               is NOT verified in this mode.

Common options:
  --feed-key <hex64>           Required for hyperswarm mode
  --device-pubkey <hex64>      Required for both modes
  --companion-url <url>        For http mode (default: env ECANDLE_COMPANION_URL)
  --min-length N               Wait for ≥N events (hyperswarm only)
  --timeout MS                 Hyperswarm wait timeout (default 10000)
  --verbose / -v
  --help / -h

Env fallbacks: ECANDLE_FEED_KEY, ECANDLE_DEVICE_PUBKEY, ECANDLE_COMPANION_URL`)
}

async function main () {
  const args = parseArgs(process.argv)
  if (!args.devicePubkeyHex) {
    console.error('error: --device-pubkey is required')
    printUsage()
    process.exit(2)
  }
  if (args.mode === 'hyperswarm' && !args.feedKeyHex) {
    console.error('error: --feed-key is required for hyperswarm mode')
    printUsage()
    process.exit(2)
  }

  const devicePubkey = hexToBytes(args.devicePubkeyHex)

  let events
  let replicator = null

  if (args.mode === 'http') {
    console.error('▶ http mode — fetching events via companion REST endpoint')
    events = await fetchEventsViaHttp({
      companionUrl: args.companionUrl,
      verbose: args.verbose,
    })
    console.error(`▶ fetched ${events.length} event(s)\n`)
  } else if (args.mode === 'hyperswarm') {
    replicator = new FeedReplicator({ feedKeyHex: args.feedKeyHex })
    await replicator.start({ verbose: args.verbose })
    console.error(`▶ waiting up to ${args.timeoutMs}ms for ≥${args.minLength} event(s)…`)
    const length = await replicator.waitForLength(args.minLength, args.timeoutMs)
    if (length === 0) {
      console.error('✗ no events replicated — feed empty, peers unreachable, or DHT bootstrap failed')
      console.error('  hint: try --via http if producer is hosted on Cloud Run or similar')
      await replicator.stop()
      process.exit(1)
    }
    console.error(`▶ replicated ${length} event(s)\n`)
    events = await replicator.readAll()
  } else {
    console.error(`error: unknown --via mode: ${args.mode}`)
    process.exit(2)
  }
  let verified = 0
  let failed = 0
  let nonDevice = 0

  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    const { surfaceType, recipient, hash } = eventLabel(e)
    if (!isVerifiableEvent(e)) {
      nonDevice++
      console.log(`[i=${i}] ${surfaceType.padEnd(20)} (non-device event, skipped)`)
      continue
    }
    const { verified: ok, reason } = await verifyEvent(e, devicePubkey)
    if (ok) {
      verified++
      console.log(`[i=${i}] ${recipient || surfaceType}   ${hash}   ✓ sig verified`)
    } else {
      failed++
      console.log(`[i=${i}] ${recipient || surfaceType}   ${hash}   ✗ ${reason}`)
    }
  }

  console.log('')
  console.log(`verified ${verified} / ${verified + failed}` + (nonDevice ? `  (${nonDevice} non-device events skipped)` : ''))
  console.log('')
  if (failed > 0) {
    console.log('FAIL: at least one signature did not verify against the supplied device pubkey.')
    console.log('     check: (a) device pubkey matches the device that signed this feed,')
    console.log('            (b) firmware version is ≥ tether-pitch-v14 (sig over leaf hash).')
  } else if (verified > 0) {
    console.log('PASS: every device-signed event verified against the supplied pubkey.')
    if (args.mode === 'hyperswarm') {
      console.log('      events arrived via peer-to-peer Hyperswarm replication —')
      console.log('      no eCandle / Tether / Arkreen server was contacted.')
    } else {
      console.log('      events were fetched via http from the companion. Device sig')
      console.log('      verification is local; feed-tree integrity is NOT verified')
      console.log('      in this mode. Hyperswarm replication required for full trust.')
    }
  }

  if (replicator) await replicator.stop()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('fatal:', err)
  process.exit(1)
})
