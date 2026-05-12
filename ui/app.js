/* eCandle audit UI — runs in a browser today, ready for Pear runtime.
 *
 * Today this UI runs in any modern browser and uses the HTTP fallback
 * (--via http) to fetch events from the cloud companion. Verification
 * still happens locally in the browser using WebCrypto ed25519.
 *
 * When packaged as a Pear app, the same UI runs inside Pear's window
 * shell. The app.js file becomes the renderer; a peer.js process
 * (Bare runtime) handles Hypercore + Hyperswarm replication and pipes
 * events into the renderer over IPC. This module is structured so the
 * "data source" is pluggable — today HTTP, tomorrow Bare-side Hypercore.
 */

/* Pear runtime resolves bare specifiers from node_modules (Bare runtime
 * supports the Node module resolution algorithm). Plain browsers do not —
 * for stock-browser dev, point the import map at a CDN fallback. */
let ed
if (typeof globalThis.Pear !== 'undefined') {
  ed = await import('@noble/ed25519')
} else {
  ed = await import('https://esm.sh/@noble/ed25519@3.1.0')
}

/* Schema check — same logic as src/decoder.js but inlined so this file
 * is self-contained for browser loading. */
const SCHEMA = 'ecandle-cloud-event-v1'

function isVerifiableEvent (e) {
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

function hexToBytes (hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/* DOM refs */
const $ = id => document.getElementById(id)
const modeSelect = $('modeSelect')
const devicePubkeyInput = $('devicePubkeyInput')
const companionUrlInput = $('companionUrlInput')
const feedKeyInput = $('feedKeyInput')
const loadButton = $('loadButton')
const verifyButton = $('verifyButton')
const eventsList = $('eventsList')
const eventsHeading = $('eventsHeading')
const verifySummary = $('verifySummary')
const modeIndicator = $('modeIndicator')
const connIndicator = $('connIndicator')
const runtimeBadge = $('runtimeBadge')

/* State */
let events = []
let verifyResults = []  // array of { ok, reason } parallel to events

/* --- Data sources --- */

async function fetchEventsViaHttp (companionUrl) {
  const url = `${companionUrl.replace(/\/$/, '')}/api/hypercore-events`
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`http ${res.status} from ${url}`)
  const body = await res.json()
  if (!Array.isArray(body?.events)) throw new Error('http response missing events array')
  return body.events
}

/* Real Hyperswarm replication path, runs inside Pear's Bare runtime.
 *
 * Bare resolves bare specifiers from node_modules using the Node
 * resolution algorithm, so `import 'hypercore'` works the same way it
 * does in Node. In a stock browser the dynamic import below will throw
 * (no module resolution → "Failed to resolve module specifier"); the
 * caller handles that gracefully. */
let pearReplicator = null

async function fetchEventsViaPear (feedKeyHex, opts = {}) {
  if (!isInPearRuntime()) {
    throw new Error('Hyperswarm mode requires the Pear runtime. Launch this app with `pear run --dev .` (development) or `pear run pear://<key>` (once published).')
  }
  if (!/^[0-9a-fA-F]{64}$/.test(feedKeyHex)) {
    throw new Error('--feed-key must be 64 hex chars (32 bytes)')
  }

  const [{ default: Hypercore }, { default: Hyperswarm }, { default: b4a }] = await Promise.all([
    import('hypercore'),
    import('hyperswarm'),
    import('b4a'),
  ])

  /* Pear apps get a per-app storage directory at Pear.config.storage.
   * Persisting the Hypercore across launches gives the auditor a
   * permanent record without the producer being online. */
  const storage = (globalThis.Pear?.config?.storage || '.') + '/audit-feed'
  const feedKey = b4a.from(hexToBytes(feedKeyHex))

  const core = new Hypercore(storage, feedKey)
  await core.ready()

  const swarm = new Hyperswarm()
  swarm.on('connection', (conn) => core.replicate(conn))
  const discovery = swarm.join(core.discoveryKey, { server: false, client: true })
  await discovery.flushed()

  const deadline = Date.now() + (opts.timeoutMs ?? 20_000)
  while (core.length === 0 && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 250))
  }

  const events = []
  for (let i = 0; i < core.length; i++) {
    const raw = await core.get(i)
    /* core was opened without valueEncoding so we get raw buffers;
     * parse JSON like the producer wrote it. */
    try {
      events.push(typeof raw === 'object' && !b4a.isBuffer(raw)
        ? raw
        : JSON.parse(b4a.toString(raw, 'utf8')))
    } catch { /* drop malformed entries */ }
  }

  pearReplicator = { core, swarm, async stop () { await swarm.destroy(); await core.close() } }
  return events
}

