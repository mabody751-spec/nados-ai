import { existsSync } from 'node:fs'
import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

const SANDBOX_ROOT = resolve(process.env.NADOS_SANDBOX_ROOT || 'D:/nadosai')

function safePath(path) {
  const raw = String(path || '')
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) {
    throw new Error(`SANDBOX_ESCAPE: مسار مطلق خارج الجلسة المعزولة: ${path}`)
  }
  if (/(\.\.[\\/])|(\.\.$)/.test(raw)) {
    throw new Error(`SANDBOX_ESCAPE: صعود خارج الجلسة المعزولة: ${path}`)
  }
  const resolved = resolve(SANDBOX_ROOT, raw)
  if (!resolved.startsWith(SANDBOX_ROOT + sep) && resolved !== SANDBOX_ROOT) {
    throw new Error(`SANDBOX_ESCAPE: المسار خارج نطاق الجلسة المعزولة: ${path}`)
  }
  return resolved
}

const BLOCKED_EXTENSIONS = /\.(exe|dll|bat|cmd|ps1|sh|msi|reg)$/i
const MAX_FILE_BYTES = 2_000_000

export const toolRegistry = {
  read_file: {
    description: 'يقرأ محتوى ملف داخل جلسة العمل المعزولة',
    params: { path: 'string' },
    async execute({ path }) {
      const target = safePath(path)
      if (!existsSync(target)) throw new Error(`الملف غير موجود: ${path}`)
      const info = await stat(target)
      if (info.size > MAX_FILE_BYTES) throw new Error(`الملف كبير جداً (${Math.round(info.size / 1024)}KB) — الحد 2MB`)
      const content = await readFile(target, 'utf8')
      return { content: content.slice(0, MAX_FILE_BYTES), size: info.size }
    },
  },
  write_file: {
    description: 'يكتب أو ينشئ ملفاً داخل جلسة العمل المعزولة',
    params: { path: 'string', content: 'string' },
    async execute({ path, content }) {
      const target = safePath(path)
      if (BLOCKED_EXTENSIONS.test(target)) throw new Error(`نوع الملف محجوب لأسباب أمنية: ${path}`)
      const body = String(content ?? '')
      if (Buffer.byteLength(body, 'utf8') > MAX_FILE_BYTES) throw new Error('المحتوى يتجاوز 2MB')
      await writeFile(target, body, 'utf8')
      return { written: true, path, bytes: Buffer.byteLength(body, 'utf8') }
    },
  },
  list_files: {
    description: 'يسرد ملفات ومجلدات مسار داخل الجلسة',
    params: { dir: 'string' },
    async execute({ dir }) {
      const target = safePath(dir || '.')
      if (!existsSync(target)) throw new Error(`المسار غير موجود: ${dir}`)
      const entries = await readdir(target, { withFileTypes: true })
      return {
        files: entries.slice(0, 200).map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'dir' : 'file',
        })),
        total: entries.length,
      }
    },
  },
  search_files: {
    description: 'يبحث عن نص داخل ملفات المسار (حتى عمق مجلدين)',
    params: { query: 'string', dir: 'string' },
    async execute({ query, dir }) {
      const needle = String(query || '').toLowerCase()
      if (!needle) throw new Error('كلمة البحث مطلوبة')
      const target = safePath(dir || '.')
      const results = []
      async function scan(current, depth) {
        if (depth > 2 || results.length >= 30) return
        let entries = []
        try { entries = await readdir(current, { withFileTypes: true }) } catch { return }
        for (const entry of entries) {
          if (results.length >= 30) break
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue
          const full = join(current, entry.name)
          if (entry.isDirectory()) { await scan(full, depth + 1); continue }
          if (BLOCKED_EXTENSIONS.test(entry.name) || entry.name.length > 100) continue
          try {
            const info = await stat(full)
            if (info.size > 500_000) continue
            const content = await readFile(full, 'utf8')
            const lower = content.toLowerCase()
            if (lower.includes(needle)) {
              const index = lower.indexOf(needle)
              const snippet = content.slice(Math.max(0, index - 60), index + 120).replace(/\s+/g, ' ').trim()
              results.push({ file: full.replace(SANDBOX_ROOT + sep, '').replace(/\\/g, '/'), snippet })
            }
          } catch {}
        }
      }
      await scan(target, 0)
      return { results, total: results.length }
    },
  },
  execute_command: {
    description: 'ينفذ أمر قراءة فقط (آمن) داخل الجلسة — أوامر الكتابة والشبكة محجوبة',
    params: { cmd: 'string' },
    async execute({ cmd }) {
      const command = String(cmd || '').trim()
      const allowed = /^(node\s+--check|node\s+-v|npm\s+test|npm\s+run\s+build|git\s+(status|log|diff|branch|show)[\s\S]*|dir|ls|type|cat|head|tail)\b/i
      const blocked = /(rm|del|rmdir|rd|format|shutdown|curl|wget|Invoke-WebRequest|fetch|npm\s+install|npm\s+i\b|git\s+(push|pull|clone|commit|reset|checkout)|remove-item|>|>>|\|)/i
      if (!allowed.test(command) || blocked.test(command)) {
        return { output: `الأمر غير مسموح في الجلسة المعزولة (أوامر القراءة فقط): ${command.slice(0, 80)}`, exitCode: 126, blocked: true }
      }
      const { execFile } = await import('node:child_process')
      const { promisify } = await import('node:util')
      const run = promisify(execFile)
      try {
        const isPowershell = /dir|type\b|head|tail/i.test(command)
        const shellCmd = isPowershell
          ? ['powershell.exe', ['-NoProfile', '-Command', command]]
          : ['node.exe', ['--version']]
        if (!isPowershell) throw new Error('الأمر غير مدعوم — استخدم أوامر PowerShell للقراءة فقط.')
        const { stdout, stderr } = await run(shellCmd[0], shellCmd[1], { cwd: SANDBOX_ROOT, timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true })
        return { output: (stdout || stderr).slice(0, 4000), exitCode: 0 }
      } catch (error) {
        return { output: String(error?.message || error).slice(0, 1000), exitCode: 1 }
      }
    },
  },
}

export function listTools() {
  return Object.entries(toolRegistry).map(([name, tool]) => ({ name, description: tool.description, params: tool.params }))
}
