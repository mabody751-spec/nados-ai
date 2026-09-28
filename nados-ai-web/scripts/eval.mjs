// Nados quality eval harness (Phase 1/5).
// Runs a fixed, deterministically-scored task set against a Nados backend and
// prints a scorecard. Used to compare Nados v1.1 vs v1.0 vs individual models
// and to guard quality regressions.
//
// Usage:
//   node scripts/eval.mjs [--base http://127.0.0.1:8787] [--token X] [--variant v1.1]
//   node scripts/eval.mjs --suite nados        # compare v1.1 vs v1.0
//   node scripts/eval.mjs --suite models       # compare selected models
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def }
const BASE = (opt('base', 'http://127.0.0.1:8787')).replace(/\/+$/, '')
const TOKEN = opt('token', process.env.NADOS_PROXY_TOKEN || '')
const SUITE = opt('suite', '')
const headers = TOKEN ? { 'x-nados-proxy-token': TOKEN } : {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Normalize Arabic-Indic digits and common transliteration variants before scoring.
function normalize(text) {
  return String(text || '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
}

function riyadhToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function pyAdd(code) {
  // Execute the Python code block and verify add(2,3) === 5.
  const m = /```(?:python)?\s*([\s\S]*?)```/i.exec(code)
  const body = m ? m[1] : code
  if (!/def\s+add\s*\(/.test(body)) return false
  try {
    const out = execFileSync('python', ['-c', `${body}\nprint(add(2,3))`], { timeout: 8000, encoding: 'utf8' })
    return out.trim() === '5'
  } catch {
    return false
  }
}

const TASKS = [
  { id: 'mul', num: 1, prompt: 'احسب 47 × 89. أجب بالرقم فقط.', check: (t) => /(^|\D)4183(\D|$)/.test(normalize(t).trim().slice(0, 16)) },
  { id: 'word', num: 1, prompt: 'ثمن 7 أقلام 91 ريالاً. ما ثمن القلم الواحد؟ أجب بالرقم فقط.', check: (t) => /(^|\D)13(\D|$)/.test(normalize(t).trim().slice(0, 16)) },
  { id: 'percent', num: 1, prompt: 'كم يساوي 15% من 240؟ أجب بالرقم فقط.', check: (t) => /(^|\D)36(\D|$)/.test(normalize(t).trim().slice(0, 16)) },
  { id: 'reason', num: 1, prompt: 'أحمد أطول من سامي، وسامي أطول من ليلى. من الأطول؟ أجب بالاسم فقط.', check: (t) => /أحمد/.test(t.slice(0, 30)) },
  { id: 'capital', num: 1, prompt: 'ما عاصمة أستراليا؟ أجب باسم المدينة فقط.', check: (t) => /كانبرا|كانبيرا|canberra/i.test(t) },
  { id: 'date', num: 1, prompt: 'ما تاريخ اليوم؟ أجب بالتاريخ فقط.', check: (t) => normalize(t).includes(riyadhToday()) || /202[0-9]/.test(normalize(t)) && /سبتمبر|September/i.test(t) },
  { id: 'grammar', num: 1, prompt: 'ما إعراب (الكتاب) في: قرأتُ الكتابَ؟ أجب بالإعراب فقط.', check: (t) => /مفعول\s*به/.test(t.slice(0, 40)) },
  { id: 'translate', num: 1, prompt: 'ترجم للإنجليزية: "العقل السليم في الجسم السليم". أجب بالترجمة فقط.', check: (t) => /sound mind/i.test(t) && /sound body/i.test(t) },
  { id: 'legs', num: 1, prompt: 'كم عدد أرجل العنكبوت؟ أجب بالرقم فقط.', check: (t) => /(^|\D)8(\D|$)|ثمان/.test(normalize(t).slice(0, 20)) },
  { id: 'instruction', num: 1, prompt: 'اكتب ثلاث فواكه فقط، بفواصل، وبدون أي كلمة أخرى.', check: (t) => { const items = t.replace(/[.،,!.]+/g, ',').split(',').map((x) => x.trim()).filter(Boolean); return items.length === 3 && items.every((x) => x.length < 15) } },
  { id: 'code', num: 1, prompt: 'اكتب دالة Python باسم add تعيد مجموع عددين داخل كتلة ```python فقط.', check: (t) => pyAdd(t) },
  { id: 'concise', num: 1, prompt: 'عرّف الذكاء الاصطناعي في جملة واحدة فقط، بلا مقدمات ولا نقاط.', check: (t) => { const s = t.replace(/\s+/g, ' ').trim(); const sentences = s.split(/[.!؟\n]+/).map((x) => x.trim()).filter(Boolean); return sentences.length === 1 && s.length < 240 } },
]
const MAX = TASKS.reduce((n, t) => n + t.num, 0)

// Harder, still deterministically-scored tasks (reasoning, code fixing, format
// adherence, hallucination resistance, arithmetic with the live date).
function datePlus(days) {
  const base = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' }))
  base.setDate(base.getDate() + days)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(base)
}
const HARD = [
  { id: 'date_math', num: 1, prompt: 'ما هو التاريخ بعد 45 يوماً من اليوم؟ أجب بصيغة YYYY-MM-DD فقط.', check: (t) => normalize(t).includes(datePlus(45)) },
  { id: 'bugfix', num: 1, prompt: 'الكود التالي فيه خطأ:\n```python\ndef add(a, b):\n    return a - b\n```\nصحّحه بحيث يعيد حاصل الجمع، وأعد الكود داخل ```python فقط.', check: (t) => pyAdd(t) },
  { id: 'json_out', num: 1, prompt: 'أعد كائن JSON فقط (بدون شرح) بالمفتاح name وقيمته Nados.', check: (t) => { try { const j = JSON.parse(t.replace(/```json|```/g, '').trim()); return j && j.name === 'Nados' } catch { return false } } },
  { id: 'table', num: 1, prompt: 'اعرض جدول Markdown بصفّين في البيانات وعمودين (مدينة، بلد). لا تضف نصاً آخر.', check: (t) => { const rows = t.split('\n').filter((l) => /\|/.test(l) && !/^\s*\|?[\s:|-]+\|?\s*$/.test(l)); return rows.length >= 3 } },
  { id: 'seconds', num: 1, prompt: 'كم ثانية في 3 ساعات؟ أجب بالرقم فقط.', check: (t) => /(^|\D)10800(\D|$)/.test(normalize(t).trim().slice(0, 16)) },
  { id: 'sum4', num: 1, prompt: 'اجمع: 12 + 8 + 15 + 5. أجب بالرقم فقط.', check: (t) => /(^|\D)40(\D|$)/.test(normalize(t).trim().slice(0, 16)) },
  { id: 'reverse', num: 1, prompt: 'اكتب الكلمة (نادوس) معكوسة الحروف. أجب بالكلمة فقط.', check: (t) => /سودان/.test(t.slice(0, 20)) },
  { id: 'one_word', num: 1, prompt: 'أجب بكلمة واحدة فقط: ما لون السماء في النهار الصافي؟', check: (t) => { const words = t.replace(/[.،!؟]/g, ' ').trim().split(/\s+/).filter(Boolean); return words.length === 1 && /أزرق|سماوي|الأزرق|السماوي/.test(words[0]) } },
  { id: 'no_hallucination', num: 1, prompt: 'من هو مخترع جهاز «راكد صقر 9000»؟', check: (t) => /لا\s*(يوجد|أعرف|يمكن|توجد|معلومات)|غير\s*موجود|غير\s*معروف|خيال|وهمي|لا\s*أستطيع|لا\s*يتوفر|غير\s*حقيقي|أسطو/.test(t) && !/(اخترعه|مخترعه|العالم|الدكتور|المهندس)\s+\S+\s+\S+/i.test(t) },
  { id: 'ar_plural', num: 1, prompt: 'ما جمع كلمة (كتاب) في العربية؟ أجب بالجمع فقط.', check: (t) => /كُ?تب/.test(t.slice(0, 20)) },
  { id: 'km_to_m', num: 1, prompt: 'إذا كان 1 كيلومتر = 1000 متر، فكم متراً في 2.5 كيلومتر؟ أجب بالرقم فقط.', check: (t) => /(^|\D)2500(\D|$)/.test(normalize(t).trim().slice(0, 16)) },
  { id: 'fraction', num: 1, prompt: 'كم يساوي نصف الثلث من 60؟ أجب بالرقم فقط.', check: (t) => /(^|\D)10(\D|$)/.test(normalize(t).trim().slice(0, 16)) },
  { id: 'time_until', num: 1, prompt: 'إذا كانت الساعة الآن 3:45، فكم دقيقة تبقّى حتى الساعة 5:00؟ أجب بالرقم فقط.', check: (t) => /(^|\D)75(\D|$)/.test(normalize(t).trim().slice(0, 16)) },
]
const TASK_SETS = { base: TASKS, hard: HARD }

async function ask({ model = 'nados', variant = 'v1.1', prompt, timeoutMs = 60000 }) {
  const boundary = `----eval${Math.random().toString(16).slice(2)}`
  const parts = []
  for (const [k, v] of Object.entries({ message: prompt, mode: 'create', model, variant, history: '[]' })) {
    parts.push(`--${boundary}`, `Content-Disposition: form-data; name="${k}"`, '', v)
  }
  parts.push(`--${boundary}--`, '')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const start = performance.now()
  let text = '', modelLabel = null
  try {
    const res = await fetch(`${BASE}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, ...headers },
      body: Buffer.from(parts.join('\r\n'), 'utf8'),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
    for (;;) {
      const { done, value } = await reader.read(); if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n'); buf = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim(); if (!payload) continue
        let ev; try { ev = JSON.parse(payload) } catch { continue }
        if (ev.type === 'delta' && ev.delta) text += ev.delta
        if (ev.type === 'error') throw new Error(ev.message || 'error')
        if (ev.type === 'done' && ev.reply) { text = (ev.reply.answer || []).join('\n'); modelLabel = ev.reply.model || null }
      }
    }
  } catch (e) {
    clearTimeout(timer); return { ok: false, ms: Math.round(performance.now() - start), error: String(e.message), text: '' }
  }
  clearTimeout(timer)
  return { ok: true, ms: Math.round(performance.now() - start), text, modelLabel }
}

async function runOne({ label, model, variant }, tasks) {
  const max = tasks.reduce((n, t) => n + t.num, 0)
  let score = 0; const times = []; const fails = []
  for (const task of tasks) {
    const out = await ask({ model, variant, prompt: task.prompt })
    const pass = out.ok && task.check(out.text)
    if (pass) score += task.num; else fails.push(task.id + (out.error ? `(${out.error.slice(0, 20)})` : ''))
    if (out.ok) times.push(out.ms)
    process.stdout.write(pass ? '✓' : '✗')
    await sleep(700)
  }
  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null
  console.log(`\n${label}: ${score}/${max} | avg ${avg}ms | fails: ${fails.join(',') || '-'}`)
  return { label, model, variant, score, max, avgMs: avg, fails }
}

const suites = {
  nados: [
    { label: 'Nados v1.1 (default)', model: 'nados', variant: 'v1.1' },
    { label: 'Nados v1.0', model: 'nados', variant: 'v1.0' },
  ],
  models: [
    { label: 'Nemotron 550B', model: 'nvidia-nvidia-nemotron-3-ultra-550b-a55b', variant: 'v1.1' },
    { label: 'Qwen 3.8 Max', model: 'xkiro-qwen-38-max', variant: 'v1.1' },
    { label: 'GPT-OSS 20B', model: 'groq-gpt-oss-20b', variant: 'v1.1' },
  ],
  hard: [
    { label: 'Nados v1.1 (hard)', model: 'nados', variant: 'v1.1' },
    { label: 'Nados v1.0 (hard)', model: 'nados', variant: 'v1.0' },
  ],
}

const taskSetName = opt('tasks', SUITE === 'hard' ? 'hard' : 'base')
const tasks = TASK_SETS[taskSetName] || TASKS
const runs = SUITE && suites[SUITE]
  ? suites[SUITE]
  : [{ label: `Nados ${opt('variant', 'v1.1')}`, model: opt('model', 'nados'), variant: opt('variant', 'v1.1') }]

console.log(`Eval against ${BASE} · set=${taskSetName} · today=${riyadhToday()}\n`)
const results = []
for (const run of runs) results.push(await runOne(run, tasks))

console.log('\n=== SCORECARD ===')
for (const r of results.slice().sort((a, b) => b.score - a.score || (a.avgMs || 1e9) - (b.avgMs || 1e9))) {
  console.log(`${r.label}: ${r.score}/${r.max} (${Math.round((r.score / r.max) * 100)}%) · ${r.avgMs}ms`)
}
console.log('JSON=' + JSON.stringify(results))
