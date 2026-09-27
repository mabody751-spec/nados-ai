import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { callProvider, providerStatuses } from './providers.mjs'
import { nvidiaWorkTargets } from './nvidiaModels.mjs'
import { terminateCommand, getServer, executeCommandTool, projectRoot, verifyHttp } from './sandbox/index.mjs'
import { detectTemplateFromRequest, templateById } from './workTemplates.mjs'
import {
  getProject,
  listFileChanges,
  projectCreateDirectory,
  projectDeleteFile,
  projectEditFile,
  projectList,
  projectMoveFile,
  projectReadFile,
  projectSearch,
  projectTree,
  projectWriteFile,
  touchProject,
} from './workProjects.mjs'

export const WORK_MAX_STEPS = Number(process.env.NADOS_WORK_MAX_STEPS) || 50

// Tools that mutate the project or run real commands. Shared so stall/loop
// detection cannot drift between the places that consult it.
const MUTATING_TOOLS = new Set(['write_file', 'edit_file', 'delete_file', 'move_file', 'create_directory', 'execute_command', 'run_build', 'run_test'])
export const WORK_MAX_AUTO_FIX = Number(process.env.NADOS_WORK_MAX_RETRIES) || 3
export const WORK_MAX_DURATION_MS = Number(process.env.NADOS_WORK_MAX_TIME_MS) || 900_000
// Consecutive identical read-only calls before a task is parked as "no progress".
export const MAX_CONSECUTIVE_REPEATS = Number(process.env.NADOS_WORK_MAX_REPEATS) || 4
// Read-only steps in a row with no mutation, before a task is parked. Catches
// models that alternate between different reads forever.
export const MAX_READONLY_STREAK = Number(process.env.NADOS_WORK_MAX_READONLY_STREAK) || 12

const CODING_PROVIDER_ORDER = ['groq', 'nvidia', 'xkiro-minimax-m3-free', 'nvidia-nemotron-35-lightning', 'xkiro-deepseek-v41-flash-free', 'gemini', 'openrouter', 'cloudflare', 'openai']

