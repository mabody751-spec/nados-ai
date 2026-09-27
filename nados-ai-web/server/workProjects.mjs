import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import {
  copyFileTool,
  createDirectoryTool,
  deleteFileTool,
  editFileTool,
  ensureProjectRoot,
  listFilesTool,
  moveFileTool,
  projectRoot,
  readFileTool,
  resetUsage,
  SandboxError,
  searchFilesTool,
  treeTool,
  WORKSPACES_ROOT,
  writeFileTool,
} from './sandbox/index.mjs'
import { detectTemplateFromRequest, templateById, templateFiles } from './workTemplates.mjs'

const PROJECTS = new Map()
const FILE_CHANGES = new Map()
const PERSIST_TIMEOUT = 10_000
const PROJECT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/

// Work-project persistence uses the service role key only. The anon key cannot
// write to these RLS-protected tables, so accepting it would silently disable
// persistence while reporting it as enabled.
function supabaseConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '')
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!url || !key || !/^https:\/\/.+\.supabase\.co$/i.test(url)) return null
  return { url, key }
}

export function workPersistenceEnabled() {
  return supabaseConfig() !== null
}

function headers(key) {
  return { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json', Prefer: 'return=minimal' }
}

async function persistProject(project) {
  const config = supabaseConfig()
  if (!config) return false
  try {
    const response = await fetch(`${config.url}/rest/v1/work_projects`, {
      method: 'POST',
      headers: { ...headers(config.key), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{
        project_id: project.id,
        user_id: project.userId,
        name: project.name,
        stack: project.stack,
        status: project.status,
        updated_at: new Date().toISOString(),
      }]),
      signal: AbortSignal.timeout(PERSIST_TIMEOUT),
    })
    return response.ok
  } catch {
    return false
  }
}

