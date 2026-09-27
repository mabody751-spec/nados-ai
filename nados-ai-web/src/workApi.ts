export interface WorkProject {
  id: string
  userId: string
  name: string
  stack: string
  stackLabel: string
  status: string
  createdAt: string
  updatedAt: string
}

export interface WorkTreeNode {
  name: string
  path: string
  type: 'dir' | 'file'
  size?: number | null
  modifiedAt?: string | null
  children?: WorkTreeNode[]
}

export interface WorkFileChange {
  path: string
  source: string
  tool: string | null
  at: string
  added: boolean
  removed: boolean
}

export interface WorkStep {
  id: string
  type: string
  status: string
  description: string
  tool: string
  arguments?: Record<string, unknown>
  result?: Record<string, unknown> | null
  error?: string | null
  startedAt: string
  completedAt: string | null
  durationMs: number | null
}

export interface WorkRun {
  projectId: string
  taskId: string | null
  status: string
  task: string
  summary: string
  error: string | null
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  filesChanged: string[]
  steps: WorkStep[]
}

export interface WorkServerInfo {
  projectId: string
  command: string
  pid: number | null
  port: number | null
  url: string | null
  status: string
  startedAt: string
  logs: string[]
}

export interface WorkVerification {
  allPassed: boolean
  results: Array<{ label: string; passed: boolean; kind?: string; command?: string; output?: string }>
}

export interface WorkStatus {
  executionAvailable: boolean
  executionError: string | null
  localOnly: boolean
  previewOrigin: string | null
  provider: string
  platform: string
  workspacesRoot: string
  persistence: boolean
  providers: string[]
  limits: Record<string, number>
  workModel: { providerId: string; model: string | null; label: string } | null
  workTargets: Array<{ providerId: string; model: string | null }>
}

export interface CommandResult {
  tool?: string
  status: string
  command?: string
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
  error?: string | null
  blocked?: boolean
}

export interface WorkDiff {
  path: string
  before: string | null
  after: string | null
  diff: { lines: Array<{ type: 'same' | 'add' | 'remove'; left?: string; right?: string }>; added: number; removed: number }
}

export type WorkEvent = {
  type: string
  [key: string]: unknown
}

const USER_KEY = 'nados-work-user'

export function workUserId(): string {
  try {
    const existing = window.localStorage.getItem(USER_KEY)
    if (existing) return existing
    const generated = `user-${Math.random().toString(36).slice(2, 10)}`
    window.localStorage.setItem(USER_KEY, generated)
    return generated
  } catch {
    return 'local-user'
  }
}

function headers(): HeadersInit {
  return { 'Content-Type': 'application/json', 'x-nados-user': workUserId() }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...headers(), ...(init.headers || {}) } })
  const text = await response.text()
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!response.ok) {
    const message = (body as { error?: string })?.error || `HTTP ${response.status}`
    throw new Error(message)
  }
  return body as T
}

// Previews are served from a dedicated loopback origin (different port), so the
// URL is learned from the server rather than built client-side.
let previewOrigin = ''

export function setPreviewOrigin(origin: string | null | undefined) {
  if (typeof origin === 'string' && origin) previewOrigin = origin.replace(/\/$/, '')
}

export function getWorkStatus() {
  return request<WorkStatus>('/api/work/status').then((status) => {
    setPreviewOrigin(status.previewOrigin)
    return status
  })
}

export function listWorkProjects() {
  return request<{ projects: WorkProject[]; persistence: boolean }>(`/api/work/projects?userId=${encodeURIComponent(workUserId())}`)
}

export function createWorkProject(input: { name: string; stack?: string; task?: string }) {
  return request<{ project: WorkProject; fileCount: number }>('/api/work/projects', {
    method: 'POST',
    body: JSON.stringify({ ...input, userId: workUserId() }),
  })
}

export function getWorkProject(id: string) {
  return request<{ project: WorkProject; tree: WorkTreeNode[]; stats: { files: number; bytes: number }; changes: WorkFileChange[]; run: WorkRun; server: WorkServerInfo | null; previewUrl: string | null }>(`/api/work/projects/${id}`).then((body) => {
    if (body.previewUrl) setPreviewOrigin(body.previewUrl.replace(`/p/${id}/preview/`, ''))
    return body
  })
}

export function deleteWorkProject(id: string) {
  return request<{ deleted: boolean }>(`/api/work/projects/${id}`, { method: 'DELETE' })
}

export function getWorkTree(id: string) {
  return request<{ tree: WorkTreeNode[] }>(`/api/work/projects/${id}/tree`)
}

