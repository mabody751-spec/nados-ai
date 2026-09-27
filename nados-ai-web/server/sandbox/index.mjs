import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import {
  BLOCKED_INLINE_EVAL,
  GIT_BLOCKED_SUBCOMMANDS,
  NPM_BLOCKED_SUBCOMMANDS,
  SHELL_METACHARACTERS,
  assertProgramAllowed,
  isBlockedExtension,
  normalizeProgram,
} from './policy.mjs'

// ---------------------------------------------------------------------------
// Sandbox engine: real filesystem + real processes confined to a per-project
// workspace. This is the local execution provider. The public surface is a
// provider interface so a Cloudflare Sandbox adapter can be swapped in for
// container-backed deployments without changing callers.
// ---------------------------------------------------------------------------

const SANDBOX_ROOT = resolve(process.env.NADOS_SANDBOX_ROOT || join(process.cwd(), 'workspaces'))
export const WORKSPACES_ROOT = resolve(process.env.NADOS_WORKSPACES_ROOT || SANDBOX_ROOT)

const PROJECT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/

export const LIMITS = {
  maxFileBytes: Number(process.env.NADOS_WORK_MAX_FILE_BYTES) || 2_000_000,
  maxFilesInProject: Number(process.env.NADOS_WORK_MAX_FILES) || 3_000,
  maxProjectBytes: Number(process.env.NADOS_WORK_MAX_PROJECT_BYTES) || 200_000_000,
  maxOutputChars: Number(process.env.NADOS_WORK_MAX_OUTPUT_CHARS) || 65_536,
  commandTimeoutMs: Number(process.env.NADOS_WORK_COMMAND_TIME_MS) || 120_000,
  installTimeoutMs: Number(process.env.NADOS_WORK_INSTALL_TIME_MS) || 300_000,
  serverBootTimeoutMs: Number(process.env.NADOS_WORK_SERVER_BOOT_MS) || 45_000,
  maxSearchResults: 40,
  maxSearchFiles: 400,
  maxTreeDepth: 6,
}

// Children get an explicit allowlist of variables rather than inheriting the
// host environment minus a denylist, so unknown secret names cannot leak.
const CHILD_ENV_ALLOWLIST = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'TEMP', 'TMP',
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL', 'TZ', 'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE', 'OS', 'TERM', 'PYTHONIOENCODING',
]

const REDACTIONS = [
  /\b(sk|rk|gsk|ghp|gho|ghs|github_pat|xoxb|xoxp|AKIA)[-_a-zA-Z0-9]{8,}\b/g,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\b/g,
  // Any KEY=VALUE whose name looks secret-bearing.
  /\b([A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|API_?KEY)[A-Za-z0-9_]*\s*[=:]\s*)["']?[^\s"',]{4,}/gi,
]

export function redactSecrets(value) {
  let text = String(value ?? '')
  for (const pattern of REDACTIONS) {
    text = text.replace(pattern, (match, prefix) => (typeof prefix === 'string' ? `${prefix}***` : '***'))
  }
  return text
}

export class SandboxError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.name = 'SandboxError'
    this.code = code
  }
}

export function projectRoot(projectId) {
  const id = String(projectId || '')
  if (!PROJECT_ID_RE.test(id)) throw new SandboxError('INVALID_PROJECT', `معرّف المشروع غير صالح: ${id}`)
  const root = resolve(WORKSPACES_ROOT, id)
  if (!root.startsWith(WORKSPACES_ROOT + sep)) throw new SandboxError('SANDBOX_ESCAPE', 'مسار المشروع خارج الجلسة المعزولة')
  return root
}

export async function ensureProjectRoot(projectId) {
  const root = projectRoot(projectId)
  await mkdir(root, { recursive: true })
  return root
}

