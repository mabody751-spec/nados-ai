import { createHash } from 'node:crypto'
import { providerStatuses } from '../providers.mjs'
import { findRuntimeProvider } from '../providerStore.mjs'
import { modelTokenLimits, estimateTokens } from '../tokenBudget.mjs'

const CODE_PATTERNS = /اكتب\s+(كود|دالة|وظيفة|دوال|فئة|برنامج|سكريبت)|\b(function|class|component|api|script|code)\b|برمجة|package\.json|regex|import|export/i
const REASONING_PATTERNS = /حلّل|حلل|لماذا|لماذا|قارن|قارن|استنتج|علل|reason|analyze|compare|why|derive|prove|منطق/i
const CREATIVE_PATTERNS = /اكتبلي|اكتب\s+(مقال|قصة|قريد|شعر|بوست)|صفحة هبوط|محتوى|إعلان|تسويق|creative|story|marketing|landing page/i
const MATH_PATTERNS = /\d+\s*[+\-*/^]\s*\d+|معادلة|حساب|رياضيات|equation|math|calculate/i
const ARABIC_PATTERNS = /[\u0600-\u06FF]/
const IRAQI_PATTERNS = /(شلون|شنو|اكو|هواية|مكان|هسه|هيجي|چان|چة)/i

export function classifyTask(message, hasFile = false, fileMime = '') {
  const text = String(message || '')
  const types = ['general']
  if (CODE_PATTERNS.test(text)) types.push('coding')
  if (REASONING_PATTERNS.test(text)) types.push('reasoning')
  if (CREATIVE_PATTERNS.test(text)) types.push('creative')
  if (MATH_PATTERNS.test(text)) types.push('math')
  if (ARABIC_PATTERNS.test(text)) types.push('arabic')
  if (IRAQI_PATTERNS.test(text)) types.push('iraqi_arabic')
  if (/[\u0600-\u06FF]/.test(text) === false && text.trim()) types.push('english')
  if (hasFile && fileMime?.startsWith('image/')) types.push('vision')
  if (hasFile && !fileMime?.startsWith('image/')) types.push('documents')
  if (estimateTokens(text) > 20_000) types.push('long_context')
  return [...new Set(types)]
}

export function buildProviderRegistry() {
  const statuses = providerStatuses()
  return statuses.map((item) => {
    const id = item.id
    const isBuiltIn = ['gemini', 'groq', 'nvidia', 'openai', 'openrouter', 'cloudflare', 'huggingface'].includes(id)
    const model = item.model || id
    const limits = modelTokenLimits(model)
    return {
      id,
      name: item.name,
      kind: isBuiltIn ? 'builtin' : 'custom',
      configured: Boolean(item.configured),
      model,
      capabilities: {
        contextWindow: limits.context,
        maxOutput: limits.maxOutput,
        longContext: limits.context >= 200_000,
        reasoning: /deepseek|glm|nemotron|gpt-oss|gemini|qwen|minimax|muse/i.test(model),
        coding: /deepseek|glm|gpt-oss|qwen|nemotron/i.test(model),
        vision: /gemini|vision|gemma|diffusiongemma|llama-3\.2/i.test(model),
        metered: Boolean(limits.tpm),
      },
    }
  }).filter((item) => item.configured)
}

export function eligibleTeachers(registry, taskTypes, hasFile = false) {
  return registry.filter((teacher) => {
    if (hasFile && taskTypes.includes('vision') && !teacher.capabilities.vision) return false
    if (hasFile && taskTypes.includes('documents') && !teacher.capabilities.vision && !teacher.capabilities.longContext) return false
    if (taskTypes.includes('long_context') && !teacher.capabilities.longContext) return false
    return true
  })
}

const inputHash = (text) => createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16)
const outputHash = (text) => createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16)

export function similarityScore(left, right) {
  const a = new Set(String(left || '').toLowerCase().split(/\s+/).filter(Boolean))
  const b = new Set(String(right || '').toLowerCase().split(/\s+/).filter(Boolean))
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const word of a) if (b.has(word)) shared += 1
  return Number((2 * shared / (a.size + b.size)).toFixed(3))
}

