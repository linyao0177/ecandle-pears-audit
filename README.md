# ecandle-pears-audit

> Peer-to-peer audit viewer for eCandle DePIN device feeds. Currently a
> Node.js CLI that replicates the cloud Hypercore audit feed over
> Hyperswarm and verifies each event's ed25519 signature against the
> device's pubkey. Roadmap: migrate to a [Pear](https://docs.pears.com)-native
> desktop application.
>
> No company server is in the trust path. Given the **Hypercore feed
> key** and the **device pubkey**, anyone can verify every event in this
> tool, on their own machine, without contacting any operator.

This repo is part of the
[eCandle](https://github.com/linyao0177/ecandle) DePIN solar payment
platform and complements the web-based audit viewer at
[`tether-demo.xid.network/audit`](https://tether-demo.xid.network/audit).

## Status

**v0.0.2 — Pear desktop app integration (Week 2 progress).**

The project is now a real [Pear](https://docs.pears.com) desktop app
on the v2 migration path (`pear-electron` + `pear-bridge` from the
official migration guide). It also still runs as a CLI for headless
audit and as a static-served browser page for development.

### Pear app

Linked at:
```
pear://ymxurfopbfhf8or5jfzywoxwqhh7qy3ta8zgc886somjnsn1g7gy
```

Boot wiring is in `index.js` per the v2 pattern; `package.json` has
`pear.pre = "pear-electron/pre"` plus `pear.gui.main = "ui/index.html"`.
`pear stage` succeeds and pushes the GUI bundle to the link.
`pear run --dev .` configures correctly (Pre-run pear-electron/pre ✓)
but does not yet spawn an Electron window on this machine — this is a
known Pear v1→v2 transitional gap (`pear run` itself is deprecated in
favor of the `pear-runtime` module, but the documented module-based
launch path is incomplete in current docs). When that resolves, the
window will open the existing `ui/index.html`, where the UI detects
`globalThis.Pear` and automatically enables Hyperswarm-P2P mode.

### CLI

Two transport modes for the same verification logic:

1. **Hyperswarm mode** (default) — joins the Hyperswarm DHT, replicates
   the Hypercore feed directly from any peer holding it, verifies each
   event's ed25519 signature against the device pubkey. No HTTP. This
   is the canonical local-first path.
2. **HTTP fallback** (`--via http`) — fetches events from the producer's
   REST endpoint. Used when the producer is hosted somewhere
   Hyperswarm peer connections can't reach (e.g., Cloud Run, which
   doesn't accept inbound UDP).

Verification logic is identical in both modes; only event transport
differs.

### Browser dev shell

`ui/index.html` runs in any modern browser. Useful for iterating on
the UI without booting Pear runtime. Run the included dev proxy so
the browser can talk to the cloud companion without tripping CORS:

```bash
npm run proxy
# → http://localhost:8766/
```

The proxy:
- serves `ui/*` as static files
- forwards `/api/*` to the cloud companion, injecting `access-control-allow-origin: *`

In the UI, leave the **Companion URL** field blank to use the same-origin
proxy path (default). Click **Load events** → **Verify all events** to
see the 4-of-4 green panel. No cloud egress is required from the
browser; only the proxy talks to the companion.

### Known limitations (2026-05-12)

**Producer side (Cloud Run UDP block).** The current eCandle production
Hypercore writer runs on Cloud Run, which doesn't accept inbound UDP,
so Hyperswarm peer connections never establish. Today, run with
`--via http` against the production companion. The Hyperswarm path is
fully implemented and will work unchanged once the producer is
migrated to a host with normal networking (GCP VPS, Pear-runtime host,
etc.). Migration is tracked in the upstream
[migration plan](https://github.com/linyao0177/ecandle/blob/main/docs/pears-audit-viewer-migration-plan.md)
and the [Week 1 retrospective](https://github.com/linyao0177/ecandle/blob/main/docs/pears-audit-week1-retrospective-2026-05-12.md).

**Consumer side (Pear v1→v2 transition).** `pear run` is deprecated;
the canonical v2 launch path uses `pear-runtime` (or equivalent
shipped command for `pear-electron` apps) but that path is still
firming up in upstream docs. Code wiring on our side is complete:
`index.js` uses `pear-electron`'s `Runtime` + `pear-bridge`'s
`Bridge` per the v2 migration guide; `pear stage` runs cleanly and
publishes to a `pear://` link. Once Holepunch ships a clean v2 launch
command (or `pear run` is re-enabled for v2 apps), the existing
window+UI will boot without further code changes.

## Requirements

- Node.js 20 or newer
- Internet access (to reach Hyperswarm DHT bootstrap nodes)

## Install

```bash
npm install
```

## Usage

```bash
# Verify the live eCandle Tether-pitch demo feed via HTTP (works today).
node bin/audit-cli.js \
  --via http \
  --device-pubkey 3a5d47d07b26850887466e85512efdef0fc63272a813643cc80d4bd0a4e6b1e0

# Once the producer is off Cloud Run, the full Hyperswarm path will work:
node bin/audit-cli.js \
  --feed-key f3c0e58afd7e35ea735c9b5a21af0ce3ae6904afa0eaf57e64233847ed135336 \
  --device-pubkey 3a5d47d07b26850887466e85512efdef0fc63272a813643cc80d4bd0a4e6b1e0

# Env defaults are honored:
export ECANDLE_FEED_KEY=f3c0e58afd7e35ea735c9b5a21af0ce3ae6904afa0eaf57e64233847ed135336
export ECANDLE_DEVICE_PUBKEY=3a5d47d07b26850887466e85512efdef0fc63272a813643cc80d4bd0a4e6b1e0
node bin/audit-cli.js --via http
```

## What you'll see

The CLI prints, for each event in the feed:

```
[i=0] device_feed_block(boot)#0           ✓ sig verified
[i=1] device_feed_block(service_delivered)#1   payment_hash=0xc4ea87…   ✓ sig verified
…
verified: 4 / 4
```

If any event fails verification, the program exits with a non-zero
status code.

## Trust model

The CLI trusts:

1. The Hypercore feed key — proves the feed wasn't reordered or
   tampered with after publication
2. The device pubkey — proves each event was signed by the named
   device

The CLI does **not** trust:

- The cloud companion (it's just a peer; if it dies, any other peer
  with the feed key serves the same data)
- Any HTTP endpoint
- DNS / TLS
- Any operator

This is the same trust model as the web audit page, plus the
operational property that this tool runs locally (and, in upcoming
versions, installs via Pear protocol — no web hosting at all).

## What's open, what's next

- **Open**: this repo, source code in `src/`, CLI in `bin/`. MIT.
- **Next**:
  - Pear app packaging (`pear init`, `pear stage`, `pear run pear://<key>`)
  - Desktop UI replicating
    [`tether-demo.xid.network/audit`](https://tether-demo.xid.network/audit)
  - Multi-device fleet support
  - Reference auditor pattern for any DFEED02-format feed

See the upstream migration plan at
[`ecandle/docs/pears-audit-viewer-migration-plan.md`](https://github.com/linyao0177/ecandle/blob/main/docs/pears-audit-viewer-migration-plan.md).

## License

MIT.