// Normalizes and confines every caller-supplied path to the project root.
export function safePath(projectId, targetPath, { forWrite = false } = {}) {
  const root = projectRoot(projectId)
  const raw = String(targetPath ?? '').trim().replace(/\\/g, '/')
  if (!raw || raw === '.') return root
  if (/^[a-zA-Z]:\//.test(raw) || raw.startsWith('//') || isAbsolute(raw) || raw.startsWith('/')) {
    throw new SandboxError('SANDBOX_ESCAPE', `مسار مطلق مرفوض: ${targetPath}`)
  }
  const segments = raw.split('/').filter((part) => part && part !== '.')
  if (segments.some((part) => part === '..')) {
    throw new SandboxError('SANDBOX_ESCAPE', `صعود خارج الجلسة المعزولة مرفوض: ${targetPath}`)
  }
  if (segments.some((part) => /[<>:"|?*\u0000-\u001f]/.test(part) || part.length > 200)) {
    throw new SandboxError('INVALID_PATH', `المسار يحتوي رموزاً مرفوضة: ${targetPath}`)
  }
  if (forWrite && isBlockedExtension(raw)) {
    throw new SandboxError('BLOCKED_TYPE', `نوع الملف محجوب: ${targetPath}`)
  }
  const resolved = resolve(root, ...segments)
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new SandboxError('SANDBOX_ESCAPE', `المسار خارج نطاق المشروع: ${targetPath}`)
  }
  return resolved
}

export function relativePath(projectId, absolutePath) {
  const root = projectRoot(projectId)
  const rel = resolve(absolutePath).slice(root.length).replace(/^[\\/]+/, '')
  return rel.replace(/\\/g, '/')
}

// Per-project usage is cached so writes do not rescan the whole tree (which was
// O(n^2) over a task) while still enforcing files/bytes quotas.
const USAGE = new Map()

export async function projectStats(projectId) {
  const root = projectRoot(projectId)
  if (!existsSync(root)) return { files: 0, bytes: 0 }
  const IGNORED = new Set(['node_modules', '.git'])
  let files = 0
  let bytes = 0
  async function walk(dir, depth) {
    if (depth > 12) return
    let entries = []
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { files += 1; await walk(full, depth + 1); continue }
      try {
        const info = await stat(full)
        files += 1
        bytes += info.size
      } catch {}
    }
  }
  await walk(root, 0)
  return { files, bytes }
}

async function usage(projectId, { refresh = false } = {}) {
  const cached = USAGE.get(projectId)
  if (cached && !refresh) return cached
  const stats = await projectStats(projectId)
  const value = { files: stats.files, bytes: stats.bytes, at: Date.now() }
  USAGE.set(projectId, value)
  return value
}

function adjustUsage(projectId, deltaFiles, deltaBytes) {
  const cached = USAGE.get(projectId)
  if (!cached) return
  cached.files = Math.max(0, cached.files + deltaFiles)
  cached.bytes = Math.max(0, cached.bytes + deltaBytes)
  cached.at = Date.now()
}

export async function assertWithinLimits(projectId, { deltaFiles = 0, deltaBytes = 0 } = {}) {
  const current = await usage(projectId)
  if (current.files + deltaFiles > LIMITS.maxFilesInProject) {
    throw new SandboxError('PROJECT_TOO_LARGE', `عدد ملفات المشروع يتجاوز الحد ${LIMITS.maxFilesInProject}`)
  }
  if (current.bytes + deltaBytes > LIMITS.maxProjectBytes) {
    throw new SandboxError('PROJECT_TOO_LARGE', `حجم المشروع يتجاوز الحد ${Math.round(LIMITS.maxProjectBytes / 1_000_000)}MB`)
  }
}

export function resetUsage(projectId) {
  USAGE.delete(String(projectId || ''))
}

// --------------------------- filesystem operations ---------------------------

export async function readFileTool(projectId, targetPath) {
  const target = safePath(projectId, targetPath)
  if (!existsSync(target)) throw new SandboxError('NOT_FOUND', `الملف غير موجود: ${targetPath}`)
  const info = await stat(target)
  if (info.isDirectory()) throw new SandboxError('IS_DIRECTORY', `المسار مجلد وليس ملفاً: ${targetPath}`)
  if (info.size > LIMITS.maxFileBytes) throw new SandboxError('FILE_TOO_LARGE', `حجم الملف ${Math.round(info.size / 1024)}KB يتجاوز الحد`)
  const content = await readFile(target, 'utf8')
  return { path: relativePath(projectId, target), content, bytes: info.size, modifiedAt: info.mtime.toISOString() }
}

export async function writeFileTool(projectId, targetPath, content) {
  await ensureProjectRoot(projectId)
  const target = safePath(projectId, targetPath, { forWrite: true })
  const body = String(content ?? '')
  const newBytes = Buffer.byteLength(body, 'utf8')
  if (newBytes > LIMITS.maxFileBytes) throw new SandboxError('FILE_TOO_LARGE', `المحتوى يتجاوز الحد المسموح (${Math.round(LIMITS.maxFileBytes / 1_000_000)}MB)`)
  const exists = existsSync(target)
  let before = null
  let previousBytes = 0
  if (exists) {
    try {
      before = await readFile(target, 'utf8')
      previousBytes = Buffer.byteLength(before, 'utf8')
    } catch { before = null }
  }
  await assertWithinLimits(projectId, { deltaFiles: exists ? 0 : 1, deltaBytes: newBytes - previousBytes })
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, body, 'utf8')
  adjustUsage(projectId, exists ? 0 : 1, newBytes - previousBytes)
  return { path: relativePath(projectId, target), bytes: newBytes, created: before === null, replaced: before !== null, before }
}

