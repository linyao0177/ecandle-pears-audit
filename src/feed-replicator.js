/* Hypercore + Hyperswarm replicator.
 *
 * Given a Hypercore feed key (32-byte public key, hex-encoded), this
 * module:
 *   1. opens a Hypercore reader pointed at that key
 *   2. joins the Hyperswarm DHT using the feed's discoveryKey
 *   3. attaches `core.replicate(conn)` to every inbound peer connection
 *   4. waits for the feed to populate, then yields every entry
 *
 * No HTTP, no DNS-resolved company endpoints. Just (a) DHT bootstrap
 * nodes for peer discovery and (b) direct peer connections for the
 * replication itself.
 *
 * The producer of the feed (eCandle's cloud companion at
 * `gateway-api-testnet.circle.com` peer ... unrelated; companion at
 * GCP Cloud Run) announces the same discoveryKey as a server peer.
 * Once both sides have joined the DHT, a direct peer connection
 * forms and replication runs as standard Hypercore protocol.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Hypercore from 'hypercore'
import Hyperswarm from 'hyperswarm'
import b4a from 'b4a'

import { hexToBytes } from './decoder.js'

const REPLICATION_TIMEOUT_MS = 10_000

export class FeedReplicator {
  constructor ({ feedKeyHex, storage = null }) {
    if (!/^[0-9a-fA-F]{64}$/.test(feedKeyHex)) {
      throw new Error('feedKeyHex must be 64 hex chars (32 bytes)')
    }
    this.feedKey = b4a.from(hexToBytes(feedKeyHex))
    /* Hypercore 11 storage is a directory path. We use a fresh temp
     * directory per run; the cache is discarded at stop(). Persisting
     * cache would require a stable path the caller supplies. */
    this.storageDir = storage || fs.mkdtempSync(path.join(os.tmpdir(), 'ecandle-audit-'))
    this.ownsStorage = !storage
    this.core = null
    this.swarm = null
  }

  async start ({ verbose = false } = {}) {
    this.core = new Hypercore(this.storageDir, this.feedKey)
    await this.core.ready()

    if (verbose) {
      console.error(`[replicator] core key  = ${b4a.toString(this.core.key, 'hex')}`)
      console.error(`[replicator] discovery = ${b4a.toString(this.core.discoveryKey, 'hex').slice(0, 16)}…`)
      console.error('[replicator] joining hyperswarm…')
    }

    this.swarm = new Hyperswarm()
    this.swarm.on('connection', (conn, info) => {
      if (verbose) console.error(`[replicator] peer connection (${info.client ? 'client' : 'server'})`)
      this.core.replicate(conn)
    })

    const discovery = this.swarm.join(this.core.discoveryKey, {
      server: false,
      client: true,
    })
    await discovery.flushed()
    if (verbose) console.error('[replicator] discovery flushed — waiting for peers')
  }

  /* Wait up to `timeoutMs` for at least `minLength` entries to be
   * replicated. Returns the actual length. */
  async waitForLength (minLength = 1, timeoutMs = REPLICATION_TIMEOUT_MS) {
    if (!this.core) throw new Error('start() not called')
    const deadline = Date.now() + timeoutMs
    while (this.core.length < minLength && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 250))
    }
    return this.core.length
  }

  /* Read every event currently replicated. */
  async readAll () {
    if (!this.core) throw new Error('start() not called')
    const out = []
    for (let i = 0; i < this.core.length; i++) {
      const raw = await this.core.get(i)
      out.push(parseEntry(raw))
    }
    return out
  }

  /* Stream new events as they arrive. */
  on (event, fn) {
    this.core.on(event, fn)
  }

  get length () {
    return this.core?.length ?? 0
  }

  async stop () {
    if (this.swarm) await this.swarm.destroy()
    if (this.core) await this.core.close()
    if (this.ownsStorage) {
      try { fs.rmSync(this.storageDir, { recursive: true, force: true }) } catch {}
    }
  }
}

/* The companion writes events as JSON (valueEncoding: 'json'). On the
 * read side without an explicit valueEncoding, Hypercore returns raw
 * Buffers; we parse them to JS objects here. */
function parseEntry (raw) {
  if (raw == null) return null
  if (typeof raw === 'object' && !b4a.isBuffer(raw)) return raw
  try {
    return JSON.parse(b4a.toString(raw, 'utf8'))
  } catch {
    return null
  }
}
