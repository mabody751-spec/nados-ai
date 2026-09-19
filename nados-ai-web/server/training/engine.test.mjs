import test from 'node:test'
import assert from 'node:assert/strict'
import { buildProviderRegistry, classifyTask, eligibleTeachers, evaluateResponse, newTrainingJob, similarityScore, swarmLearn } from './engine.mjs'

test.beforeEach(() => {
  process.env.GROQ_API_KEY = 'test-key'
  process.env.NVIDIA_API_KEY = 'test-key'
  process.env.NVIDIA_MODEL = 'nvidia/nemotron-3-super-120b-a12b'
})

test.afterEach(() => {
  delete process.env.GROQ_API_KEY
  delete process.env.NVIDIA_API_KEY
})

test('classifies tasks by type', () => {
  assert.deepEqual(classifyTask('اكتب كود دالة للجمع'), ['general', 'coding', 'arabic'])
  assert.deepEqual(classifyTask('حلل لماذا فشل هذا المنطق', false, ''), ['general', 'reasoning', 'arabic'])
  assert.ok(classifyTask('Write a landing page for my company').includes('english'))
  assert.ok(classifyTask('شلون الحال', false, '').includes('iraqi_arabic'))
  assert.ok(classifyTask('حلل الصورة', true, 'image/png').includes('vision'))
})

test('builds the registry from configured providers only', () => {
  const registry = buildProviderRegistry()
  assert.ok(registry.length >= 2)
  assert.ok(registry.every((item) => item.configured))
  assert.ok(registry.find((item) => item.id === 'groq'))
  assert.ok(registry.find((item) => item.id === 'nvidia'))
})

test('filters eligible teachers by task capability', () => {
  const registry = buildProviderRegistry()
  const visionTeachers = eligibleTeachers(registry, ['general', 'vision'], true)
  assert.ok(visionTeachers.every((item) => item.capabilities.vision))
  const longContextTeachers = eligibleTeachers(registry, ['general', 'long_context'], false)
  assert.ok(longContextTeachers.every((item) => item.capabilities.longContext))
})

test('swarm learns from all teachers in parallel', async () => {
  const calls = []
  const callProvider = async (id) => {
    calls.push(id)
    if (id === 'groq') return { text: 'الاختبارات الآلية تكتشف الأخطاء مبكراً وتضمن جودة كل إصدار قبل الإطلاق.', provider: id }
    return { text: 'الاختبارات الآلية تكتشف الأخطاء مبكراً وتضمن جودة كل إصدار.', provider: id }
  }
  const result = await swarmLearn({ callProvider, message: 'ما فوائد الاختبارات الآلية؟', mode: 'create' })
  assert.equal(result.status, 'LEARNED')
  assert.equal(result.teachers.length, calls.length)
  assert.ok(result.best)
  assert.ok(result.best.evaluation.agreementScore > 0.4)
})

test('returns real waiting state when no teacher qualifies', async () => {
  const callProvider = async () => ({ text: '', provider: 'groq' })
  const result = await swarmLearn({ callProvider, message: 'سؤال', mode: 'create' })
  assert.equal(result.status, 'WAITING_FOR_PROVIDER')
  assert.equal(result.best, null)
})

test('evaluates quality and rejects garbage', () => {
  const good = evaluateResponse({ message: 'س', response: { text: 'إجابة عربية مفصلة ومنظمة حول فوائد الاختبارات الآلية في هندسة البرمجيات الحديثة مع أمثلة عملية.' }, taskTypes: ['arabic', 'coding'] })
  assert.ok(good.qualityScore >= 0.4)
  const garbage = evaluateResponse({ message: 'س', response: { text: '[object Object],,[object Object]' }, taskTypes: ['arabic'] })
  assert.equal(garbage.accepted, false)
})

test('computes similarity for deduplication', () => {
  assert.ok(similarityScore('الاختبارات تكتشف الأخطاء', 'الاختبارات تكتشف الأخطاء') === 1)
  assert.ok(similarityScore('الاختبارات تكتشف الأخطاء', 'الطقس مشمس اليوم') < 0.3)
})

test('new training jobs wait for real GPU credentials', () => {
  const job = newTrainingJob({ baseModel: 'gemma-4-26b' })
  assert.equal(job.state, 'waiting_for_gpu')
  assert.ok(job.reason.includes('Cloud GPU'))
})
