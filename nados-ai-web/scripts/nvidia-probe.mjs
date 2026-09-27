#!/usr/bin/env node
// Fetch the real NVIDIA NIM catalog and probe every chat-capable model with a
// live completion. Usage:
//   node scripts/nvidia-probe.mjs                # fetch (cached) + probe all
//   node scripts/nvidia-probe.mjs --refresh      # force catalog refresh first
//   node scripts/nvidia-probe.mjs --catalog      # only list the catalog
//   node scripts/nvidia-probe.mjs --concurrency=6 --timeout=40000
import { fetchNvidiaCatalog, probeNvidiaCatalog, nvidiaCatalogSummary, nvidiaConfigured } from '../server/nvidiaModels.mjs'

const args = process.argv.slice(2)
const has = (flag) => args.includes(flag)
const value = (name, fallback) => {
  const match = args.find((arg) => arg.startsWith(`--${name}=`))
  return match ? match.split('=').slice(1).join('=') : fallback
}

if (!nvidiaConfigured()) {
  console.error('NVIDIA: لا يوجد مفتاح API (NVIDIA_API_KEY أو مزوّد NVIDIA في الإعدادات).')
  process.exit(2)
}

const refresh = has('--refresh')
const catalogOnly = has('--catalog')
const concurrency = Number(value('concurrency', 6))
const timeoutMs = Number(value('timeout', 75_000))
const retryTimeoutMs = Number(value('retry-timeout', 150_000))

console.log('→ جلب كتالوج NVIDIA الحقيقي…')
const catalog = await fetchNvidiaCatalog({ force: refresh })
console.log(`الكتالوج: ${catalog.count} نموذجاً (${catalog.source}) · قابلة للمحادثة: ${catalog.models.filter((entry) => entry.chat).length}`)

if (catalogOnly) {
  for (const entry of catalog.models) {
    console.log(`${entry.chat ? 'chat ' : '----'} ${entry.vision ? 'vision ' : '       '}${entry.coding ? 'code ' : '     '}${entry.id}`)
  }
  process.exit(0)
}

console.log(`→ فحص فعلي (توازٍ ${concurrency}، مهلة ${timeoutMs}ms، إعادة ${retryTimeoutMs}ms للنماذج الباردة)…`)
const started = Date.now()
const report = await probeNvidiaCatalog({
  models: catalog.models,
  concurrency,
  timeoutMs,
  retryTimeoutMs,
  onProgress: ({ done, total, model, ok, label }) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}${label === 'retry' ? '*' : ' '} [${done}/${total}] ${model}`)
  },
})

const ok = report.results.filter((item) => item.ok)
const failed = report.results.filter((item) => !item.ok)
console.log(`\n==== النتيجة: ${ok.length}/${report.total} يعمل · ${failed.length} فشل · ${Math.round((Date.now() - started) / 1000)}ث ====`)
console.log(`أنواع الفشل: ${JSON.stringify(report.failureKinds)}`)
console.log(`نموذج العمل الأساسي: ${report.workDefaultModel} (${ok.some((item) => item.model === report.workDefaultModel) ? 'يعمل ✓' : 'غير مؤكد'})`)
console.log(`نموذج المحادثة المرشّح: ${report.chatDefaultModel} (${ok.some((item) => item.model === report.chatDefaultModel) ? 'يعمل ✓' : 'غير مؤكد'})`)
if (failed.length) {
  console.log('\nنماذج فاشلة:')
  for (const item of failed) console.log(` - ${item.model}: ${String(item.error).slice(0, 120)}`)
}
console.log('\nالملخّص:', JSON.stringify(nvidiaCatalogSummary(), null, 2))
process.exit(ok.length ? 0 : 1)
