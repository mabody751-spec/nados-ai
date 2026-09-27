// Connects an externally-hosted Nados inference endpoint (Colab/Kaggle/any OpenAI
// compatible server) to this app: verifies /health + /v1/chat/completions, then
// updates .env (NADOS_LOCAL_LLM_URL and NADOS_PREFER_LOCAL).
// Usage: node scripts/connect-nados.mjs https://xxxx.trycloudflare.com [--prefer] [--off]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = join(root, '.env')
const args = process.argv.slice(2)
const url = (args.find((a) => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '')
const prefer = args.includes('--prefer')
const off = args.includes('--off')

if (!url && !off) {
  console.error('الاستخدام: node scripts/connect-nados.mjs https://your-tunnel.trycloudflare.com [--prefer]')
  process.exit(1)
}

async function probe(target) {
  const health = await fetch(`${target}/health`, { signal: AbortSignal.timeout(15000) }).catch((e) => ({ ok: false, status: 0, _err: e }))
  let healthText = ''
  try { healthText = await health.text() } catch {}
  let chatOk = false
  let chatSample = ''
  if (health.ok) {
    try {
      const res = await fetch(`${target}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'قل مرحبا فقط' }], max_tokens: 16 }),
        signal: AbortSignal.timeout(45000),
      })
      const body = await res.json().catch(() => null)
      chatOk = res.ok && Boolean(body?.choices?.[0]?.message?.content)
      chatSample = body?.choices?.[0]?.message?.content || JSON.stringify(body).slice(0, 120)
    } catch (e) { chatSample = String(e.message) }
  }
  return { healthOk: health.ok, healthStatus: health.status, healthText: healthText.slice(0, 120), chatOk, chatSample }
}

function updateEnv(key, value) {
  let text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
  const line = `${key}=${value}`
  if (new RegExp(`^${key}=.*$`, 'm').test(text)) text = text.replace(new RegExp(`^${key}=.*$`, 'm'), line)
  else text += `${text.endsWith('\n') ? '' : '\n'}${line}\n`
  writeFileSync(envPath, text)
}

if (off) {
  updateEnv('NADOS_PREFER_LOCAL', 'off')
  console.log('تم إيقاف تفضيل النموذج الخارجي (NADOS_PREFER_LOCAL=off).')
  process.exit(0)
}

console.log(`فحص النقطة الخارجية: ${url}`)
const result = await probe(url)
console.log(JSON.stringify(result, null, 2))

if (!result.healthOk) {
  console.error('❌ لم يستجب /health — تأكد أن خادم النموذج يعمل والرابط صحيح.')
  process.exit(2)
}
if (!result.chatOk) {
  console.error('⚠️ /health يعمل لكن /v1/chat/completions لم يُرجع نصاً. تحقق من تحميل النموذج.')
  process.exit(3)
}

updateEnv('NADOS_LOCAL_LLM_URL', url)
if (prefer) updateEnv('NADOS_PREFER_LOCAL', 'on')
console.log(`✅ تم ربط Nados بالعنوان: ${url}`)
console.log(prefer ? '✅ تم تفعيل تفضيل النموذج الخارجي (NADOS_PREFER_LOCAL=on).' : 'ℹ️ النموذج الخارجي احتياطي. أضف --prefer لتفضيله.')
console.log('أعد تشغيل خادم Nados لتحميل القيم الجديدة: npm start')