async function loadPersistedProjects(userId) {
  const config = supabaseConfig()
  if (!config) return []
  try {
    const response = await fetch(`${config.url}/rest/v1/work_projects?select=project_id,name,stack,status,created_at,updated_at&user_id=eq.${encodeURIComponent(userId)}&order=updated_at.desc&limit=100`, {
      headers: { Authorization: `Bearer ${config.key}`, apikey: config.key },
      signal: AbortSignal.timeout(PERSIST_TIMEOUT),
    })
    if (!response.ok) return []
    const rows = await response.json().catch(() => [])
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

async function deletePersistedProject(projectId) {
  const config = supabaseConfig()
  if (!config) return false
  try {
    const response = await fetch(`${config.url}/rest/v1/work_projects?project_id=eq.${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
      headers: headers(config.key),
      signal: AbortSignal.timeout(PERSIST_TIMEOUT),
    })
    return response.ok
  } catch {
    return false
  }
}

export function normalizeUserId(value) {
  const raw = String(value || '').trim()
  if (!raw) return 'local-user'
  return raw.replace(/[^a-zA-Z0-9@._-]/g, '').slice(0, 80) || 'local-user'
}

export function projectIdFor(userId, name) {
  const slug = String(name || 'project').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'project'
  const suffix = randomUUID().slice(0, 8)
  return `${slug}-${suffix}`
}

// Snapshots are capped so a task that edits large files cannot pin gigabytes
// of before/after content in memory.
const MAX_CHANGE_SNAPSHOT_BYTES = Number(process.env.NADOS_WORK_CHANGE_SNAPSHOT_BYTES) || 200_000
const MAX_CHANGE_TOTAL_BYTES = Number(process.env.NADOS_WORK_CHANGE_TOTAL_BYTES) || 8_000_000

function truncatedSnapshot(value) {
  if (value === null || value === undefined) return null
  const text = String(value)
  if (Buffer.byteLength(text, 'utf8') <= MAX_CHANGE_SNAPSHOT_BYTES) return text
  return `${text.slice(0, MAX_CHANGE_SNAPSHOT_BYTES)}\n\n…[تم اقتصاص اللقطة لتجاوزها الحد]`
}

function changeBytes(changes) {
  let total = 0
  for (const change of changes.values()) {
    total += (change.before ? Buffer.byteLength(change.before, 'utf8') : 0) + (change.after ? Buffer.byteLength(change.after, 'utf8') : 0)
  }
  return total
}

// Records before/after snapshots so the UI can render real diffs and a
// modified indicator, and so risky changes can be reverted.
export function recordFileChange(projectId, path, { before = null, after = null, source = 'agent', tool = null } = {}) {
  if (!FILE_CHANGES.has(projectId)) FILE_CHANGES.set(projectId, new Map())
  const changes = FILE_CHANGES.get(projectId)
  const existing = changes.get(path)
  changes.set(path, {
    path,
    // The first snapshot wins, including a null "did not exist" state, so a
    // created-then-edited file keeps its "added" semantics.
    before: existing ? existing.before : truncatedSnapshot(before),
    after: truncatedSnapshot(after),
    source,
    tool,
    at: new Date().toISOString(),
  })
  while (changes.size > 500 || (changeBytes(changes) > MAX_CHANGE_TOTAL_BYTES && changes.size > 1)) {
    const oldest = [...changes.keys()][0]
    if (oldest === path) break
    changes.delete(oldest)
  }
}

export function listFileChanges(projectId) {
  const changes = FILE_CHANGES.get(projectId)
  if (!changes) return []
  return [...changes.values()].map((change) => ({
    path: change.path, source: change.source, tool: change.tool, at: change.at,
    added: change.before === null && change.after !== null,
    removed: change.after === null && change.before !== null,
  }))
}

export function getFileDiff(projectId, path) {
  const changes = FILE_CHANGES.get(projectId)
  const change = changes?.get(path)
  if (!change) return null
  return { ...change, diff: buildLineDiff(change.before || '', change.after || '') }
}

function buildLineDiff(beforeText, afterText) {
  const before = String(beforeText).split('\n')
  const after = String(afterText).split('\n')

  // Strip the common prefix and suffix first so replacements in the middle of a
  // file are not reported as a cascade of add/remove pairs.
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1
  let endBefore = before.length - 1
  let endAfter = after.length - 1
  while (endBefore >= start && endAfter >= start && before[endBefore] === after[endAfter]) { endBefore -= 1; endAfter -= 1 }

  const middleBefore = before.slice(start, endBefore + 1)
  const middleAfter = after.slice(start, endAfter + 1)
  const middleMax = Math.max(middleBefore.length, middleAfter.length)
  const lines = []
  for (let index = 0; index < start; index += 1) lines.push({ type: 'same', left: before[index], right: after[index] })
  let added = 0
  let removed = 0
  for (let index = 0; index < middleMax; index += 1) {
    const left = middleBefore[index]
    const right = middleAfter[index]
    if (left === right) {
      if (left !== undefined) lines.push({ type: 'same', left, right })
    } else {
      if (left !== undefined) { lines.push({ type: 'remove', left }); removed += 1 }
      if (right !== undefined) { lines.push({ type: 'add', right }); added += 1 }
    }
  }
  for (let index = endBefore + 1; index < before.length; index += 1) {
    lines.push({ type: 'same', left: before[index], right: after[index - (before.length - after.length)] })
  }
  return { lines: lines.slice(0, 2000), added, removed }
}

export async function createProject({ name, stack, userId = 'local-user', task = '' } = {}) {
  const template = stack ? templateById(stack) : detectTemplateFromRequest(task)
  const id = projectIdFor(userId, name || template.id)
  const project = {
    id,
    userId: normalizeUserId(userId),
    name: String(name || 'مشروع Nados').slice(0, 120),
    stack: template.id,
    stackLabel: template.label,
    status: 'created',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await ensureProjectRoot(id)
  const files = templateFiles(template, project.name)
  for (const [path, content] of Object.entries(files)) {
    const relative = path.replace(/^\/+/, '')
    const result = await writeFileTool(id, relative, content)
    if (result.replaced) recordFileChange(id, result.path, { before: result.before, after: content, source: 'template' })
  }
  // Sidecar metadata so ownership and stack survive a restart even without
  // Supabase. It is excluded from the file tree and ZIP exports.
  await writeFileTool(id, '.nados-project.json', JSON.stringify({
    id,
    userId: project.userId,
    name: project.name,
    stack: project.stack,
    createdAt: project.createdAt,
  }, null, 2))
  PROJECTS.set(id, project)
  await persistProject(project)
  return project
}

export function getProject(projectId) {
  return PROJECTS.get(String(projectId || '')) || null
}

// Ownership check used by every /api/work route. Identity itself still comes
// from the request (the app has no auth layer yet), so this is defense in depth.
export function projectBelongsTo(projectId, userId) {
  const project = getProject(projectId)
  if (!project) return false
  return project.userId === normalizeUserId(userId)
}

export function listProjects(userId = null) {
  const all = [...PROJECTS.values()]
  const filtered = userId ? all.filter((project) => project.userId === normalizeUserId(userId)) : all
  return filtered.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export async function listProjectsForUser(userId) {
  const normalized = normalizeUserId(userId)
  const local = listProjects(normalized)
  const known = new Set(local.map((project) => project.id))
  const persisted = await loadPersistedProjects(normalized)
  const merged = [...local]
  for (const row of persisted) {
    if (known.has(row.project_id)) continue
    const project = {
      id: row.project_id, userId: normalized, name: row.name, stack: row.stack, stackLabel: templateById(row.stack).label,
      status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, rehydrated: true,
    }
    PROJECTS.set(project.id, project)
    merged.push(project)
  }
  return merged.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export async function deleteProject(projectId) {
  const id = String(projectId || '')
  const project = PROJECTS.get(id)
  const existedOnDisk = PROJECT_ID_RE.test(id) && existsSync(projectRoot(id))
  PROJECTS.delete(id)
  FILE_CHANGES.delete(id)
  resetUsage(id)
  try { await rm(projectRoot(id), { recursive: true, force: true }) } catch {}
  await deletePersistedProject(id)
  return { deleted: Boolean(project) || existedOnDisk, id }
}

// Rebuilds the in-memory registry from workspaces that already exist on disk, so
// projects are never orphaned after a restart when Supabase is not configured.
export async function rehydrateProjectsFromDisk() {
  if (!existsSync(WORKSPACES_ROOT)) return 0
  let entries = []
  try { entries = await readdir(WORKSPACES_ROOT, { withFileTypes: true }) } catch { return 0 }
  let added = 0
  for (const entry of entries) {
    if (!entry.isDirectory() || !PROJECT_ID_RE.test(entry.name) || PROJECTS.has(entry.name)) continue
    let stack = 'static'
    let userId = 'local-user'
    let name = entry.name
    let createdAt = new Date().toISOString()
    try {
      const meta = JSON.parse((await readFileTool(entry.name, '.nados-project.json')).content)
      if (typeof meta?.userId === 'string' && meta.userId) userId = normalizeUserId(meta.userId)
      if (typeof meta?.stack === 'string' && meta.stack) stack = meta.stack
      if (typeof meta?.name === 'string' && meta.name) name = meta.name
      if (typeof meta?.createdAt === 'string' && meta.createdAt) createdAt = meta.createdAt
    } catch {
      try {
        const pkg = JSON.parse((await readFileTool(entry.name, 'package.json')).content)
        if (pkg?.dependencies?.react) stack = 'react-vite'
        else if (pkg?.scripts?.start) stack = 'node-api'
      } catch {}
    }
    const now = new Date().toISOString()
    PROJECTS.set(entry.name, {
      id: entry.name,
      userId,
      name,
      stack,
      stackLabel: templateById(stack).label,
      status: 'rehydrated',
      createdAt,
      updatedAt: now,
      rehydrated: true,
    })
    added += 1
  }
  return added
}

export function touchProject(projectId, patch = {}) {
  const project = PROJECTS.get(String(projectId || ''))
  if (!project) return null
  Object.assign(project, patch, { updatedAt: new Date().toISOString() })
  void persistProject(project)
  return project
}

// ------------------------- workspace operations -----------------------------

export async function projectTree(projectId, dir = '.') {
  if (!existsSync(projectRoot(projectId))) throw new SandboxError('NOT_FOUND', 'مساحة عمل المشروع غير موجودة')
  return await treeTool(projectId, dir)
}

export async function projectList(projectId, dir = '.') {
  return await listFilesTool(projectId, dir)
}

export async function projectReadFile(projectId, path) {
  return await readFileTool(projectId, path)
}

export async function projectWriteFile(projectId, path, content, { source = 'user' } = {}) {
  const result = await writeFileTool(projectId, path, content)
  recordFileChange(projectId, result.path, { before: result.before, after: String(content ?? ''), source, tool: 'write_file' })
  touchProject(projectId, { status: 'modified' })
  return result
}

export async function projectEditFile(projectId, path, options, { source = 'user' } = {}) {
  const result = await editFileTool(projectId, path, options)
  recordFileChange(projectId, result.path, { before: result.before, after: result.after, source, tool: 'edit_file' })
  touchProject(projectId, { status: 'modified' })
  return result
}

export async function projectDeleteFile(projectId, path, { source = 'user' } = {}) {
  const read = await readFileTool(projectId, path).catch(() => null)
  const result = await deleteFileTool(projectId, path)
  if (read) recordFileChange(projectId, read.path, { before: read.content, after: null, source, tool: 'delete_file' })
  touchProject(projectId, { status: 'modified' })
  return result
}

export async function projectCreateDirectory(projectId, path) {
  const result = await createDirectoryTool(projectId, path)
  touchProject(projectId, { status: 'modified' })
  return result
}

export async function projectMoveFile(projectId, from, to, { source = 'user' } = {}) {
  const read = await readFileTool(projectId, from).catch(() => null)
  const result = await moveFileTool(projectId, from, to)
  if (read) {
    recordFileChange(projectId, result.from, { before: read.content, after: null, source, tool: 'move_file' })
    recordFileChange(projectId, result.to, { before: null, after: read.content, source, tool: 'move_file' })
  }
  touchProject(projectId, { status: 'modified' })
  return result
}

export async function projectCopyFile(projectId, from, to) {
  const result = await copyFileTool(projectId, from, to)
  touchProject(projectId, { status: 'modified' })
  return result
}

export async function projectSearch(projectId, query, dir = '.') {
  return await searchFilesTool(projectId, query, dir)
}

export async function projectSummary(projectId) {
  const project = getProject(projectId)
  const tree = await projectTree(projectId).catch(() => ({ files: 0, bytes: 0 }))
  return { project, stats: { files: tree.files || 0, bytes: tree.bytes || 0 }, changes: listFileChanges(projectId).length }
}

