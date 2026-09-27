// Capacitor (Android) integration. Everything is guarded by isNativePlatform so
// the web build behaves exactly as before. No secret ever lives here: the app is
// only a client of the Cloudflare backend.
import { Capacitor } from '@capacitor/core'

const NATIVE = Capacitor.isNativePlatform()
export const NATIVE_API_BASE = 'https://nados-ai-web.nwr031.workers.dev'

declare global {
  interface Window { __NADOS_API_BASE__?: string }
}

export function isNativeApp() {
  return NATIVE
}

/** Rewrites relative /api calls to the Cloudflare backend and wires native UX. */
export function initNativeShell() {
  if (!NATIVE) return
  installFetchBridge()
  void setupPlugins()
}

function installFetchBridge() {
  try {
    const original = window.fetch.bind(window)
    window.__NADOS_API_BASE__ = NATIVE_API_BASE
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        if (typeof input === 'string' && input.startsWith('/api')) {
          return original(`${NATIVE_API_BASE}${input}`, init)
        }
        if (input instanceof URL && input.pathname.startsWith('/api')) {
          return original(`${NATIVE_API_BASE}${input.pathname}${input.search}`, init)
        }
        if (input instanceof Request) {
          const url = new URL(input.url)
          if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && url.pathname.startsWith('/api')) {
            return original(new Request(`${NATIVE_API_BASE}${url.pathname}${url.search}`, input))
          }
        }
      } catch {}
      return original(input as RequestInfo, init)
    }
  } catch {}
}

async function setupPlugins() {
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: Style.Dark })
    await StatusBar.setBackgroundColor({ color: '#0f1512' })
    await StatusBar.setOverlaysWebView({ overlay: false })
  } catch {}

  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide()
  } catch {}

  try {
    const { App } = await import('@capacitor/app')
    App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack || window.history.length > 1) window.history.back()
      else void App.exitApp()
    })
    App.addListener('appUrlOpen', ({ url }) => {
      try {
        const parsed = new URL(url)
        const path = `${parsed.host}${parsed.pathname}`.replace(/^\/+|\/+$/g, '')
        window.dispatchEvent(new CustomEvent('nados:deeplink', { detail: { url, path, params: parsed.searchParams } }))
      } catch {}
    })
  } catch {}

  try {
    const { Network } = await import('@capacitor/network')
    const apply = (status: { connected: boolean }) => {
      document.documentElement.dataset.network = status.connected ? 'online' : 'offline'
      window.dispatchEvent(new CustomEvent('nados:network', { detail: status }))
    }
    await Network.addListener('networkStatusChange', apply)
    apply(await Network.getStatus())
  } catch {}
}

/** Saves a data URL / text to the device Downloads folder (native only). */
export async function saveToDevice(data: string, fileName: string, isDataUrl = false) {
  if (!NATIVE) {
    const anchor = document.createElement('a')
    anchor.href = isDataUrl ? data : URL.createObjectURL(new Blob([data]))
    anchor.download = fileName
    anchor.click()
    return
  }
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const base64 = isDataUrl ? data.split(',')[1] : btoa(unescape(encodeURIComponent(data)))
  await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Documents, recursive: true })
}

/** Native share sheet for a text/message (falls back to Web Share on the web). */
export async function shareText(text: string, title = 'Nados AI') {
  if (NATIVE) {
    try {
      const { Share } = await import('@capacitor/share')
      await Share.share({ title, text })
      return
    } catch {}
  }
  try { await navigator.share?.({ title, text }) } catch {}
}