export async function editFileTool(projectId, targetPath, { find, replace, replaceAll = false } = {}) {
  const target = safePath(projectId, targetPath, { forWrite: true })
  if (!existsSync(target)) throw new SandboxError('NOT_FOUND', `الملف غير موجود: ${targetPath}`)
  const before = await readFile(target, 'utf8')
  const needle = String(find ?? '')
  if (!needle) throw new SandboxError('INVALID_ARGUMENT', 'نص البحث (find) مطلوب')
  if (!before.includes(needle)) throw new SandboxError('NOT_FOUND', `لم يُعثر على النص المطلوب داخل ${targetPath}`)
  const after = replaceAll ? before.replaceAll(needle, String(replace ?? '')) : before.replace(needle, String(replace ?? ''))
  const afterBytes = Buffer.byteLength(after, 'utf8')
  if (afterBytes > LIMITS.maxFileBytes) throw new SandboxError('FILE_TOO_LARGE', 'Ø§Ù„Ù…ØØªÙˆÙ‰ Ø§Ù„Ù†Ø§ØªØ¬ ÙŠØªØ¬Ø§ÙˆØ² Ø§Ù„ØØ¯')
  await assertWithinLimits(projectId, { deltaBytes: afterBytes - Buffer.byteLength(before, 'utf8') })
  await writeFile(target, after, 'utf8')
  adjustUsage(projectId, 0, afterBytes - Buffer.byteLength(before, 'utf8'))
  return {
    path: relativePath(projectId, target),
    bytes: afterBytes,
    replacements: replaceAll ? countOccurrences(before, needle) : 1,
    before,
    after,
  }
}

function countOccurrences(haystack, needle) {
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

// Counts a subtree so usage can be adjusted when a path is deleted.
async function subtreeUsage(target) {
  let files = 0
  let bytes = 0
  async function walk(dir, depth) {
    if (depth > 12) return
    let entries = []
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const full = join(dir, entry.name)
      files += 1
      if (entry.isDirectory()) { await walk(full, depth + 1); continue }
      try { bytes += (await stat(full)).size } catch {}
    }
  }
  try {
    const info = await stat(target)
    if (info.isDirectory()) await walk(target, 0)
    else { files = 1; bytes = info.size }
  } catch {}
  return { files, bytes }
}

export async function deleteFileTool(projectId, targetPath) {
  const target = safePath(projectId, targetPath)
  const root = projectRoot(projectId)
  if (target === root) throw new SandboxError('INVALID_PATH', 'لا يمكن حذف جذر المشروع')
  if (!existsSync(target)) throw new SandboxError('NOT_FOUND', `المسار غير موجود: ${targetPath}`)
  const removed = await subtreeUsage(target)
  await rm(target, { recursive: true, force: true })
  adjustUsage(projectId, -removed.files, -removed.bytes)
  return { path: relativePath(projectId, target), deleted: true }
}

export async function createDirectoryTool(projectId, targetPath) {
  const target = safePath(projectId, targetPath, { forWrite: true })
  const exists = existsSync(target)
  await assertWithinLimits(projectId, { deltaFiles: exists ? 0 : 1 })
  await mkdir(target, { recursive: true })
  if (!exists) adjustUsage(projectId, 1, 0)
  return { path: relativePath(projectId, target), created: true }
}

export async function moveFileTool(projectId, from, to) {
  const source = safePath(projectId, from)
  const destination = safePath(projectId, to, { forWrite: true })
  if (!existsSync(source)) throw new SandboxError('NOT_FOUND', `المصدر غير موجود: ${from}`)
  const previous = existsSync(destination) ? await subtreeUsage(destination) : { files: 0, bytes: 0 }
  await mkdir(dirname(destination), { recursive: true })
  await rm(destination, { recursive: true, force: true })
  await rename(source, destination)
  adjustUsage(projectId, -previous.files, -previous.bytes)
  return { from: relativePath(projectId, source), to: relativePath(projectId, destination), moved: true }
}

export async function copyFileTool(projectId, from, to) {
  const source = safePath(projectId, from)
  const destination = safePath(projectId, to, { forWrite: true })
  if (!existsSync(source)) throw new SandboxError('NOT_FOUND', `المصدر غير موجود: ${from}`)
  const sourceUsage = await subtreeUsage(source)
  const replacedUsage = existsSync(destination) ? await subtreeUsage(destination) : { files: 0, bytes: 0 }
  await assertWithinLimits(projectId, { deltaFiles: sourceUsage.files - replacedUsage.files, deltaBytes: sourceUsage.bytes - replacedUsage.bytes })
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(source, destination)
  adjustUsage(projectId, sourceUsage.files - replacedUsage.files, sourceUsage.bytes - replacedUsage.bytes)
  return { from: relativePath(projectId, source), to: relativePath(projectId, destination), copied: true }
}

