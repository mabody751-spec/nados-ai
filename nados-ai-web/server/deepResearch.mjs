import { callProvider } from './providers.mjs'
import { board_post } from './subagents.mjs'

const PLANNER_PROMPT = `أنت مخطط بحث. حلّل السؤال التالي وولّد 3-6 أسئلة فرعية تغطي جميع جوانبه. لكل سؤال، اقترح 3 كلمات مفتاحية للبحث.
أعد النتيجة بصيغة JSON صرفة فقط:
{"mainQuestion": "...", "subQuestions": [{"question": "...", "keywords": ["كلمة1", "كلمة2", "كلمة3"]}]}
لا تكتب أي شيء غير الـ JSON.`

const VALIDATOR_PROMPT = `أنت مدقق معلومات. لكل ادعاء في النتائج، صنّفه بدقة:
- مؤكد: مصدر رسمي أو ورقة علمية أو وكالة أنباء موثوقة
- محتمل: مصدر معقول بلا مصدر ثانٍ
- غير مؤكد: مصدر ضعيف أو مجهول
- متناقض: تتعارض مع نتيجة أخرى
أعد تقريراً موجزاً يصنف كل ادعاء مهم.`

const SYNTHESIZER_PROMPT = `أنت كاتب تقارير بحثية. اجمع النتائج في تقرير منسق:
- مقدمة (سياق السؤال)
- أقسام (لكل سؤال فرعي عنوان ##)
- خاتمة (الاستنتاجات)
- قائمة مراجع في النهاية
لكل جملة واقعية ضع [رقم] يشير للمصدر. ميّز بوضوح بين المعلومة الموثقة والاستنتاج. اكتب بلغة المستخدم.`

async function askProviderFor(prompt, fallbackQuestion) {
  const providers = ['gemini', 'groq', 'nvidia', 'xkiro-minimax-m3-free', 'atria-dawn-1', 'nvidia-nemotron-35-lightning']
  let lastError = null
  for (const providerId of providers) {
    try {
      const result = await callProvider(providerId, { message: fallbackQuestion || prompt, instructions: prompt, mode: 'create', history: [] })
      if (result?.text) return result
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('فشل جميع مزوّدي البحث.')
}

function parseJson(text) {
  const match = /\{[\s\S]*\}/.exec(String(text || ''))
  if (!match) return null
  try { return JSON.parse(match[0]) } catch { return null }
}

async function retrieveForSubQuestion(subQuestion, sessionId) {
  const query = String(subQuestion.question || subQuestion || '').slice(0, 300)
  board_post(sessionId, { agentId: 'retriever', message: `يبحث عن: ${query}`, tags: ['research', 'retriever'] })
  const form = new FormData()
  form.append('message', query)
  form.append('mode', 'web')
  const { callExternalProviders } = await import('./providers.mjs')
  let sources = []
  let text = ''
  try {
    const result = await callExternalProviders({ message: query, mode: 'web', instructions: 'ابحث وأجب بإيجاز مع المصادر.' })
    sources = result?.sources || []
    text = result?.text || ''
  } catch {}
  if (!sources.length) {
    const { fetchWebResults } = await import('./webSearch.mjs')
    sources = await fetchWebResults(query)
  }
  return { question: query, text: text.slice(0, 2500), sources }
}

export async function deepResearch(question, sessionId = 'sandbox') {
  const started = Date.now()

  board_post(sessionId, { agentId: 'planner', message: `تخطيط بحث: ${String(question).slice(0, 150)}`, tags: ['research', 'planner'] })
  const planResponse = await askProviderFor(PLANNER_PROMPT, `حلل سؤال البحث وولّد أسئلة فرعية: ${question}`)
  const plan = parseJson(planResponse?.text) || { mainQuestion: question, subQuestions: [{ question: question, keywords: [] }] }
  const subQuestions = (plan.subQuestions || []).slice(0, 6)
  board_post(sessionId, { agentId: 'planner', message: `الخطة: ${subQuestions.length} أسئلة فرعية`, tags: ['research', 'planner'] })

  const retrievals = await Promise.all(subQuestions.map((subQuestion) => retrieveForSubQuestion(subQuestion, sessionId)))
  const allSources = [...new Map(retrievals.flatMap((item) => item.sources).map((source) => [source.url, source])).values()].slice(0, 12)

  board_post(sessionId, { agentId: 'validator', message: `تحقق من ${allSources.length} مصدراً`, tags: ['research', 'validator'] })
  let validation = 'غير متاح'
  try {
    const validationPrompt = `${VALIDATOR_PROMPT}\n\nالمصادر:\n${allSources.map((source, index) => `${index + 1}. ${source.title || source.url} (${source.domain})`).join('\n')}\n\nالنتائج:\n${retrievals.map((item) => item.text.slice(0, 800)).join('\n---\n').slice(0, 3000)}`
    const validationResponse = await askProviderFor(validationPrompt, 'تحقق من مصادر البحث')
    validation = validationResponse?.text?.slice(0, 2000) || 'غير متاح'
  } catch {}

  board_post(sessionId, { agentId: 'synthesizer', message: 'كتابة التقرير النهائي', tags: ['research', 'synthesizer'] })
  const reportPrompt = `${SYNTHESIZER_PROMPT}\n\nالسؤال الرئيسي: ${plan.mainQuestion || question}\n\nنتائج الأسئلة الفرعية:\n${retrievals.map((item, index) => `## ${item.question}\n${item.text}`).join('\n\n').slice(0, 6000)}\n\nالمصادر المتاحة:\n${allSources.map((source, index) => `[${index + 1}] ${source.title || ''} — ${source.url}`).join('\n')}\n\nالتحقق:\n${validation}`
  const reportResponse = await askProviderFor(reportPrompt, `اكتب تقريراً بحثياً عن: ${question}`)

  return {
    mainQuestion: plan.mainQuestion || question,
    subQuestions,
    report: reportResponse?.text || '',
    sources: allSources,
    validation,
    durationMs: Date.now() - started,
  }
}