export function availableWorkProviders() {
  const configured = new Set(providerStatuses().filter((item) => item.configured).map((item) => item.id))
  // A single configured order (NADOS_PROVIDER_ORDER) wins over the built-in list
  // so failover does not have to be edited in several modules.
  const envOrder = String(process.env.NADOS_PROVIDER_ORDER || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const preferred = envOrder.length ? envOrder : CODING_PROVIDER_ORDER
  const ordered = preferred.filter((id) => configured.has(id))
  for (const id of configured) if (!ordered.includes(id)) ordered.push(id)
  return ordered
}

// Work executes against explicit provider+model targets, not bare providers, so
// the primary model is deterministic: GLM 5.3 Flash leads, then other verified
// NVIDIA models, then the remaining configured providers as failover.
export function availableWorkTargets() {
  const configured = new Set(providerStatuses().filter((item) => item.configured).map((item) => item.id))
  const workProvider = String(process.env.NADOS_WORK_PROVIDER || 'nvidia').trim().toLowerCase()
  const targets = []

  if (workProvider === 'nvidia' && configured.has('nvidia')) {
    for (const target of nvidiaWorkTargets({ limit: 6 })) {
      targets.push({ providerId: target.providerId || 'nvidia', model: target.model, primary: targets.length === 0 })
    }
  }
  // Fast, reliably available fallback for the same chat-grade model.
  if (configured.has('groq')) {
    targets.push({ providerId: 'groq', model: String(process.env.NADOS_WORK_FALLBACK_MODEL || 'openai/gpt-oss-20b'), fallback: true })
  }
  for (const providerId of availableWorkProviders()) {
    if (providerId === workProvider) continue
    if (targets.some((target) => target.providerId === providerId && !target.model)) continue
    targets.push({ providerId, model: null })
  }
  return targets
}

export function workModelLabel() {
  const primary = availableWorkTargets()[0]
  return primary ? { providerId: primary.providerId, model: primary.model, label: `${primary.providerId} · ${primary.model}` } : null
}

// ------------------------------ run state -----------------------------------

const RUNS = new Map()

function defaultRun(projectId) {
  return {
    projectId, taskId: null, status: 'idle', startedAt: null, finishedAt: null,
    cancelRequested: false, pauseRequested: false, steps: [], filesChanged: [], task: '', summary: '', verification: null, error: null,
  }
}

export function workRunState(projectId) {
  return RUNS.get(String(projectId)) || defaultRun(String(projectId))
}

export function workStop(projectId) {
  const run = RUNS.get(String(projectId))
  if (!run) return { stopped: false }
  run.cancelRequested = true
  run.pauseRequested = false
  terminateCommand(String(projectId))
  return { stopped: true, status: run.status }
}

export function workPause(projectId) {
  const run = RUNS.get(String(projectId))
  if (!run || run.status !== 'running') return { paused: false, status: run?.status || 'idle' }
  run.pauseRequested = true
  return { paused: true, status: 'pausing' }
}

export function workResume(projectId) {
  const run = RUNS.get(String(projectId))
  if (!run) return { resumed: false, status: 'idle' }
  run.cancelRequested = false
  run.pauseRequested = false
  if (run.status === 'paused') run.status = 'running'
  return { resumed: true, status: run.status }
}

// ------------------------------ tool registry --------------------------------

function envelope(tool, path, result) {
  return { tool, status: 'success', path: path ?? null, ...result }
}

function failure(tool, path, error) {
  const message = String(error?.message || error)
  return { tool, status: 'error', path: path ?? null, error: message, code: error?.code || null }
}

function guard(tool, fn) {
  return async (params = {}) => {
    try { return await fn(params) } catch (error) { return failure(tool, params?.path || params?.from || null, error) }
  }
}

export function workToolRegistry(projectId) {
  const project = getProject(projectId)
  const template = project ? templateById(project.stack) : null
  return {
    read_file: {
      description: 'يقرأ محتوى ملف من مساحة عمل المشروع',
      params: { path: 'string' },
      async execute({ path }) {
        try {
          const result = await projectReadFile(projectId, path)
          return envelope('read_file', result.path, { content: result.content, bytes: result.bytes })
        } catch (error) { return failure('read_file', path, error) }
      },
    },
    write_file: {
      description: 'يكتب أو ينشئ ملفاً كاملاً داخل مساحة العمل',
      params: { path: 'string', content: 'string' },
      async execute({ path, content }) {
        try {
          const result = await projectWriteFile(projectId, path, content, { source: 'agent' })
          return envelope('write_file', result.path, { bytes: result.bytes, created: result.created, replaced: result.replaced })
        } catch (error) { return failure('write_file', path, error) }
      },
    },
    edit_file: {
      description: 'يستبدل نصاً محدداً داخل ملف موجود (تعديل دقيق)',
      params: { path: 'string', find: 'string', replace: 'string', replaceAll: 'boolean?' },
      async execute({ path, find, replace, replaceAll }) {
        try {
          const result = await projectEditFile(projectId, path, { find, replace, replaceAll }, { source: 'agent' })
          return envelope('edit_file', result.path, { bytes: result.bytes, replacements: result.replacements })
        } catch (error) { return failure('edit_file', path, error) }
      },
    },
    delete_file: {
      description: 'يحذف ملفاً أو مجلداً من مساحة العمل',
      params: { path: 'string' },
      async execute({ path }) {
        try {
          const result = await projectDeleteFile(projectId, path, { source: 'agent' })
          return envelope('delete_file', result.path, { deleted: true })
        } catch (error) { return failure('delete_file', path, error) }
      },
    },
    list_files: {
      description: 'يسرد ملفات مجلد داخل مساحة العمل',
      params: { dir: 'string?' },
      async execute({ dir }) {
        try {
          const result = await projectList(projectId, dir || '.')
          return envelope('list_files', result.dir, { files: result.files, total: result.total })
        } catch (error) { return failure('list_files', dir || '.', error) }
      },
    },
    list_tree: {
      description: 'يعرض شجرة المشروع كاملة (بدون node_modules و.git)',
      params: {},
      async execute() {
        try {
          const result = await projectTree(projectId, '.')
          return envelope('list_tree', '.', { tree: result.tree })
        } catch (error) { return failure('list_tree', '.', error) }
      },
    },
    search_files: {
      description: 'يبحث عن نص داخل ملفات المشروع',
      params: { query: 'string', dir: 'string?' },
      async execute({ query, dir }) {
        try {
          const result = await projectSearch(projectId, query, dir || '.')
          return envelope('search_files', dir || '.', { query, results: result.results, total: result.total })
        } catch (error) { return failure('search_files', dir || '.', error) }
      },
    },
    create_directory: {
      description: 'ينشئ مجلداً داخل مساحة العمل',
      params: { path: 'string' },
      async execute({ path }) {
        try {
          const result = await projectCreateDirectory(projectId, path)
          return envelope('create_directory', result.path, { created: true })
        } catch (error) { return failure('create_directory', path, error) }
      },
    },
    move_file: {
      description: 'ينقل أو يعيد تسمية ملف/مجلد',
      params: { from: 'string', to: 'string' },
      async execute({ from, to }) {
        try {
          const result = await projectMoveFile(projectId, from, to, { source: 'agent' })
          return envelope('move_file', result.to, { from: result.from, moved: true })
        } catch (error) { return failure('move_file', from, error) }
      },
    },
    execute_command: {
      description: 'ينفذ أمراً حقيقياً داخل مساحة العمل (npm install/test/run، node، git قراءة فقط) ويعيد stdout وstderr ورمز الخروج',
      params: { cmd: 'string' },
      execute: guard('execute_command', async ({ cmd }) => {
        const result = await executeCommandTool(projectId, cmd)
        return {
          tool: 'execute_command', status: result.status, path: null,
          command: result.command, exitCode: result.exitCode,
          stdout: result.stdout, stderr: result.stderr,
          durationMs: result.durationMs, error: result.error || (result.status === 'success' ? null : result.stderr?.slice(-400) || 'فشل الأمر'),
        }
      }),
    },
    run_build: {
      description: 'يشغّل أمر البناء إن وُجد تعريف build في package.json',
      params: {},
      execute: guard('run_build', async () => {
        const templateForProject = template || templateById('static')
        const script = await buildScript(projectId) || templateForProject.buildCommand
        if (!script) return { tool: 'run_build', status: 'error', path: null, error: 'لا يوجد أمر بناء معرّف في هذا المشروع' }
        const result = await executeCommandTool(projectId, script)
        return {
          tool: 'run_build', status: result.status, path: null, command: script,
          exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr,
          durationMs: result.durationMs, error: result.status === 'success' ? null : result.stderr?.slice(-400) || 'فشل البناء',
        }
      }),
    },
    run_test: {
      description: 'يشغّل اختبارات المشروع إن كانت معرّفة',
      params: {},
      execute: guard('run_test', async () => {
        const pkg = await readPackageJson(projectId)
        const script = pkg?.scripts?.test
        if (!script) return { tool: 'run_test', status: 'error', path: null, error: 'لا توجد اختبارات معرّفة في هذا المشروع' }
        const result = await executeCommandTool(projectId, 'npm test')
        const output = `${result.stdout}\n${result.stderr}`
        const failed = result.status !== 'success' || /# fail [1-9]|fail \d+\)|AssertionError/i.test(output)
        return {
          tool: 'run_test', status: failed ? 'failed' : 'success', path: null, command: 'npm test',
          exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr,
          durationMs: result.durationMs, error: failed ? output.replace(/\s+/g, ' ').slice(-400) : null,
        }
      }),
    },
  }
}

export async function readPackageJson(projectId) {
  try {
    const result = await projectReadFile(projectId, 'package.json')
    return JSON.parse(result.content)
  } catch {
    return null
  }
}

async function buildScript(projectId) {
  const pkg = await readPackageJson(projectId)
  if (!pkg?.scripts) return null
  if (pkg.scripts.build) return 'npm run build'
  if (pkg.scripts.lint) return 'npm run lint'
  return null
}

export async function detectStartCommand(projectId) {
  const project = getProject(projectId)
  const pkg = await readPackageJson(projectId)
  if (pkg?.scripts) {
    if (pkg.scripts.dev) return 'npm run dev'
    if (pkg.scripts.start) return 'npm start'
    if (pkg.scripts.preview) return 'npm run preview'
  }
  if (project) {
    const template = templateById(project.stack)
    if (template.startCommand) return template.startCommand
  }
  return null
}

// ------------------------------- agent prompt --------------------------------

const WORK_SYSTEM_PROMPT = (projectId, toolNames) => `أنت وكيل التنفيذ الحقيقي في وضع «العمل» داخل Nados AI.

مشروعك الحالي: ${projectId}
مساحة العمل معزولة: كل المسارات نسبية لجذر المشروع (مثال: src/App.jsx). لا تستخدم مسارات مطلقة.

الأدوات المتاحة (JSON فقط):
${toolNames.map((name) => `- ${name}`).join('\n')}

صيغة الاستدعاء الوحيدة:
{"tool": "اسم_الأداة", "params": { ... }}

قواعد إلزامية:
1. لا تدّعي إنجاز أي شيء. انتظر نتيجة الأداة الفعلية واستند إليها.
2. لا تقل «تم إنشاء الملف» إلا بعد نجاح write_file فعلياً.
3. لا تقل «البناء نجح» إلا بعد run_build أو execute_command برمز خروج 0.
4. عند كتابة ملف اكتب الكود كاملاً وصالحاً للتنفيذ.
5. اقرأ الملفات الموجودة قبل تعديلها (read_file) واستخدم edit_file للتعديل الدقيق.
6. عند حدوث خطأ: اقرأ stderr، أصلح السبب، ثم أعد الأمر.
7. أي أداة تُرجع status=error تعني فشلاً — لا تتجاهلها.
8. عند اكتمال المهمة أجب نصاً نهائياً بلا JSON، واذكر الحقيقة فقط.
9. الحد الأقصى ${WORK_MAX_STEPS} خطوة.
10. لا تكرر نفس استدعاء الأداة أكثر من مرتين. بعد كتابة ملف يكفي قراءته مرة واحدة للتأكد.
11. إن اكتملت المهمة فعلاً فأجب نصاً نهائياً فوراً — لا تواصل استدعاء الأدوات.
12. لا تُجب بأي شرح قبل تنفيذ أداة واحدة على الأقل. إذا احتاج الطلب إنشاء أو تعديل أو تشغيل شيء فيجب أن يكون أول رد لك استدعاء أداة بصيغة JSON.

مشروع موجود مسبقاً؟ لا تُعد إنشاءه — افحصه أولاً عبر list_tree.

مهمتك: نفّذها فعلياً بالأدوات، لا تشرح فقط.`

export function parseWorkResponse(text, knownTools = null) {
  const raw = String(text || '').trim()
  const match = /\{[\s\S]*\}/.exec(raw)
  if (match) {
    try {
      const parsed = JSON.parse(match[0])
      if (parsed?.tool && typeof parsed.tool === 'string' && (!knownTools || knownTools.has(parsed.tool))) {
        return { toolCall: { tool: parsed.tool, params: parsed.params || {} }, content: raw.replace(match[0], '').trim() }
      }
    } catch {}
  }
  return { content: raw }
}

// -------------------------------- agent loop ---------------------------------

export async function runWorkTask({ projectId, task, onEvent = () => {}, userId = 'local-user' }) {
  const project = getProject(projectId)
  if (!project) throw new Error('المشروع غير موجود — أنشئ مشروعاً أولاً.')
  const toolNames = Object.keys(workToolRegistry(projectId))
  const tools = workToolRegistry(projectId)
  const started = Date.now()
  const run = { ...defaultRun(projectId), taskId: `work-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, status: 'running', startedAt: new Date().toISOString(), task }
  RUNS.set(projectId, run)
  touchProject(projectId, { status: 'running' })

  const observations = []
  const filesChanged = new Set()
  let finalText = ''
  let lastSignature = null
  let consecutiveRepeats = 0
  let readOnlyStreak = 0
  let textOnlyNudges = 0

  onEvent({ type: 'agent_start', projectId, taskId: run.taskId, task, stack: project.stack, tools: toolNames })

  const targets = availableWorkTargets()
  if (targets.length === 0) {
    run.status = 'failed'
    run.error = 'لا يوجد مزوّد ذكاء اصطناعي متصل لتشغيل وكيل العمل.'
    RUNS.set(projectId, run)
    onEvent({ type: 'error', message: run.error })
    throw new Error(run.error)
  }
  const primaryTarget = targets[0]
  run.model = primaryTarget
  onEvent({ type: 'agent_model', providerId: primaryTarget.providerId, model: primaryTarget.model, primary: true, targets: targets.length })

  // File names mentioned in the task are the concrete artifacts the model must
  // create; they make the "use a tool" nudge actionable.
  const requestedFiles = [...new Set(String(task).slice(0, 20000).split(/\s+/).map((token) => token.replace(/^[^\p{L}\p{N}_.-]+|[^\p{L}\p{N}_.-]+$/gu, '')).filter((token) => /\.(html|css|js|jsx|ts|tsx|json|md|py|txt|yml|yaml|sql)$/i.test(token)))]
  const hasRealWork = () => filesChanged.size > 0 || run.steps.some((step) => MUTATING_TOOLS.has(step.tool) && step.status !== 'running')

  while (run.steps.length < WORK_MAX_STEPS) {
    // Pause and stop both halt new steps; they differ only in the reported state.
    if (run.cancelRequested || run.pauseRequested) {
      run.status = run.pauseRequested ? 'paused' : 'cancelled'
      break
    }
    if (Date.now() - started > WORK_MAX_DURATION_MS) {
      run.status = 'paused'
      run.error = 'تجاوزت المهمة الحد الزمني المسموح.'
      break
    }

    const stepIndex = run.steps.length + 1
    const prompt = [
      `المهمة: ${task}`,
      observations.length ? `سجل التنفيذ حتى الآن:\n${observations.slice(-8).join('\n')}` : '',
      `الخطوة ${stepIndex} من ${WORK_MAX_STEPS}.`,
    ].filter(Boolean).join('\n\n')

    let response = null
    let lastError = null
    for (const target of targets) {
      try {
        response = await callProvider(target.providerId, {
          message: prompt,
          history: [],
          instructions: WORK_SYSTEM_PROMPT(projectId, toolNames),
          mode: 'code',
          ...(target.model ? { modelOverride: target.model } : {}),
        })
        lastError = null
        if (target !== primaryTarget) onEvent({ type: 'agent_model_fallback', providerId: target.providerId, model: target.model })
        break
      } catch (error) {
        lastError = error
      }
    }
    if (!response) {
      run.status = 'failed'
      run.error = `فشل جميع المزوّدين: ${String(lastError?.message || '').slice(0, 200)}`
      onEvent({ type: 'error', message: run.error })
      break
    }

    const { toolCall, content } = parseWorkResponse(response?.text || '', new Set(toolNames))
    if (!toolCall) {
      const actionable = /أنشئ|انشئ|اعمل|أضف|اضف|عدّل|عدل|أصلح|اصلح|اكتب|صمّم|صمم|ابن|شغّل|شغل|حدّث|حدث|احذف|أزل|انقل|ارفع|create|build|add|fix|update|write|make|refactor|implement/i.test(String(task))
      const mustUseTools = actionable && !hasRealWork()
      if (mustUseTools && textOnlyNudges < 3) {
        textOnlyNudges += 1
        const wanted = requestedFiles.length ? `أنشئ الملفات المطلوبة: ${requestedFiles.slice(0, 4).join(', ')}.` : 'نفّذ الإجراء المطلوب.'
        observations.push(`لم تنفّذ أي إجراء حقيقي بعد. ${wanted} استدعِ أداة الآن، مثال: {"tool":"write_file","params":{"path":"${requestedFiles[0] || 'index.html'}","content":"<المحتوى الكامل>"}}`)
        onEvent({ type: 'agent_nudge', reason: 'no_real_work', attempt: textOnlyNudges, requestedFiles })
        continue
      }
      if (mustUseTools) {
        // The model refused to act after repeated nudges: park honestly instead
        // of claiming completion. Verification still runs and reports reality.
        run.status = 'stalled'
        run.error = 'أنهى النموذج المهمة نصاً دون تنفيذ أي إجراء حقيقي على المشروع.'
        onEvent({ type: 'agent_stalled', message: run.error, reason: 'no_tool_call' })
        break
      }
      finalText = content || response?.text || ''
      run.status = 'completed'
      break
    }

    const signature = `${toolCall.tool}:${JSON.stringify(toolCall.params || {})}`
    // Only *consecutive* identical calls count as being stuck. A no-argument tool
    // such as list_tree is expected to be called repeatedly across a task, so a
    // lifetime counter would abort healthy runs.
    if (signature === lastSignature) consecutiveRepeats += 1
    else { lastSignature = signature; consecutiveRepeats = 1 }

    const readOnlyTools = new Set(['read_file', 'list_files', 'list_tree', 'search_files'])
    const isReadOnly = readOnlyTools.has(toolCall.tool)
    readOnlyStreak = isReadOnly ? readOnlyStreak + 1 : 0

    // A repeated read-only call with no work in between is a stall.
    if (isReadOnly && consecutiveRepeats > MAX_CONSECUTIVE_REPEATS) {
      const stalledMessage = `توقف الوكيل عن إحراز تقدم: كرر ${toolCall.tool} ${consecutiveRepeats} مرات متتالية دون تعديل.`
      onEvent({ type: 'agent_stalled', tool: toolCall.tool, repeats: consecutiveRepeats, message: stalledMessage })
      observations.push(`- توقف: ${toolCall.tool} مكرر ${consecutiveRepeats}× متتالية بلا تقدم`)
      run.status = 'stalled'
      run.error = `${stalledMessage} جرّب إعادة صياغة المهمة أو واصل من نقطة محددة.`
      break
    }
    // Alternating reads forever is also a stall when nothing has been produced.
    if (filesChanged.size === 0 && readOnlyStreak > MAX_READONLY_STREAK) {
      const stalledMessage = `توقف الوكيل عن إحراز تقدم: ${readOnlyStreak} خطوات قراءة/فحص متتالية دون إنشاء أي ملف.`
      onEvent({ type: 'agent_stalled', tool: toolCall.tool, repeats: readOnlyStreak, message: stalledMessage })
      observations.push(`- توقف: ${readOnlyStreak} قراءات متتالية بلا أي كتابة`)
      run.status = 'stalled'
      run.error = `${stalledMessage} عدّل صياغة المهمة لتصف الملفات المطلوبة بوضوح.`
      break
    }
    if (isReadOnly && consecutiveRepeats >= 2) {
      observations.push(`تحذير: كررت ${toolCall.tool} ${consecutiveRepeats} مرات متتالية بلا تعديل. ${filesChanged.size === 0 ? 'لم تُنشئ أي ملف بعد — أنشئ الملف المطلوب الآن عبر write_file.' : 'المهمة تبدو مكتملة — أجب نصاً نهائياً الآن.'}`)
    }
    // Strong nudge when the task clearly needs artifacts but nothing was written.
    if (filesChanged.size === 0 && stepIndex >= 4 && isReadOnly) {
      observations.push('تنبيه: لم تكتب أي ملف حتى الآن. نفّذ الطلب فعلياً عبر write_file قبل أي قراءة أخرى.')
    }

    const step = {
      id: `step_${stepIndex}`,
      parentTaskId: run.taskId,
      agentId: 'main',
      type: 'tool',
      status: 'running',
      description: describeToolCall(toolCall),
      tool: toolCall.tool,
      arguments: sanitizeArgs(toolCall.params),
      result: null,
      error: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      durationMs: null,
    }
    run.steps.push(step)
    onEvent({ type: 'tool_started', step: step.id, tool: step.tool, description: step.description, parameters: step.arguments })

    const tool = tools[toolCall.tool]
    let result
    if (!tool) {
      result = failure(toolCall.tool, null, new Error(`أداة غير معروفة: ${toolCall.tool}`))
    } else {
      try {
        result = await tool.execute(toolCall.params || {})
      } catch (error) {
        result = failure(toolCall.tool, toolCall.params?.path || null, error)
      }
    }

    step.result = compactResult(result)
    step.error = result.status === 'error' ? result.error : null
    step.completedAt = new Date().toISOString()
    step.durationMs = Date.now() - new Date(step.startedAt).getTime()
    step.status = result.status

    const madeProgress = ['success', 'failed'].includes(result.status) && MUTATING_TOOLS.has(toolCall.tool)
    if (madeProgress) consecutiveRepeats = 0

    if (['write_file', 'edit_file', 'move_file'].includes(toolCall.tool) && result.status === 'success' && result.path) {
      filesChanged.add(result.path)
    }
    if (toolCall.tool === 'delete_file' && result.status === 'success' && result.path) filesChanged.add(result.path)

    onEvent({
      type: result.status === 'success' ? 'tool_completed' : 'tool_failed',
      step: step.id, tool: step.tool, status: step.status, path: step.result?.path || null,
      durationMs: step.durationMs, result: step.result, error: step.error,
    })

    observations.push(`- ${step.tool}(${JSON.stringify(step.arguments).slice(0, 200)}) → ${step.status}${step.error ? `: ${String(step.error).slice(0, 200)}` : ''}`)
    if (filesChanged.size) observations.push(`الملفات المتأثرة حتى الآن: ${[...filesChanged].slice(-8).join(', ')}`)
    if (observations.length > 40) observations.splice(0, observations.length - 40)
  }

  if (run.status === 'running') {
    run.status = finalText ? 'completed' : (run.steps.length >= WORK_MAX_STEPS ? 'stalled' : 'completed')
    if (!finalText && run.steps.length >= WORK_MAX_STEPS) run.error = `تجاوزت المهمة الحد الأقصى (${WORK_MAX_STEPS} خطوة) دون إكمال صريح.`
  }

  run.filesChanged = [...filesChanged]
  run.summary = finalText || run.error || 'اكتمل التنفيذ.'
  run.finishedAt = new Date().toISOString()
  run.durationMs = Date.now() - started
  RUNS.set(projectId, run)
  touchProject(projectId, { status: run.status === 'completed' ? 'ready' : run.status })

  onEvent({
    type: 'agent_done', status: run.status, summary: run.summary, steps: run.steps,
    filesChanged: run.filesChanged, durationMs: run.durationMs, error: run.error,
  })

  return {
    taskId: run.taskId, status: run.status, summary: run.summary, error: run.error,
    steps: run.steps, filesChanged: run.filesChanged, durationMs: run.durationMs,
  }
}

function describeToolCall(toolCall) {
  const path = toolCall.params?.path || toolCall.params?.from || toolCall.params?.dir || ''
  const labels = {
    read_file: 'قراءة ملف', write_file: 'كتابة ملف', edit_file: 'تعديل ملف', delete_file: 'حذف',
    list_files: 'سرد ملفات', list_tree: 'عرض شجرة المشروع', search_files: 'بحث', create_directory: 'إنشاء مجلد',
    move_file: 'نقل/إعادة تسمية', execute_command: 'تنفيذ أمر', run_build: 'بناء المشروع', run_test: 'تشغيل الاختبارات',
  }
  const base = labels[toolCall.tool] || toolCall.tool
  if (toolCall.tool === 'execute_command') return `${base}: ${String(toolCall.params?.cmd || '').slice(0, 120)}`
  return path ? `${base}: ${path}` : base
}

function sanitizeArgs(params = {}) {
  const clone = { ...params }
  if (typeof clone.content === 'string') clone.content = `[${Buffer.byteLength(clone.content, 'utf8')} bytes]`
  return clone
}

function compactResult(result) {
  if (!result) return null
  const clone = { ...result }
  for (const key of ['stdout', 'stderr', 'content']) {
    if (typeof clone[key] === 'string' && clone[key].length > 1200) clone[key] = `${clone[key].slice(0, 1200)}…`
  }
  // Keep a readable path list instead of a bare count: a count hides what the
  // agent already created and makes it re-list the tree in a loop.
  if (Array.isArray(clone.tree)) {
    const paths = flattenTreePaths(clone.tree)
    clone.tree = paths.length <= 60 ? paths : [...paths.slice(0, 60), `… و${paths.length - 60} عنصراً آخر`]
  }
  if (Array.isArray(clone.files)) {
    clone.files = clone.files.slice(0, 60).map((file) => (typeof file === 'string' ? file : file?.path || file?.name))
  }
  return clone
}

function flattenTreePaths(nodes, prefix = '') {
  const paths = []
  for (const node of nodes || []) {
    if (!node) continue
    const path = node.path || (prefix ? `${prefix}/${node.name}` : node.name)
    if (node.type === 'dir') {
      paths.push(`${path}/`)
      paths.push(...flattenTreePaths(node.children, path))
    } else {
      paths.push(path)
    }
  }
  return paths
}

// --------------------------- verification engine ------------------------------

export async function verifyProjectWorkspace(projectId, onEvent = () => {}) {
  const project = getProject(projectId)
  const template = project ? templateById(project.stack) : detectTemplateFromRequest('')
  const results = []
  onEvent({ type: 'verification_started', projectId })

  const entry = template.verifyEntry
  const entryExists = await projectReadFile(projectId, entry).then(() => true).catch(() => false)
  results.push({ label: `وجود ${entry}`, passed: entryExists, kind: 'file', output: entryExists ? `${entry} موجود` : `${entry} غير موجود` })
  onEvent({ type: entryExists ? 'verify_passed' : 'verify_failed', label: `وجود ${entry}` })

  const pkg = await readPackageJson(projectId)
  const nodeModules = existsSync(join(projectRoot(projectId), 'node_modules'))

  if (pkg?.scripts?.build || template.buildCommand) {
    const command = pkg?.scripts?.build ? 'npm run build' : template.buildCommand
    onEvent({ type: 'build_started', command })
    const result = await executeCommandTool(projectId, command)
    const passed = result.status === 'success'
    results.push({ label: 'بناء المشروع', passed, kind: 'build', command, output: (result.stdout + result.stderr).slice(-800) })
    onEvent({ type: passed ? 'build_completed' : 'verify_failed', command, status: result.status, output: (result.stdout + result.stderr).slice(-400) })
  }

  if (pkg?.scripts?.test) {
    if (!nodeModules) {
      results.push({ label: 'الاختبارات', passed: false, kind: 'test', command: 'npm test', output: 'الاعتمادات غير مثبتة (node_modules مفقود) — شغّل npm install أولاً.' })
      onEvent({ type: 'verify_failed', label: 'الاختبارات' })
    } else {
      onEvent({ type: 'test_started', command: 'npm test' })
      const result = await executeCommandTool(projectId, 'npm test')
      const output = `${result.stdout}\n${result.stderr}`
      const passed = result.status === 'success' && !/# fail [1-9]|fail \d+\)|AssertionError/i.test(output)
      results.push({ label: 'الاختبارات', passed, kind: 'test', command: 'npm test', output: output.slice(-800) })
      onEvent({ type: passed ? 'test_completed' : 'verify_failed', command: 'npm test', output: output.slice(-400) })
    }
  }

  const server = getServer(projectId)
  if (server?.port) {
    const check = await verifyHttp(`http://127.0.0.1:${server.port}/`)
    results.push({ label: 'المعاينة تعمل', passed: check.ok, kind: 'preview', output: check.ok ? `HTTP ${check.status} على المنفذ ${server.port}` : `تعذّر الوصول: ${check.error || check.status}` })
    onEvent({ type: check.ok ? 'verify_passed' : 'verify_failed', label: 'المعاينة' })
  }

  const allPassed = results.length > 0 && results.every((item) => item.passed)
  onEvent({ type: 'verification_completed', allPassed, results: results.map((item) => ({ label: item.label, passed: item.passed })) })
  return { results, allPassed }
}

export async function runWorkTaskWithRecovery({ projectId, task, onEvent = () => {}, userId = 'local-user' }) {
  const project = getProject(projectId)
  if (project && project.stack === 'static') {
    const hasIndex = await projectReadFile(projectId, 'index.html').then(() => true).catch(() => false)
    if (!hasIndex && /react|next|vite|dashboard|تطبيق|لوحة|api|express|python/i.test(String(task))) {
      const detected = detectTemplateFromRequest(task)
      if (detected.startCommand) touchProject(projectId, { stack: detected.id, stackLabel: detected.label })
    }
  }

  const stoppedResult = (run, autoFixAttempts = 0) => ({
    taskId: run.taskId, status: run.status,
    summary: run.summary || (run.status === 'paused' ? 'أُوقفت المهمة مؤقتاً — مساحة العمل محفوظة.' : 'أُوقفت المهمة بواسطة المستخدم.'),
    steps: run.steps, filesChanged: run.filesChanged,
    verification: { allPassed: false, results: [{ label: 'أُوقفت المهمة قبل التحقق', passed: false, kind: 'control', output: 'لم يُنفَّذ التحقق لأن المهمة أُوقفت.' }] },
    autoFixAttempts, durationMs: run.durationMs,
    changes: listFileChanges(projectId),
  })

  await runWorkTask({ projectId, task, onEvent, userId })
  const stoppedRun = workRunState(projectId)

  // A user stop/pause must not be followed by build/test or a "completed"
  // claim. Respect the control action and report it as-is.
  if (stoppedRun.status === 'cancelled' || stoppedRun.status === 'paused') {
    return stoppedResult(stoppedRun)
  }

  let verification = await verifyProjectWorkspace(projectId, onEvent)

  let attempt = 0
  while (!verification.allPassed && attempt < WORK_MAX_AUTO_FIX && !workRunState(projectId).cancelRequested) {
    if (workRunState(projectId).status === 'failed' && !workRunState(projectId).filesChanged?.length) break
    attempt += 1
    onEvent({ type: 'auto_fix_attempt', attempt, max: WORK_MAX_AUTO_FIX })
    const failures = verification.results.filter((item) => !item.passed).map((item) => `${item.label}: ${String(item.output).slice(-500)}`).join('\n')
    try {
      await runWorkTask({
        projectId,
        task: `فشل التحقق التالي:\n${failures}\n\nاقرأ الملفات المعنية، أصلح الخطأ فعلياً، ثم شغّل البناء/الاختبارات للتأكد.`,
        onEvent,
        userId,
      })
      if (workRunState(projectId).status === 'cancelled' || workRunState(projectId).status === 'paused') {
        return stoppedResult(workRunState(projectId), attempt)
      }
      verification = await verifyProjectWorkspace(projectId, onEvent)
    } catch (error) {
      onEvent({ type: 'error', message: `فشلت محاولة الإصلاح ${attempt}: ${String(error?.message || error).slice(0, 160)}` })
      break
    }
  }

  // A stop/pause that arrived during the last verification pass must also win.
  if (workRunState(projectId).status === 'cancelled' || workRunState(projectId).status === 'paused') {
    return stoppedResult(workRunState(projectId), attempt)
  }

  const finalRun = workRunState(projectId)
  // A failed/stalled/cancelled run is authoritative: verification passing on a
  // pre-existing template entry file must never upgrade it to "completed".
  const terminalFailure = ['failed', 'stalled', 'cancelled'].includes(String(finalRun.status))
  const finalStatus = terminalFailure ? String(finalRun.status) : (verification.allPassed ? 'completed' : 'completed_with_warnings')
  // Make the persisted run state reflect the final verified outcome so the UI
  // never shows "failed" after a successful verification (or vice versa).
  finalRun.status = finalStatus
  finalRun.verification = { allPassed: verification.allPassed, results: verification.results.map((item) => ({ label: item.label, passed: item.passed })) }
  if (!finalRun.summary) finalRun.summary = `اكتمل التنفيذ (${finalStatus}).`
  return {
    taskId: finalRun.taskId, status: finalStatus, summary: finalRun.summary,
    steps: finalRun.steps, filesChanged: finalRun.filesChanged,
    verification: { allPassed: verification.allPassed, results: verification.results },
    autoFixAttempts: attempt, durationMs: finalRun.durationMs,
    changes: listFileChanges(projectId),
  }
}
