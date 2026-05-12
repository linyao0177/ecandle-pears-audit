/* Pear v2 desktop app entry.
 *
 * pear-electron + pear-bridge boot an Electron-based shell that renders
 * `ui/index.html`. Hypercore + Hyperswarm modules resolve from
 * node_modules normally inside the renderer's Bare-on-Electron context,
 * so the UI itself can replicate the cloud audit feed peer-to-peer
 * without a separate "main process" file.
 *
 * Boot pattern from the official Pear v2 migration guide:
 * https://docs.pears.com/reference/migration/
 */

import Runtime from 'pear-electron'
import Bridge from 'pear-bridge'

const bridge = new Bridge()
await bridge.ready()

const runtime = new Runtime()
const pipe = await runtime.start({ bridge })
pipe.on('close', () => Pear.exit())