export async function listFilesTool(projectId, dirPath = '.') {
  const target = safePath(projectId, dirPath)
  if (!existsSync(target)) throw new SandboxError('NOT_FOUND', `المسار غير موجود: ${dirPath}`)
  const info = await stat(target)
  if (!info.isDirectory()) throw new SandboxError('NOT_DIRECTORY', `المسار ليس مجلداً: ${dirPath}`)
  const entries = await readdir(target, { withFileTypes: true })
  const files = []
  for (const entry of entries.slice(0, 500)) {
    if (entry.name === '.nados-project.json') continue
    const full = join(target, entry.name)
    let size = null
    let modifiedAt = null
    try {
      const entryInfo = await stat(full)
      size = entryInfo.isDirectory() ? null : entryInfo.size
      modifiedAt = entryInfo.mtime.toISOString()
    } catch {}
    files.push({ name: entry.name, path: relativePath(projectId, full), type: entry.isDirectory() ? 'dir' : 'file', size, modifiedAt })
  }
  return { dir: relativePath(projectId, target) || '.', files, total: entries.length }
}

export async function treeTool(projectId, dirPath = '.', { depth = LIMITS.maxTreeDepth } = {}) {
  const root = safePath(projectId, dirPath)
  const IGNORED = new Set(['node_modules', '.git', 'dist', '.wrangler', 'test-results', '.nados-project.json'])
  let files = 0
  let bytes = 0
  async function walk(dir, level) {
    if (level > depth) return []
    let entries = []
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return [] }
    const nodes = []
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        const children = await walk(full, level + 1)
        nodes.push({ name: entry.name, path: relativePath(projectId, full), type: 'dir', children })
      } else {
        let size = null
        let modifiedAt = null
        try {
          const entryInfo = await stat(full)
          size = entryInfo.size
          modifiedAt = entryInfo.mtime.toISOString()
          files += 1
          bytes += size
        } catch {}
        nodes.push({ name: entry.name, path: relativePath(projectId, full), type: 'file', size, modifiedAt })
      }
    }
    return nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
  }
  const tree = await walk(root, 0)
  return { dir: relativePath(projectId, root) || '.', tree, files, bytes }
}

export async function searchFilesTool(projectId, query, dirPath = '.') {
  const needle = String(query || '').toLowerCase()
  if (!needle) throw new SandboxError('INVALID_ARGUMENT', 'كلمة البحث مطلوبة')
  const start = safePath(projectId, dirPath)
  const results = []
  const IGNORED = new Set(['node_modules', '.git', 'dist', '.wrangler', 'test-results'])
  let scanned = 0
  let truncated = false
  async function scan(dir, depth) {
    if (depth > 4 || results.length >= LIMITS.maxSearchResults || scanned >= LIMITS.maxSearchFiles) return
    let entries = []
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (results.length >= LIMITS.maxSearchResults || scanned >= LIMITS.maxSearchFiles) { truncated = true; return }
      if (IGNORED.has(entry.name) || (entry.name.startsWith('.') && entry.name !== '.env.example')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { await scan(full, depth + 1); continue }
      if (isBlockedExtension(entry.name) || entry.name.length > 120) continue
      scanned += 1
      try {
        const info = await stat(full)
        if (info.size > 400_000) continue
        const content = await readFile(full, 'utf8')
        const lower = content.toLowerCase()
        const index = lower.indexOf(needle)
        if (index >= 0) {
          const line = content.slice(0, index).split('\n').length
          results.push({
            file: relativePath(projectId, full),
            line,
            snippet: redactSecrets(content.slice(Math.max(0, index - 60), index + 140).replace(/\s+/g, ' ').trim()),
          })
        }
      } catch {}
    }
  }
  await scan(start, 0)
  return { query, results, total: results.length, scanned, truncated: truncated && results.length < LIMITS.maxSearchResults }
}

// ------------------------------ commands -----------------------------------

export function parseArgv(input) {
  const argv = []
  let current = ''
  let quote = null
  for (const char of String(input || '')) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (/\s/.test(char)) {
      if (current) { argv.push(current); current = '' }
    } else {
      current += char
    }
  }
  if (current) argv.push(current)
  return argv
}

