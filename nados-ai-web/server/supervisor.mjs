import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const services = [
  { name: 'api', command: process.execPath, args: ['server/index.mjs'], healthUrl: 'http://127.0.0.1:8787/api/health' },
  { name: 'web', command: process.execPath, args: [join('node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', '5174', '--strictPort'], healthUrl: 'http://127.0.0.1:5174/' },
]
const children = new Map()
const healthFailures = new Map()
let stopping = false

function launch(service, attempt = 0) {
  if (stopping) return
  const child = spawn(service.command, service.args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  })
  children.set(service.name, child)
  child.on('exit', (code, signal) => {
    children.delete(service.name)
    if (stopping) return
    const delay = Math.min(10_000, 750 * (attempt + 1))
    console.error(`[Nados supervisor] ${service.name} stopped (${signal || code}); restarting in ${delay}ms`)
    setTimeout(() => launch(service, attempt + 1), delay)
  })
  child.on('spawn', () => {
    healthFailures.set(service.name, 0)
    console.log(`[Nados supervisor] ${service.name} running`)
  })
}

async function checkHealth(service) {
  const child = children.get(service.name)
  if (!child || stopping) return
  try {
    const response = await fetch(service.healthUrl, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    healthFailures.set(service.name, 0)
  } catch (error) {
    const failures = (healthFailures.get(service.name) || 0) + 1
    healthFailures.set(service.name, failures)
    console.error(`[Nados supervisor] ${service.name} health check failed (${failures}/3): ${error.message}`)
    if (failures >= 3) {
      healthFailures.set(service.name, 0)
      child.kill()
    }
  }
}

function shutdown(signal) {
  if (stopping) return
  stopping = true
  for (const child of children.values()) child.kill(signal)
  setTimeout(() => process.exit(0), 1500).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('uncaughtException', (error) => console.error('[Nados supervisor] uncaught error', error))
process.on('unhandledRejection', (error) => console.error('[Nados supervisor] unhandled rejection', error))

for (const service of services) launch(service)
setInterval(() => services.forEach((service) => void checkHealth(service)), 15_000).unref()
