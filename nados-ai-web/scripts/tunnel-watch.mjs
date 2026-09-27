// Keeps the Cloudflare quick tunnel + Worker API_TARGET in sync (Phase 0
// workaround until a permanent host is available).
// - Starts cloudflared to the local Nados API.
// - When the public URL appears/changes, updates wrangler.jsonc API_TARGET and
//   redeploys the Worker automatically, so the deployed site never shows
//   "خادم Nados غير متصل" after a tunnel restart.
// - Restarts cloudflared if it exits.
//
// Usage: node scripts/tunnel-watch.mjs   (run it persistently)
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const wranglerPath = join(root, 'wrangler.jsonc')
const localTarget = process.env.NADOS_API_LOCAL || 'http://127.0.0.1:8787'
const cloudflared = process.env.CLOUDFLARED_PATH || join(root, '.nados', 'cloudflared.exe')
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i
const log = (...a) => console.log(`[tunnel-watch ${new Date().toISOString().slice(11, 19)}]`, ...a)

function currentTarget() {
  try { return /"API_TARGET"\s*:\s*"([^"]+)"/.exec(readFileSync(wranglerPath, 'utf8'))?.[1] || '' } catch { return '' }
}

function setTarget(url) {
  const text = readFileSync(wranglerPath, 'utf8')
  if (!/"API_TARGET"\s*:/.test(text)) throw new Error('API_TARGET not found in wrangler.jsonc')
  writeFileSync(wranglerPath, text.replace(/"API_TARGET"\s*:\s*"[^"]*"/, `"API_TARGET": "${url}"`))
}

function deployWorker(url) {
  return new Promise((resolve) => {
    log(`deploying Worker with API_TARGET=${url}`)
    const p = spawn('npx', ['wrangler', 'deploy'], { cwd: root, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
    p.stdout.on('data', (d) => process.stdout.write(String(d).split('\n').filter((l) => /Version ID|Deployed|error/i.test(l)).join('\n')))
    p.on('exit', (code) => { log(`wrangler deploy exited ${code}`); resolve(code === 0) })
  })
}

let tunnel = null
let shuttingDown = false

function startTunnel() {
  if (!existsSync(cloudflared)) { log(`cloudflared not found at ${cloudflared} — set CLOUDFLARED_PATH`); process.exit(1) }
  log('starting cloudflared…')
  tunnel = spawn(cloudflared, ['tunnel', '--url', localTarget, '--no-autoupdate'], { cwd: root })
  const onData = (data) => {
    const text = String(data)
    const m = URL_RE.exec(text)
    if (!m) return
    const url = m[0]
    if (url === currentTarget()) { log(`tunnel URL unchanged: ${url}`); return }
    try { setTarget(url); deployWorker(url) } catch (e) { log(`update failed: ${e.message}`) }
  }
  tunnel.stdout.on('data', onData)
  tunnel.stderr.on('data', onData)
  tunnel.on('exit', (code) => {
    log(`cloudflared exited ${code}`)
    if (!shuttingDown) setTimeout(startTunnel, 5000)
  })
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { shuttingDown = true; try { tunnel?.kill() } catch {}; process.exit(0) })
}

log(`current API_TARGET: ${currentTarget() || '(none)'}`)
startTunnel()
setInterval(() => {}, 1 << 30)