function validateCommand(argv) {
  if (!argv.length) throw new SandboxError('INVALID_COMMAND', 'الأمر فارغ')
  if (argv.length > 60) throw new SandboxError('INVALID_COMMAND', 'عدد وسائط الأمر كبير جداً')
  const program = normalizeProgram(argv[0])
  try {
    assertProgramAllowed(program, { mode: 'execute' })
  } catch (error) {
    throw new SandboxError(error.code || 'COMMAND_BLOCKED', error.message.replace(/^[A-Z_]+:\s*/, ''))
  }
  const args = argv.slice(1)
  for (const arg of args) {
    if (SHELL_METACHARACTERS.test(arg)) throw new SandboxError('COMMAND_BLOCKED', `وسيطة تحتوي رموز تنفيذ مرفوضة: ${redactSecrets(arg).slice(0, 60)}`)
    if (/(^|[\\/])\.\.([\\/]|$)/.test(arg)) throw new SandboxError('SANDBOX_ESCAPE', 'وسيطة تحتوي صعوداً خارج المشروع')
    if (/^[a-zA-Z]:[\\/]/.test(arg) || arg.startsWith('/etc') || arg.startsWith('/root') || arg.startsWith('/proc')) {
      throw new SandboxError('SANDBOX_ESCAPE', 'وسيطة تشير إلى مسار خارج المشروع')
    }
  }
  if (program === 'node' && args.some((arg) => BLOCKED_INLINE_EVAL.test(arg))) {
    throw new SandboxError('COMMAND_BLOCKED', 'تنفيذ كود مباشر عبر node محجوب في الجلسة المعزولة')
  }
  if ((program === 'python' || program === 'python3') && args[0] === '-c') {
    throw new SandboxError('COMMAND_BLOCKED', 'تنفيذ كود مباشر عبر python محجوب في الجلسة المعزولة')
  }
  if (program === 'git') {
    const sub = String(args[0] || '').toLowerCase()
    if (!sub || GIT_BLOCKED_SUBCOMMANDS.has(sub)) {
      throw new SandboxError('COMMAND_BLOCKED', `أمر git غير مسموح: ${sub || '(بدون أمر)'} — git متاح للقراءة والفحص فقط (push/pull/clone/commit/reset محجوبة)`)
    }
  }
  if (program === 'npm' || program === 'yarn' || program === 'pnpm') {
    const sub = String(args[0] || '').toLowerCase()
    if (NPM_BLOCKED_SUBCOMMANDS.has(sub)) throw new SandboxError('COMMAND_BLOCKED', `أمر النشر/التحقق محجوب: ${sub}`)
  }
  return { program, args }
}

// Children receive an explicit allowlist, never the host environment, so
// unknown or future secret variable names cannot leak into project processes.
// Spawned processes get a neutral HOME inside a sandbox directory instead of the
// real user profile, so a task (or an installed dependency) cannot read the
// host user's config or credentials under ~/.ssh, ~/.aws, AppData, etc.
const SANDBOX_HOME = join(os.tmpdir(), 'nados-sandbox-home')

