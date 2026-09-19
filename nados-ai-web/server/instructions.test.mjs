import test from 'node:test'
import assert from 'node:assert/strict'
import { capabilityReply, effectiveProviderMode, identityReply, isNadosCapabilityQuestion, isNadosIdentityQuestion, modeInstructions } from './instructions.mjs'

const connectedFeatures = {
  webSearch: true,
  vision: true,
  video: true,
  images: true,
  transcription: true,
  speech: true,
  computer: true,
}

test('describes Nados product capabilities instead of raw model limitations', () => {
  const instructions = modeInstructions('web', connectedFeatures)
  assert.match(instructions, /بحث الإنترنت المباشر متصل/)
  assert.match(instructions, /تحليل الصور/)
  assert.match(instructions, /تحليل ملفات الفيديو/)
  assert.match(instructions, /إنشاء صور حقيقية/)
  assert.match(instructions, /لا تقل إنك تقتصر على المعرفة الداخلية/)
})

test('tells the model when a video is actually attached', () => {
  const instructions = modeInstructions('files', connectedFeatures, { mimetype: 'video/mp4' })
  assert.match(instructions, /فيديو مرفق متاح لك للتحليل الآن/)
})

test('does not claim unavailable capabilities are connected', () => {
  const instructions = modeInstructions('create', { webSearch: false, vision: false, video: false, images: false })
  assert.match(instructions, /بحث الإنترنت المباشر غير متاح حالياً/)
  assert.match(instructions, /تحليل الفيديو غير متاح حالياً/)
  assert.match(instructions, /إنشاء الصور غير متاح حالياً/)
})

test('recognizes product capability questions without intercepting normal searches', () => {
  assert.equal(isNadosCapabilityQuestion('هل تستطيع الوصول إلى الإنترنت واستخدام أدوات خارجية ودعم الصور والفيديو؟'), true)
  assert.equal(isNadosCapabilityQuestion('ابحث في الإنترنت عن موقع Microsoft'), false)
})

test('does not intercept long prompts that merely mention capability keywords', () => {
  const longPrompt = `اكتب لي مقالاً تعليمياً مفصلاً عن تطور الذكاء الاصطناعي، مع شرح كيف تدعم النماذج الحديثة تحليل الصور والصوت والفيديو والويب، ${'وتفاصيل إضافية كثيرة عن كل جانب '.repeat(20)}واختم بخاتمة شاملة.`
  assert.ok(longPrompt.length > 300)
  assert.equal(isNadosCapabilityQuestion(longPrompt), false)
  assert.equal(isNadosIdentityQuestion(`${longPrompt} وما اسم النموذج المستخدم في الموقع؟`), false)
})

test('builds a capability answer from live feature flags', () => {
  const reply = capabilityReply(connectedFeatures)
  const text = [...reply.answer, ...reply.bullets].join('\n')
  assert.match(text, /متصل بخدمات وأدوات فعلية/)
  assert.match(text, /البحث المباشر في الإنترنت/)
  assert.match(text, /تحليل الفيديو المرفق/)
  assert.match(text, /غير متاح حالياً: إنشاء الفيديو/)
})

test('answers Nados identity questions from the product core', () => {
  assert.equal(isNadosIdentityQuestion('هلو من معي اي نموذج'), true)
  assert.equal(isNadosIdentityQuestion('من أنت وما هو النموذج؟'), true)
  assert.equal(isNadosIdentityQuestion('اشرح لي هذا الكود'), false)
  assert.match(identityReply().answer[0], /Nados v1\.0/)
})

test('uses general providers for ordinary web-mode conversation', () => {
  assert.equal(effectiveProviderMode('web', 'هلو من معي اي نموذج'), 'create')
  assert.equal(effectiveProviderMode('web', 'اشرح لي مفهوم قواعد البيانات'), 'create')
  assert.equal(effectiveProviderMode('web', 'ابحث عن أحدث أخبار التقنية اليوم'), 'web')
  assert.equal(effectiveProviderMode('research', 'قارن الخيارات'), 'research')
  assert.equal(effectiveProviderMode('web', 'حلل هذا الفيديو', true), 'files')
})
