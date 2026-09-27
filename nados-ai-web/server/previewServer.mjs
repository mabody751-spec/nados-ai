import { once } from 'node:events'
import express from 'express'
import { createPreviewHandler } from './preview.mjs'
import { getProject, projectReadFile } from './workProjects.mjs'
import { getServer } from './sandbox/index.mjs'

// Previews are served from a dedicated loopback origin (ephemeral port) instead
// of the app origin. A different origin confines any script in previewed project
// content so it cannot read the Nados app's storage or call its APIs.

let previewOrigin = null
let previewServer = null

export function getPreviewOrigin() {
  return previewOrigin
}

export function previewUrlFor(projectId) {
  if (!previewOrigin) return null
  return `${previewOrigin}/p/${projectId}/preview/`
}

export async function startPreviewServer() {
  if (previewServer) return previewOrigin
  const app = express()
  app.disable('x-powered-by')
  // Mounted at the app root so the remaining request URL is the project-relative
  // file path (and the proxy path), e.g. /p/<id>/preview/ or /p/<id>/preview/api/health.
  app.use('/p/:id/preview', createPreviewHandler({
    getProject,
    getServer,
    readFileTool: projectReadFile,
    mountPathFor: (id) => `/p/${id}/preview/`,
  }))
  // Backward-compatible tombstone so the old app-origin URL never serves the SPA.
  app.use('/p/:id', (request, response) => {
    response.status(404).json({ error: 'مسار المعاينة غير صحيح.', previewPath: `/p/${request.params.id}/preview/` })
  })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  previewServer = server
  previewOrigin = `http://127.0.0.1:${address.port}`
  return previewOrigin
}

export function stopPreviewServer() {
  if (!previewServer) return
  try { previewServer.close() } catch {}
  previewServer = null
  previewOrigin = null
}