function childEnvironment() {
  const env = {}
  const profileKeys = new Set(['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'])
  for (const key of CHILD_ENV_ALLOWLIST) {
    if (profileKeys.has(key)) continue
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  try { mkdirSync(SANDBOX_HOME, { recursive: true }) } catch {}
  env.HOME = SANDBOX_HOME
  env.USERPROFILE = SANDBOX_HOME
  env.APPDATA = SANDBOX_HOME
  env.LOCALAPPDATA = SANDBOX_HOME
  env.NADOS_SANDBOXED = '1'
  env.NODE_ENV = 'development'
  return env
}

function quoteForCmd(token) {
  const value = String(token)
  if (value && !/[\s"^&|<>]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

export function buildCommandString(argv) {
  if (process.platform === 'win32') return argv.map(quoteForCmd).join(' ')
  return argv.join(' ')
}

export function detectInstallCommand(program, args) {
  const sub = String(args[0] || '').toLowerCase()
  if ((program === 'npm' || program === 'yarn' || program === 'pnpm') && ['install', 'i', 'ci', 'add'].includes(sub)) return true
  if (['pip', 'pip3'].includes(program) && sub === 'install') return true
  if ((program === 'python' || program === 'python3') && args[0] === '-m' && String(args[1] || '').toLowerCase() === 'pip' && String(args[2] || '') === 'install') return true
  return false
}

const runningChildren = new Map()

export function terminateCommand(projectId) {
  const child = runningChildren.get(projectId)
  if (!child) return false
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    else child.kill('SIGKILL')
  } catch {}
  runningChildren.delete(projectId)
  return true
}

export async function executeCommandTool(projectId, command, { timeoutMs } = {}) {
  const argv = parseArgv(command)
  const { program, args } = validateCommand(argv)
  const cwd = projectRoot(projectId)
  await ensureProjectRoot(projectId)
  const isInstall = detectInstallCommand(program, args)
  const limit = Math.min(timeoutMs || (isInstall ? LIMITS.installTimeoutMs : LIMITS.commandTimeoutMs), LIMITS.installTimeoutMs)
  const startedAt = Date.now()

  const invocation = process.platform === 'win32'
    ? { file: process.env.comspec || 'cmd.exe', args: ['/d', '/s', '/c', buildCommandString(argv)] }
    : { file: program, args }

  return await new Promise((resolvePromise) => {
    let stdout = ''
    let stderr = ''
    let truncated = false
    let settled = false
    const append = (current, chunk) => {
      if (current.length > LIMITS.maxOutputChars * 2) { truncated = true; return current }
      return current + chunk
    }
    let child
    try {
      child = spawn(invocation.file, invocation.args, {
        cwd,
        env: childEnvironment(),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      return resolvePromise({
        command, program, exitCode: null, stdout: '', stderr: redactSecrets(String(error?.message || error)),
        durationMs: Date.now() - startedAt, status: 'error', error: 'فشل تشغيل الأمر',
      })
    }
    runningChildren.set(projectId, child)
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
        else child.kill('SIGKILL')
      } catch {}
      resolvePromise({
        command, program, exitCode: null, stdout: redactSecrets(stdout.slice(-LIMITS.maxOutputChars)),
        stderr: redactSecrets(`${stderr}\n⏱ انتهت مهلة الأمر (${Math.round(limit / 1000)}ث)`),
        durationMs: Date.now() - startedAt, status: 'timeout', timedOut: true, truncated,
      })
    }, limit)

    child.stdout?.on('data', (chunk) => { stdout = append(stdout, String(chunk)) })
    child.stderr?.on('data', (chunk) => { stderr = append(stderr, String(chunk)) })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      runningChildren.delete(projectId)
      resolvePromise({
        command, program, exitCode: null, stdout: redactSecrets(stdout.slice(-LIMITS.maxOutputChars)),
        stderr: redactSecrets(String(error?.message || error)), durationMs: Date.now() - startedAt,
        status: 'error', error: 'فشل تشغيل الأمر',
      })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      runningChildren.delete(projectId)
      resolvePromise({
        command, program, exitCode: code,
        stdout: redactSecrets(stdout.slice(-LIMITS.maxOutputChars)),
        stderr: redactSecrets(stderr.slice(-LIMITS.maxOutputChars)),
        durationMs: Date.now() - startedAt,
        status: code === 0 ? 'success' : 'failed',
        truncated,
      })
    })
  })
}

// --------------------------- background servers -----------------------------

const servers = new Map()

export function getServer(projectId) {
  const server = servers.get(projectId)
  if (!server) return null
  return { projectId: server.projectId, command: server.command, pid: server.pid, port: server.port, url: server.url, status: server.status, startedAt: server.startedAt, logs: server.logs.slice(-200) }
}

function pushServerLog(server, chunk) {
  const text = String(chunk)
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    server.logs.push(redactSecrets(line).slice(0, 500))
  }
  if (server.logs.length > 400) server.logs.splice(0, server.logs.length - 400)
}

async function isPortOpen(port) {
  return await new Promise((resolvePromise) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const done = (result) => { socket.destroy(); resolvePromise(result) }
    socket.setTimeout(700)
    socket.on('connect', () => done(true))
    socket.on('timeout', () => done(false))
    socket.on('error', () => done(false))
  })
}

const PORT_PATTERN = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]|::)?:(\d{2,5})/g
const COMMON_PORTS = [5173, 4173, 3000, 3001, 8080, 8000, 5000, 4321, 8788]

// Verifies that a listening port belongs to our spawned process tree, so the
// preview proxy cannot be pointed at an unrelated local service. On Windows we
// resolve the owning PID via netstat and compare it against the child's
// descendants (npm/cmd spawn the real server as a grandchild).
const ownedPidCache = new Map()

async function descendantPids(rootPid) {
  const root = Number(rootPid)
  if (!root) return null
  const cached = ownedPidCache.get(root)
  if (cached && Date.now() - cached.at < 3_000) return cached.pids
  if (process.platform !== 'win32') {
    const pids = new Set([root])
    ownedPidCache.set(root, { at: Date.now(), pids })
    return pids
  }
  try {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const script = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId):$($_.ParentProcessId)" }'
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 8000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 })
    const parents = new Map()
    for (const line of String(stdout).split(/\r?\n/)) {
      const [child, parent] = line.trim().split(':').map(Number)
      if (child) parents.set(child, parent)
    }
    const pids = new Set([root])
    let changed = true
    while (changed) {
      changed = false
      for (const [child, parent] of parents) {
        if (pids.has(parent) && !pids.has(child)) { pids.add(child); changed = true }
      }
    }
    ownedPidCache.set(root, { at: Date.now(), pids })
    return pids
  } catch {
    return null
  }
}