function isInPearRuntime () {
  return typeof globalThis.Pear !== 'undefined'
}

/* --- UI helpers --- */

function setMode (mode) {
  modeIndicator.textContent = mode === 'http' ? 'mode · http' : 'mode · hyperswarm'
  modeIndicator.classList.toggle('warn', mode === 'http')
  modeIndicator.classList.toggle('ok', mode === 'hyperswarm')
}

function setConn (label, kind = 'dim') {
  connIndicator.textContent = label
  connIndicator.className = `badge ${kind}`
}

function renderEvents () {
  eventsHeading.textContent = `Cloud feed events (${events.length})`
  if (events.length === 0) {
    eventsList.innerHTML = '<li class="muted small">No events loaded.</li>'
    return
  }
  eventsList.innerHTML = ''
  events.forEach((e, i) => {
    const inner = e?.payloadJson || {}
    const innerType = typeof inner.type === 'string' ? inner.type : null
    const surfaceType = innerType || e?.type || 'unknown'
    const r = verifyResults[i]
    const statusClass = r ? (r.ok ? 'ok' : 'bad') : 'pending'
    const statusText = r ? (r.ok ? '✓ verified' : `✗ ${r.reason}`) : ''
    const dur = typeof inner.actual_duration_s === 'number'
      ? `delivered ${inner.actual_duration_s}s` : ''
    const sig = typeof e.txHash === 'string' ? `sig ${e.txHash.slice(0, 10)}…` : ''

    const li = document.createElement('li')
    li.className = `event ${statusClass}`
    li.innerHTML = `
      <span class="ts">${new Date(e.ts).toLocaleTimeString()}</span>
      <span class="type">${surfaceType}</span>
      ${dur ? `<span class="hash">${dur}</span>` : ''}
      ${sig ? `<span class="hash">${sig}</span>` : ''}
      <span class="meta">${statusText}</span>
    `
    li.addEventListener('click', () => toggleDrawer(li, e))
    eventsList.appendChild(li)
  })
}

function toggleDrawer (rowEl, event) {
  const existing = rowEl.nextElementSibling
  if (existing && existing.classList.contains('drawer')) {
    existing.remove()
    return
  }
  const drawer = document.createElement('li')
  drawer.className = 'drawer'
  const fields = []
  fields.push(['cloud-mirror timestamp', event.ts])
  if (event.deviceEthAddr) fields.push(['device eth addr', event.deviceEthAddr])
  const p = event.payloadJson
  if (p && typeof p === 'object') {
    if (typeof p.type === 'string') fields.push(['signed type', p.type])
    if (typeof p.payment_hash === 'string') fields.push(['payment_hash', p.payment_hash])
    if (typeof p.promised_duration_s === 'number') fields.push(['promised_duration_s', String(p.promised_duration_s)])
    if (typeof p.actual_duration_s === 'number') fields.push(['actual_duration_s', String(p.actual_duration_s)])
    if (typeof p.started_at === 'number') fields.push(['started_at (device clock)', String(p.started_at)])
    if (typeof p.ended_at === 'number') fields.push(['ended_at (device clock)', String(p.ended_at)])
  }
  if (event.paymentHashHex) fields.push(['leaf hash (msg signed)', event.paymentHashHex])
  if (event.txHash) fields.push(['ed25519 signature', event.txHash])
  drawer.innerHTML = fields.map(([k, v]) => `
    <div>
      <div class="field-label">${k}</div>
      <div class="field-value">${v}</div>
    </div>
  `).join('')
  rowEl.after(drawer)
}