export function evaluateResponse({ message, response, taskTypes = [], teacherCount = 1, siblings = [] }) {
  const text = String(response?.text || '').trim()
  if (!text) return { qualityScore: 0, accepted: false, reasons: ['رد فارغ'] }
  const reasons = []
  let score = 0.5

  const arabicRatio = (text.match(/[\u0600-\u06FF]/g) || []).length / Math.max(1, text.length)
  if (taskTypes.includes('arabic') && arabicRatio < 0.3) { score -= 0.25; reasons.push('عربية ضعيفة لمهمة عربية') }
  else if (arabicRatio >= 0.3) { score += 0.1; reasons.push('عربية سليمة') }

  if (text.length < 40) { score -= 0.2; reasons.push('رد قصير جداً') }
  else if (text.length > 200) score += 0.1

  if (text.includes('[object Object]') || /<\|?(?:think|im_start)/i.test(text)) { score -= 0.4; reasons.push('تسريب أو تشوه') }

  const structured = /\n#{1,3}\s|\n[-*•]\s|\n\d+\.\s/.test(text)
  if (text.length > 400 && structured) { score += 0.1; reasons.push('منظم') }

  if (taskTypes.includes('coding') && /```/.test(text)) { score += 0.15; reasons.push('كود مسيج') }
  if (taskTypes.includes('coding') && !/```/.test(text)) { score -= 0.2; reasons.push('كود بلا كتلة') }

  if (siblings.length) {
    const agreements = siblings.map((sibling) => similarityScore(text, sibling.text)).filter((value) => value > 0)
    const agreement = agreements.length ? Math.max(...agreements) : 0
    if (agreement >= 0.5) { score += 0.15; reasons.push(`اتفاق ${(agreement * 100).toFixed(0)}%`) }
    score = Math.max(0, Math.min(1, score))
    return {
      qualityScore: Number(score.toFixed(3)),
      agreementScore: agreement,
      accepted: score >= 0.55,
      reasons,
      teacherCount,
    }
  }

  score = Math.max(0, Math.min(1, score))
  return { qualityScore: Number(score.toFixed(3)), agreementScore: null, accepted: score >= 0.55, reasons, teacherCount }
}

export async function swarmLearn({ callProvider, message, mode = 'create', file = null, instructions = '', teachers = null }) {
  const taskTypes = classifyTask(message, Boolean(file), file?.mimetype || '')
  const registry = teachers || buildProviderRegistry()
  const eligible = eligibleTeachers(registry, taskTypes, Boolean(file))
  if (!eligible.length) {
    return { taskTypes, teachers: [], outputs: [], best: null, status: 'WAITING_FOR_PROVIDER', reason: 'لا يوجد معلم مؤهل لهذا النوع من المهام.' }
  }

  const attempts = eligible.map(async (teacher) => {
    try {
      const result = await callProvider(teacher.id, { message, mode, file, instructions, history: [] })
      return { teacherId: teacher.id, teacherModel: teacher.model, ...result, ok: true }
    } catch (error) {
      return { teacherId: teacher.id, teacherModel: teacher.model, ok: false, error: String(error?.message || error) }
    }
  })
  const settled = await Promise.allSettled(attempts)
  const outputs = settled.map((item) => item.status === 'fulfilled' ? item.value : { ok: false, teacherId: item.reason?.teacherId, error: item.reason?.message })

  const successful = outputs.filter((item) => item.ok && item.text)
  if (!successful.length) {
    return { taskTypes, teachers: eligible.map((item) => item.id), outputs, best: null, status: 'WAITING_FOR_PROVIDER', reason: 'فشل جميع المعلمين في هذا الطلب.' }
  }

  const evaluated = successful.map((output, index) => ({
    ...output,
    inputHash: inputHash(message),
    outputHash: outputHash(output.text),
    evaluation: evaluateResponse({
      message,
      response: output,
      taskTypes,
      teacherCount: successful.length,
      siblings: successful.filter((_, position) => position !== index),
    }),
  }))

  const qualified = evaluated.filter((item) => item.evaluation.accepted)
  const pool = qualified.length ? qualified : []
  const best = pool.sort((a, b) => (b.evaluation.qualityScore || 0) - (a.evaluation.qualityScore || 0))[0] || null

  return {
    taskTypes,
    teachers: eligible.map((item) => item.id),
    outputs: evaluated,
    best,
    status: best ? 'LEARNED' : 'EVALUATION_REJECTED',
    reason: best ? undefined : 'لم يتجاوز أي رد عتبة الجودة.',
  }
}

export const TRAINING_JOB_STATES = ['queued', 'waiting_for_gpu', 'running', 'checkpointing', 'evaluating', 'approved', 'rejected', 'deployed', 'failed']
export const TRAINING_PROVIDER_STATE = 'WAITING_FOR_CREDENTIALS'

export function newTrainingJob({ baseModel, datasetVersion, method = 'qlora' }) {
  return {
    id: `job-${Date.now()}`,
    baseModel: baseModel || 'gemma-4-26b',
    datasetVersion: datasetVersion || null,
    method,
    state: 'waiting_for_gpu',
    reason: 'لا يوجد مزوّد تدريب حقيقي مهيأ — التدريب يتطلب Cloud GPU معتمداً من المالك.',
    createdAt: new Date().toISOString(),
  }
}