async function portOwnedByPid(port, pid) {
  const owned = await descendantPids(pid)
  if (!owned) return false
  if (process.platform !== 'win32') return true
  try {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const { stdout } = await promisify(execFile)('netstat', ['-ano', '-p', 'tcp'], { timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 })
    const needle = `:${port}`
    for (const line of String(stdout).split(/\r?\n/)) {
      if (!line.includes('LISTENING') || !line.includes(needle)) continue
      const parts = line.trim().split(/\s+/)
      const owner = Number(parts[parts.length - 1])
      if (owned.has(owner)) return true
    }
    return false
  } catch {
    return false
  }
}

async function tryPort(server, port, { requireOwner = true } = {}) {
  if (!(await isPortOpen(port))) return false
  if (requireOwner && !(await portOwnedByPid(port, server.pid))) return false
  server.port = port
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2500) })
    server.httpStatus = response.status
  } catch {
    server.httpStatus = null
  }
  return true
}

async function waitForPort(server, timeoutMs, { ignorePorts = new Set() } = {}) {
  const startedAt = Date.now()
  const deadline = startedAt + timeoutMs
  while (Date.now() < deadline) {
    // Ports logged by our own child process are preferred, but must be owned by it.
    const candidates = new Set()
    for (const match of server.logs.join('\n').matchAll(PORT_PATTERN)) {
      const port = Number(match[1])
      if (port > 0 && port < 65_536 && !ignorePorts.has(port)) candidates.add(port)
    }
    for (const port of candidates) {
      if (Date.now() > deadline) return false
      if (await tryPort(server, port)) return true
    }
    // Only fall back to common dev ports after a grace period, never to a port
    // occupied before our process started, and only when the child owns it.
    if (Date.now() - startedAt > 8_000) {
      for (const port of COMMON_PORTS) {
        if (Date.now() > deadline) return false
        if (ignorePorts.has(port)) continue
        if (await tryPort(server, port)) return true
      }
    }
    if (server.exitCode !== undefined && server.exitCode !== null) break
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 600))
  }
  return false
}

