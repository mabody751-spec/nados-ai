import http from 'node:http'
import { extname } from 'node:path'

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.jsx': 'text/javascript; charset=utf-8', '.ts': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.webm': 'video/webm', '.mp4': 'video/mp4', '.pdf': 'application/pdf',
}

export function contentTypeFor(path) {
  return MIME[extname(String(path || '')).toLowerCase()] || 'application/octet-stream'
}

// Rewrites root-absolute asset URLs (/@vite/client, /src/main.jsx, /assets/...)
// so they resolve through the preview mount. Dev servers emit absolute paths,
// so a <base> tag alone is not enough.
export function rewriteHtmlForPreview(html, mountPath) {
  const prefix = mountPath.endsWith('/') ? mountPath.slice(0, -1) : mountPath
  return String(html)
    .replace(/(\s(?:src|href))="\/(?!\/)/g, `$1="${prefix}/`)
    .replace(/url\((['"]?)\//g, `url($1${prefix}/`)
    .replace(/(import\s*\(\s*['"])\/(?!\/)/g, `$1${prefix}/`)
    .replace(/(from\s*['"])\/(?!\/)/g, `$1${prefix}/`)
}

export function createPreviewHandler({ getProject, getServer, readFileTool, mountPathFor = (id) => `/api/work/projects/${id}/preview/` }) {
  return async function previewHandler(request, response) {
    const projectId = String(request.params.id)
    const project = getProject(projectId)
    if (!project) return response.status(404).json({ error: 'المشروع غير موجود.' })

    const server = getServer(projectId)
    const mountPath = mountPathFor(projectId)

    if (!server?.port) {
      return await serveStaticFile(projectId, request, response)
    }

    const targetPath = (request.url || '/') || '/'
    const query = request.originalUrl?.includes('?') ? request.originalUrl.slice(request.originalUrl.indexOf('?')) : ''
    const options = {
      host: '127.0.0.1',
      port: server.port,
      method: request.method,
      path: targetPath + query,
      headers: { ...request.headers, host: `127.0.0.1:${server.port}` },
    }
    delete options.headers['content-length']
    delete options.headers['accept-encoding']

    await new Promise((resolvePromise) => {
      const upstream = http.request(options, (upstreamResponse) => {
        const headers = { ...upstreamResponse.headers }
        delete headers['content-security-policy']
        delete headers['x-frame-options']
        delete headers['content-length']
        delete headers['content-encoding']
        const type = String(headers['content-type'] || '')
        if (type.includes('text/html')) {
          const chunks = []
          upstreamResponse.on('data', (chunk) => chunks.push(chunk))
          upstreamResponse.on('end', () => {
            if (response.writableEnded) return resolvePromise()
            const body = rewriteHtmlForPreview(Buffer.concat(chunks).toString('utf8'), mountPath)
            response.status(upstreamResponse.statusCode || 200)
            response.set('Content-Type', type)
            response.send(body)
            resolvePromise()
          })
          return
        }
        response.status(upstreamResponse.statusCode || 200)
        for (const [key, value] of Object.entries(headers)) {
          if (value !== undefined) response.set(key, value)
        }
        upstreamResponse.pipe(response)
        upstreamResponse.on('end', resolvePromise)
      })
      upstream.on('error', (error) => {
        if (!response.headersSent) response.status(502).json({ error: `تعذّر الوصول إلى خادم المشروع: ${String(error?.message || error).slice(0, 160)}` })
        else response.end()
        resolvePromise()
      })
      upstream.setTimeout(15_000, () => { upstream.destroy(new Error('انتهت مهلة الاتصال بالخادم')) })
      request.pipe(upstream)
    })
  }

  async function serveStaticFile(projectId, request, response) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return response.status(405).json({ error: 'طريقة غير مدعومة.' })
    }
    const raw = decodeURIComponent(String(request.url || '/').split('?')[0])
    let relative = raw.replace(/^\/+/, '')
    if (!relative || relative.endsWith('/')) relative += 'index.html'
    // Never expose sidecar metadata or dotfiles (.nados-project.json, .env, …).
    if (relative.split('/').some((part) => part.startsWith('.'))) {
      return response.status(404).json({ error: 'المسار غير متاح.' })
    }
    try {
      const file = await readFileTool(projectId, relative)
      response.set('Content-Type', contentTypeFor(relative))
      response.set('Cache-Control', 'no-store')
      return request.method === 'HEAD' ? response.end() : response.send(file.content)
    } catch {
      return response.status(404).type('text/html; charset=utf-8').send(
        `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body style="font-family:system-ui;background:#0f1713;color:#eaf4ef;padding:40px;text-align:center"><h2>لا توجد معاينة بعد</h2><p>الملف <code>${escapeHtml(relative)}</code> غير موجود داخل المشروع.</p></body></html>`,
      )
    }
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
}