/* --- Actions --- */

async function onLoad () {
  const mode = modeSelect.value
  setMode(mode)
  setConn('loading…', 'warn')
  loadButton.disabled = true
  verifyButton.disabled = true
  verifySummary.textContent = ''
  try {
    if (mode === 'http') {
      events = await fetchEventsViaHttp(companionUrlInput.value)
    } else {
      events = await fetchEventsViaPear(feedKeyInput.value)
    }
    verifyResults = new Array(events.length).fill(null)
    renderEvents()
    setConn(`${events.length} events loaded`, 'ok')
    verifyButton.disabled = events.length === 0
  } catch (err) {
    console.error(err)
    setConn(err.message, 'bad')
    eventsList.innerHTML = `<li class="muted small">Error: ${err.message}</li>`
  } finally {
    loadButton.disabled = false
  }
}

async function onVerify () {
  if (events.length === 0) return
  const pubkeyHex = devicePubkeyInput.value.trim()
  if (!/^[0-9a-fA-F]{64}$/.test(pubkeyHex)) {
    setConn('device pubkey must be 64 hex chars', 'bad')
    return
  }
  const pubkey = hexToBytes(pubkeyHex)
  verifyButton.disabled = true
  verifySummary.textContent = 'verifying…'
  const t0 = performance.now()
  let verified = 0
  let failed = 0
  let nonDevice = 0

  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    if (!isVerifiableEvent(e)) {
      verifyResults[i] = { ok: true, reason: 'non-device event, skipped' }
      nonDevice++
      continue
    }
    try {
      const sig = hexToBytes(e.txHash)
      const msg = hexToBytes(e.paymentHashHex)
      const ok = await ed.verifyAsync(sig, msg, pubkey)
      verifyResults[i] = { ok, reason: ok ? null : 'signature mismatch' }
      if (ok) verified++; else failed++
    } catch (err) {
      verifyResults[i] = { ok: false, reason: err.message }
      failed++
    }
    /* progressive render so user sees green/red flow in */
    renderEvents()
    await new Promise(r => setTimeout(r, 30))
  }

  const tookMs = Math.round(performance.now() - t0)
  const total = verified + failed
  if (failed === 0 && verified > 0) {
    verifySummary.innerHTML = `<span class="badge ok">✓ ${verified}/${total} verified · ${tookMs}ms</span>`
  } else {
    verifySummary.innerHTML = `<span class="badge bad">✗ ${failed} failed · ${verified}/${total} ok · ${tookMs}ms</span>`
  }
  verifyButton.disabled = false
}

/* --- Wire up --- */

loadButton.addEventListener('click', onLoad)
verifyButton.addEventListener('click', onVerify)
modeSelect.addEventListener('change', () => setMode(modeSelect.value))

/* Pear runtime detection — light up the Hyperswarm option + badge */
if (isInPearRuntime()) {
  /* Enable hyperswarm option */
  const hsOpt = modeSelect.querySelector('option[value="hyperswarm"]')
  if (hsOpt) {
    hsOpt.disabled = false
    hsOpt.textContent = 'Hyperswarm P2P (Pear runtime detected ✓)'
  }
  modeSelect.value = 'hyperswarm'
  if (runtimeBadge) {
    runtimeBadge.textContent = '🍐 Pear runtime'
    runtimeBadge.classList.remove('dim')
    runtimeBadge.classList.add('ok')
  }
} else if (runtimeBadge) {
  runtimeBadge.textContent = 'browser (no Pear)'
  runtimeBadge.classList.add('dim')
}

setMode(modeSelect.value)
setConn('idle', 'dim')