export async function startServer(projectId, command) {
  await stopServer(projectId)
  const cwd = projectRoot(projectId)
  const argv = parseArgv(command)
  const { program, args } = validateCommand(argv)
  const invocation = process.platform === 'win32'
    ? { file: process.env.comspec || 'cmd.exe', args: ['/d', '/s', '/c', buildCommandString(argv)] }
    : { file: program, args }
  const server = {
    projectId, command, pid: null, port: null, url: null, status: 'starting',
    startedAt: new Date().toISOString(), logs: [], child: null, httpStatus: null,
  }
  servers.set(projectId, server)
  const preOccupied = new Set()
  for (const port of COMMON_PORTS) if (await isPortOpen(port)) preOccupied.add(port)
  const child = spawn(invocation.file, invocation.args, {
    cwd, env: childEnvironment(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.child = child
  server.pid = child.pid
  child.stdout?.on('data', (chunk) => pushServerLog(server, chunk))
  child.stderr?.on('data', (chunk) => pushServerLog(server, chunk))
  child.on('error', (error) => {
    server.status = 'failed'
    pushServerLog(server, `ERROR ${String(error?.message || error)}`)
  })
  child.on('close', (code) => {
    if (server.status !== 'stopped') server.status = code === 0 ? 'stopped' : 'failed'
    server.exitCode = code
  })

  const ready = await waitForPort(server, LIMITS.serverBootTimeoutMs, { ignorePorts: preOccupied })
  if (!ready || !server.port) {
    // Never leave a spawned process (and its bound port) behind on failure.
    const logs = server.logs.slice(-60)
    await stopServer(projectId)
    return { started: false, status: 'failed', port: null, url: null, logs, error: 'لم يبدأ الخادم على أي منفذ خلال المهلة' }
  }
  server.status = 'running'
  server.url = `http://127.0.0.1:${server.port}`
  return {
    started: true, status: 'running', port: server.port, url: server.url,
    httpStatus: server.httpStatus, pid: server.pid, logs: server.logs.slice(-60),
  }
}

export async function stopServer(projectId) {
  const server = servers.get(projectId)
  if (!server) return { stopped: false }
  server.status = 'stopped'
  const pid = server.pid
  try {
    if (pid) {
      if (process.platform === 'win32') {
        await new Promise((resolvePromise) => {
          const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
          killer.on('close', resolvePromise)
          killer.on('error', resolvePromise)
        })
      } else {
        server.child?.kill('SIGKILL')
      }
    }
  } catch {}
  servers.delete(projectId)
  return { stopped: true, pid }
}

export async function stopAllServers() {
  for (const projectId of [...servers.keys()]) await stopServer(projectId)
  for (const projectId of [...runningChildren.keys()]) terminateCommand(projectId)
}

// ------------------------------- zip export --------------------------------

export async function exportZip(projectId, { destination } = {}) {
  const root = projectRoot(projectId)
  if (!existsSync(root)) throw new SandboxError('NOT_FOUND', 'لا يوجد مجلد مشروع للتصدير')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const staging = join(os.tmpdir(), `nados-export-${projectId}-${stamp}`)
  const zipPath = destination || join(os.tmpdir(), `NADOS_${projectId}_${stamp}.zip`)
  const IGNORED = new Set(['node_modules', '.git', 'test-results', '.wrangler', 'dist', 'build', '.next', 'coverage', '.turbo', '.cache', '.nados-project.json'])
  const usageSnapshot = await usage(projectId, { refresh: true })
  if (usageSnapshot.bytes > LIMITS.maxProjectBytes) {
    throw new SandboxError('PROJECT_TOO_LARGE', `حجم المشروع يتجاوز حد التصدير (${Math.round(LIMITS.maxProjectBytes / 1_000_000)}MB)`)
  }
  try {
    await mkdir(staging, { recursive: true })
    async function copyDir(source, target) {
      const entries = await readdir(source, { withFileTypes: true })
      for (const entry of entries) {
        if (IGNORED.has(entry.name)) continue
        const from = join(source, entry.name)
        const to = join(target, entry.name)
        if (entry.isDirectory()) { await mkdir(to, { recursive: true }); await copyDir(from, to) }
        else await copyFile(from, to)
      }
    }
    await copyDir(root, staging)
    const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`
    const ps = [
      `$ErrorActionPreference='Stop'`,
      `Compress-Archive -Path (Join-Path ${psQuote(staging)} '*') -DestinationPath ${psQuote(zipPath)} -Force`,
      `$zip=[System.IO.Compression.ZipFile]::OpenRead(${psQuote(zipPath)})`,
      `Write-Output ("ENTRIES=" + $zip.Entries.Count)`,
      `$zip.Dispose()`,
    ].join('; ')
    const result = await new Promise((resolvePromise) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true })
      let out = ''
      let err = ''
      const cap = (current, chunk) => (current.length > 200_000 ? current : current + String(chunk))
      child.stdout.on('data', (chunk) => { out = cap(out, chunk) })
      child.stderr.on('data', (chunk) => { err = cap(err, chunk) })
      child.on('close', (code) => resolvePromise({ code, out, err }))
      child.on('error', (error) => resolvePromise({ code: -1, out: '', err: String(error?.message || error) }))
    })
    if (result.code !== 0) throw new SandboxError('ZIP_FAILED', `فشل إنشاء الأرشيف: ${redactSecrets(result.err).slice(0, 200)}`)
    const info = await stat(zipPath)
    const entries = Number((/ENTRIES=(\d+)/.exec(result.out) || [])[1] || 0)
    if (!info.isFile() || info.size <= 0 || entries <= 0) throw new SandboxError('ZIP_FAILED', 'الأرشيف الناتج فارغ أو تالف')
    return { path: zipPath, bytes: info.size, entries, filename: `NADOS_${projectId}.zip` }
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
  }
}

export async function verifyHttp(url, timeoutMs = 4000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    // Only 2xx/3xx count as "the service responded". 4xx means the server is up
    // but is not serving this app, which must not pass verification.
    const ok = response.status >= 200 && response.status < 400
    return { ok, status: response.status }
  } catch (error) {
    return { ok: false, status: null, error: String(error?.message || error).slice(0, 160) }
  }
}

export const sandboxInfo = {
  provider: 'local-process-sandbox',
  root: WORKSPACES_ROOT,
  platform: process.platform,
}

// Real availability probe: writes, reads, and deletes a file in the workspace
// root. Cached briefly so the UI can honestly show whether execution works.
let executionProbe = { at: 0, ok: false, error: null }

export async function probeExecution() {
  if (Date.now() - executionProbe.at < 10_000) return executionProbe
  try {
    await mkdir(WORKSPACES_ROOT, { recursive: true })
    const file = join(WORKSPACES_ROOT, '.nados-probe')
    await writeFile(file, String(Date.now()), 'utf8')
    const value = await readFile(file, 'utf8')
    await rm(file, { force: true })
    executionProbe = { at: Date.now(), ok: Boolean(value), error: null }
  } catch (error) {
    executionProbe = { at: Date.now(), ok: false, error: String(error?.message || error).slice(0, 200) }
  }
  return executionProbe
}
