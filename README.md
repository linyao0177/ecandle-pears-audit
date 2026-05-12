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

**v0.0.1 — Week 1 scaffold (CLI smoke test).**

The CLI is a stepping stone to a full [Pear](https://docs.pears.com)
app. Today it runs as a Node script with two modes:

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

### Known limitation (2026-05-12)

The current eCandle production Hypercore writer runs on Cloud Run,
which doesn't accept inbound UDP, so Hyperswarm peer connections never
establish. **Today, run with `--via http` against the production
companion.** The Hyperswarm path is fully implemented and will work
unchanged once the producer is migrated to a host with normal
networking (GCP VPS, Pear-runtime host, etc.). Migration is tracked
in the upstream
[migration plan](https://github.com/linyao0177/ecandle/blob/main/docs/pears-audit-viewer-migration-plan.md).

Next versions add a Pear app shell with a desktop UI, installable via
`pear run pear://<key>`, with no web server in the trust path.

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