export function readWorkFile(id: string, path: string) {
  return request<{ path: string; content: string; bytes: number; modifiedAt: string }>(`/api/work/projects/${id}/files?path=${encodeURIComponent(path)}`)
}

export function writeWorkFile(id: string, path: string, content: string) {
  return request<{ status: string; path: string; bytes: number; created: boolean; replaced: boolean }>(`/api/work/projects/${id}/files`, {
    method: 'PUT',
    body: JSON.stringify({ path, content }),
  })
}

export function workFileAction(id: string, action: 'create_file' | 'create_dir' | 'rename' | 'move' | 'copy' | 'delete', payload: { path: string; to?: string; name?: string; content?: string }) {
  return request<Record<string, unknown>>(`/api/work/projects/${id}/files`, {
    method: 'POST',
    body: JSON.stringify({ action, ...payload }),
  })
}

export function getWorkDiff(id: string, path: string) {
  return request<WorkDiff>(`/api/work/projects/${id}/files/diff?path=${encodeURIComponent(path)}`)
}

export function getWorkChanges(id: string) {
  return request<{ changes: WorkFileChange[] }>(`/api/work/projects/${id}/changes`)
}

export function searchWorkFiles(id: string, query: string) {
  return request<{ results: Array<{ file: string; line: number; snippet: string }>; total: number }>(`/api/work/projects/${id}/search?q=${encodeURIComponent(query)}`)
}

export function runWorkCommand(id: string, cmd: string) {
  return request<CommandResult>(`/api/work/projects/${id}/command`, { method: 'POST', body: JSON.stringify({ cmd }) })
}

export function startWorkServer(id: string, command?: string) {
  return request<{ started: boolean; status: string; port: number | null; url: string | null; httpStatus: number | null; pid: number | null; logs: string[]; error?: string }>(`/api/work/projects/${id}/start`, {
    method: 'POST',
    body: JSON.stringify({ command }),
  })
}

export function stopWorkServer(id: string) {
  return request<{ stopped: boolean }>(`/api/work/projects/${id}/stop`, { method: 'POST', body: JSON.stringify({}) })
}

export function controlWorkRun(id: string, action: 'stop' | 'pause' | 'resume') {
  return request<Record<string, unknown>>(`/api/work/projects/${id}/control`, { method: 'POST', body: JSON.stringify({ action }) })
}

export function verifyWorkProject(id: string) {
  return request<WorkVerification>(`/api/work/projects/${id}/verify`, { method: 'POST', body: JSON.stringify({}) })
}

export function workPreviewUrl(id: string) {
  return previewOrigin ? `${previewOrigin}/p/${id}/preview/` : `/api/work/projects/${id}/preview/`
}

export function workZipUrl(id: string) {
  return `/api/work/projects/${id}/zip`
}

export async function runWorkAgent(id: string, task: string, onEvent: (event: WorkEvent) => void, signal?: AbortSignal) {
  const response = await fetch(`/api/work/projects/${id}/agent`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ task, userId: workUserId() }),
    signal,
  })
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    let message = `HTTP ${response.status}`
    try { message = JSON.parse(text).error || message } catch {}
    throw new Error(message)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''
    for (const part of parts) {
      const line = part.split('\n').find((item) => item.startsWith('data: '))
      if (!line) continue
      try { onEvent(JSON.parse(line.slice(6)) as WorkEvent) } catch {}
    }
    if (done) break
  }
  // Flush any final event that arrived without a trailing blank line, otherwise
  // task_completed/error can be dropped and the UI stays "running".
  if (buffer.trim()) {
    const line = buffer.split('\n').find((item) => item.startsWith('data: '))
    if (line) {
      try { onEvent(JSON.parse(line.slice(6)) as WorkEvent) } catch {}
    }
  }
}

export async function downloadWorkFile(id: string, path: string) {
  const response = await fetch(`/api/work/projects/${id}/files?path=${encodeURIComponent(path)}`, { headers: headers() })
  if (!response.ok) throw new Error('تعذّر تنزيل الملف.')
  const body = await response.json() as { content: string }
  const blob = new Blob([body.content], { type: 'text/plain;charset=utf-8' })
  triggerDownload(blob, path.split('/').pop() || 'file.txt')
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export async function downloadWorkZip(id: string, name: string) {
  const response = await fetch(workZipUrl(id), { headers: headers() })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let message = 'تعذّر تصدير المشروع.'
    try { message = JSON.parse(text).error || message } catch {}
    throw new Error(message)
  }
  const blob = await response.blob()
  if (blob.size <= 0) throw new Error('الأرشيف الناتج فارغ.')
  triggerDownload(blob, `NADOS_${name || 'project'}.zip`)
}
