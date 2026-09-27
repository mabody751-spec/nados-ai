// Single source of truth for sandbox path/type/command policy so the legacy
// read-only tool registry (server/tools.mjs) and the Work execution engine
// (server/sandbox/index.mjs) cannot drift apart.

export class PolicyError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.name = 'PolicyError'
    this.code = code
  }
}

// Union of both historical blocklists. Executable and shell-script types are
// rejected for writes in every mode.
export const BLOCKED_EXTENSIONS = /\.(exe|dll|msi|reg|com|scr|cpl|sys|bat|cmd|ps1|psm1|sh|bash|vbs|jar)$/i

// Programs that must never be launched directly.
export const BLOCKED_PROGRAMS = new Set([
  'powershell', 'pwsh', 'cmd', 'bash', 'sh', 'curl', 'wget', 'certutil', 'bitsadmin',
  'reg', 'schtasks', 'netsh', 'format', 'shutdown', 'taskkill', 'diskpart', 'attrib',
  'icacls', 'takeown', 'wscript', 'cscript',
])

// Programs allowed when a caller opts into real execution.
export const EXECUTE_PROGRAMS = new Set([
  'node', 'npm', 'npx', 'git', 'python', 'python3', 'pip', 'pip3',
  'yarn', 'pnpm', 'tsc', 'eslint', 'vitest', 'jest', 'pytest',
])

export const GIT_READ_ONLY = /^(status|log|diff|branch|show|remote|rev-parse|ls-files|add|stash)$/i
export const GIT_BLOCKED_SUBCOMMANDS = new Set(['push', 'pull', 'clone', 'commit', 'reset', 'checkout', 'clean'])
export const NPM_BLOCKED_SUBCOMMANDS = new Set(['publish', 'login', 'logout', 'owner', 'token', 'adduser'])
export const SHELL_METACHARACTERS = /[|&<>^]/
export const BLOCKED_INLINE_EVAL = /^(-e|--eval|-p|--print)$/

export function normalizeProgram(token) {
  const base = String(token || '').split(/[\\/]/).pop() || ''
  return base.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase()
}

export function isBlockedExtension(path) {
  return BLOCKED_EXTENSIONS.test(String(path || ''))
}

export function assertProgramAllowed(program, { mode = 'execute' } = {}) {
  if (BLOCKED_PROGRAMS.has(program)) throw new PolicyError('COMMAND_BLOCKED', `الأمر محجوب أمنياً: ${program}`)
  if (mode === 'execute' && !EXECUTE_PROGRAMS.has(program)) {
    throw new PolicyError('COMMAND_BLOCKED', `الأمر غير مسموح في الجلسة المعزولة: ${program}`)
  }
}
