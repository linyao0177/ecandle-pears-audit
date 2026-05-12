#!/usr/bin/env node
/* Local Hypercore producer for end-to-end testing.
 *
 * Spins up a Hypercore feed in a temp directory, writes a handful of
 * synthetic eCandle-cloud-event-v1 entries, then joins Hyperswarm as
 * server. Used to prove the audit-cli's --via hyperswarm path works
 * without depending on the Cloud Run producer (which can't accept
 * inbound UDP for Hyperswarm peer connections).
 *
 * The synthetic events use a deterministic device keypair so the audit
 * CLI can verify them with a known pubkey.
 *
 * Usage:
 *   # Terminal 1
 *   node bin/test-producer.js
 *
 *   # Terminal 2 (use the feed key + device pubkey it prints)
 *   node bin/audit-cli.js --via hyperswarm \
 *     --feed-key <key> --device-pubkey <pubkey> --timeout 20000
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Hypercore from 'hypercore'
import Hyperswarm from 'hyperswarm'
import b4a from 'b4a'
import * as ed from '@noble/ed25519'

/* Deterministic device keypair seed — same secret produces the same
 * pubkey every run, which means the audit CLI's pubkey argument is
 * stable across producer restarts. NOT a security model; just a test
 * convenience. */
const DEVICE_SECRET = new Uint8Array(32).fill(0x42)

function bytesToHex (b) {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
}

async function buildSyntheticEvents (count = 4) {
  const devicePubKey = await ed.getPublicKeyAsync(DEVICE_SECRET)
  const out = []

  for (let i = 0; i < count; i++) {
    /* Per-event leaf hash — for the synthetic events we just use a
     * deterministic 32-byte value. In production these are computed
     * by the device firmware from the actual block payload. */
    const leafHash = new Uint8Array(32)
    leafHash[0] = i & 0xff
    for (let j = 1; j < 32; j++) leafHash[j] = (i * 17 + j * 31) & 0xff

    const sig = await ed.signAsync(leafHash, DEVICE_SECRET)

    const isBoot = i === 0
    out.push({
      schema: 'ecandle-cloud-event-v1',
      ts: new Date(Date.now() - (count - i) * 10_000).toISOString(),
      type: 'device_authenticated',
      deviceEthAddr: '0xdeadbeef00000000000000000000000000000000',
      paymentHashHex: bytesToHex(leafHash),
      txHash: bytesToHex(sig),
      recipient: isBoot
        ? 'device_feed_block(boot)#0'
        : `device_feed_block(service_delivered)#${i}`,
      payloadJson: isBoot
        ? { type: 'boot', fw: 'test-producer-v0.0.1' }
        : {
            type: 'service_delivered',
            payment_hash: '0x' + bytesToHex(new Uint8Array(32).fill(i + 0x10)),
            promised_duration_s: 10,
            actual_duration_s: 10,
            started_at: 1000 + i * 10,
            ended_at: 1010 + i * 10,
          },
    })
  }

  return { events: out, devicePubKey }
}

async function main () {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecandle-test-producer-'))
  console.error(`[producer] storage: ${storageDir}`)

  const core = new Hypercore(storageDir, { valueEncoding: 'json' })
  await core.ready()

  console.error(`[producer] feed key:      ${b4a.toString(core.key, 'hex')}`)
  console.error(`[producer] discovery:     ${b4a.toString(core.discoveryKey, 'hex').slice(0, 16)}…`)

  const { events, devicePubKey } = await buildSyntheticEvents(4)
  for (const e of events) await core.append(e)
  console.error(`[producer] wrote ${events.length} synthetic events, core.length = ${core.length}`)
  console.error(`[producer] device pubkey: ${bytesToHex(devicePubKey)}`)
  console.error('')
  console.error('Run the audit CLI in another terminal:')
  console.error('')
  console.error(`  node bin/audit-cli.js --via hyperswarm \\`)
  console.error(`    --feed-key ${b4a.toString(core.key, 'hex')} \\`)
  console.error(`    --device-pubkey ${bytesToHex(devicePubKey)} \\`)
  console.error(`    --timeout 20000 --verbose`)
  console.error('')

  const swarm = new Hyperswarm()
  swarm.on('connection', (conn, info) => {
    console.error(`[producer] peer connection (${info.client ? 'client' : 'server'})`)
    core.replicate(conn)
  })

  const discovery = swarm.join(core.discoveryKey, { server: true, client: false })
  await discovery.flushed()
  console.error('[producer] announced on hyperswarm — listening…')

  process.on('SIGINT', async () => {
    console.error('\n[producer] shutting down…')
    await swarm.destroy()
    await core.close()
    try { fs.rmSync(storageDir, { recursive: true, force: true }) } catch {}
    process.exit(0)
  })
}

main().catch(err => { console.error('fatal:', err); process.exit(1) })
