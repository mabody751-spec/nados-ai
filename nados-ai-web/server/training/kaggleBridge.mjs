import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const KAGGLE_API = 'https://www.kaggle.com/api/v1'
const DATASET_SLUG = 'nados-training-dataset'
const kernelSlug = () => String(process.env.KAGGLE_KERNEL_SLUG || '').trim() || 'nados-train'

export function kaggleConfig() {
  const apiToken = String(process.env.KAGGLE_API_TOKEN || '').trim()
  if (apiToken) {
    return { username: String(process.env.KAGGLE_USERNAME || '').trim(), token: apiToken, auth: `Bearer ${apiToken}` }
  }
  const username = String(process.env.KAGGLE_USERNAME || '').trim()
  const key = String(process.env.KAGGLE_KEY || '').trim()
  if (!username || !key) return null
  return { username, key, auth: `Basic ${Buffer.from(`${username}:${key}`).toString('base64')}` }
}

export function kaggleEnabled() {
  const config = kaggleConfig()
  return Boolean(config && config.auth)
}

async function kaggleFetch(path, { method = 'GET', body = null, raw = false } = {}) {
  const config = kaggleConfig()
  if (!config) throw new Error('KAGGLE_WAITING_FOR_CREDENTIALS: يلزم اسم المستخدم ومفتاح Kaggle API.')
  const response = await fetch(`${KAGGLE_API}${path}`, {
    method,
    headers: { Authorization: config.auth, ...(body && !raw ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? (raw ? body : JSON.stringify(body)) : undefined,
    signal: AbortSignal.timeout(120_000),
  })
  if (raw) return response
  const text = await response.text()
  let parsed = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = { raw: text.slice(0, 300) } }
  if (!response.ok) {
    const detail = parsed?.message || parsed?.detail || parsed?.raw || `HTTP ${response.status}`
    throw new Error(`Kaggle: ${detail}`)
  }
  return parsed
}

export async function verifyKaggleCredentials() {
  try {
    await kaggleFetch('/datasets/list?pageSize=1')
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error?.message || error) }
  }
}

function formatTrainingJsonl(examples) {
  return examples.map((example) => JSON.stringify({ question: example.question, answer: example.answer })).join('\n')
}

export async function exportDatasetFromSupabase(limit = 500) {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '')
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
  if (!url || !key) throw new Error('Kaggle: Supabase غير مهيأ لتصدير البيانات.')
  const response = await fetch(`${url}/rest/v1/training_examples?select=messages,quality_score&order=created_at.desc&limit=${Math.min(1000, limit)}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Kaggle: تعذّر قراءة أمثلة التدريب (HTTP ${response.status}).`)
  const rows = await response.json().catch(() => [])
  const examples = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const messages = Array.isArray(row.messages) ? row.messages : []
      const question = messages.find((m) => m.role === 'user')?.content || ''
      const answer = messages.find((m) => m.role === 'assistant')?.content || ''
      return { question, answer }
    })
    .filter((example) => example.question && example.answer)
  return { jsonl: formatTrainingJsonl(examples), count: examples.length }
}

const TRAINING_SCRIPT = `# Nados AI training notebook (Kaggle cloud GPU)
# Free-first: QLoRA fine-tuning that fits the free P100/T4 GPUs.
!pip install -q -U unsloth

import os, json, torch
from unsloth import FastLanguageModel
from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments

BASE_MODEL = os.environ.get("NADOS_BASE_MODEL", "unsloth/gemma-2-9b-it-bnb-4bit")
MAX_SEQ = 2048
OUT = "/kaggle/working/nados-model"

model, tokenizer = FastLanguageModel.from_pretrained(BASE_MODEL, max_seq_length=MAX_SEQ, load_in_4bit=True)
model = FastLanguageModel.get_peft_model(
    model, r=16, lora_alpha=16, lora_dropout=0,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    use_gradient_checkpointing="unsloth",
)

dataset = load_dataset("json", data_files="/kaggle/input/nados-training-dataset/training_examples.jsonl", split="train")
def format_example(example):
    return {"text": f"<start_of_turn>user\\n{example['question']}<end_of_turn>\\n<start_of_turn>model\\n{example['answer']}<end_of_turn>"}
dataset = dataset.map(format_example)
print(f"training examples: {len(dataset)}")

trainer = SFTTrainer(
    model=model, tokenizer=tokenizer, train_dataset=dataset,
    dataset_text_field="text", max_seq_length=MAX_SEQ,
    args=TrainingArguments(
        per_device_train_batch_size=2, gradient_accumulation_steps=4,
        warmup_steps=10, max_steps=120, learning_rate=2e-4,
        fp16=not torch.cuda.is_bf16_supported(), logging_steps=5,
        output_dir=OUT, optim="adamw_8bit", seed=3407,
    ),
)
trainer.train()
trainer.save_model(OUT)
with open("/kaggle/working/training_report.json", "w") as f:
    json.dump({"examples": len(dataset), "base_model": BASE_MODEL, "steps": 120}, f)
print("DONE")
`

export async function pushDataset(jsonl) {
  const config = kaggleConfig()
  const fileName = 'training_examples.jsonl'
  const contentLength = Buffer.byteLength(jsonl, 'utf8')
  const lastModified = Math.floor(Date.now() / 1000)
  const uploadInfo = await kaggleFetch(`/datasets/upload/file/${encodeURIComponent(fileName)}/${contentLength}/${lastModified}`, { method: 'POST', body: { fileName, contentLength, lastModifiedDateUtc: lastModified } })
  const createUrl = uploadInfo?.createUrl || uploadInfo?.token
  if (!createUrl) throw new Error('Kaggle: تعذّر الحصول على رابط الرفع.')
  const putResponse = await fetch(createUrl, {
    method: 'PUT',
    headers: {
      'X-Kaggle-File-Name': fileName,
      'X-Kaggle-Content-Length': String(contentLength),
      'X-Kaggle-Content-Last-Modified-Date-Utc': String(lastModified),
      'Content-Type': 'application/octet-stream',
    },
    body: Buffer.from(jsonl, 'utf8'),
    signal: AbortSignal.timeout(120_000),
  })
  if (!putResponse.ok) throw new Error(`Kaggle: فشل رفع الملف (HTTP ${putResponse.status}).`)
  const metadata = {
    ownerSlug: config.username,
    slug: DATASET_SLUG,
    title: 'Nados Training Dataset',
    isPrivate: true,
    licenses: [{ name: 'CC0-1.0' }],
  }
  const created = await kaggleFetch('/datasets/create/new', { method: 'POST', body: metadata })
  const createdError = created?.error || created?.errorNullable
  if (createdError && !/already exists/i.test(String(createdError))) throw new Error(`Kaggle: ${createdError}`)
  return { ref: `${config.username}/${DATASET_SLUG}`, uploaded: true, examples: null, created }
}

export async function pushTrainingKernel() {
  const config = kaggleConfig()
  const kernelRef = `${config.username}/${kernelSlug()}`
  const body = {
    id: kernelRef,
    title: 'Nados Train',
    language: 'python',
    kernel_type: 'script',
    is_private: true,
    enable_gpu: true,
    enable_tpu: false,
    enable_internet: true,
    dataset_data: { sources: [`${config.username}/${DATASET_SLUG}`] },
    kernel_data: { sources: { 'train.py': TRAINING_SCRIPT } },
    competition_sources: [],
    model_data_sources: [],
    category_ids: [],
  }
  const result = await kaggleFetch('/kernels/push', { method: 'POST', body })
  return { kernelRef, result }
}

async function kaggleCli(args) {
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
  const { stdout, stderr } = await execFileAsync('python', ['-m', 'kaggle', ...args], { env, timeout: 180_000, maxBuffer: 20 * 1024 * 1024, windowsHide: true })
  return { stdout: stdout || '', stderr: stderr || '' }
}

export async function kernelStatus() {
  const config = kaggleConfig()
  if (!config) return { state: 'WAITING_FOR_CREDENTIALS', message: 'يلزم بيانات Kaggle API.' }
  const kernelRef = `${config.username}/${kernelSlug()}`
  try {
    const { stdout } = await kaggleCli(['kernels', 'status', kernelRef])
    const match = /status "(.*?)"/.exec(stdout)
    const raw = match?.[1] || 'unknown'
    const state = raw.includes('RUNNING') ? 'running' : raw.includes('COMPLETE') ? 'complete' : raw.includes('ERROR') ? 'error' : raw.replace('KernelWorkerStatus.', '').toLowerCase()
    return { kernelRef, status: raw, state }
  } catch (error) {
    const message = String(error?.message || error)
    if (/not found|404|cannot access|permission.{0,30}denied|wrong kernel slug/i.test(message)) return { kernelRef, status: 'not_found', state: 'not_found', message: 'النواة غير موجودة بعد — شغّل تدريباً أولاً.' }
    return { kernelRef, status: 'unknown', state: 'unknown', message: message.slice(0, 200) }
  }
}

export async function kernelLiveState() {
  const config = kaggleConfig()
  if (!config) return { state: 'WAITING_FOR_CREDENTIALS' }
  const status = await kernelStatus()
  const live = { ...status, paramsTrainable: null, paramsTotal: null, paramsPercent: null, stepsDone: null, stepsTotal: 120, gpu: null, done: false, logTail: [] }
  if (['running', 'complete', 'error'].includes(status.state)) {
    try {
      const outDir = join(tmpdir(), `nados-kaggle-out-${config.username}-${Date.now()}`)
      mkdirSync(outDir, { recursive: true })
      await kaggleCli(['kernels', 'output', `${config.username}/${kernelSlug()}`, '-p', outDir])
      const log = await readFile(join(outDir, `${kernelSlug()}.log`), 'utf8')
      const parsed = JSON.parse(log)
      const all = parsed.map((event) => event?.data || '').join('')
      const paramsMatch = /trainable params: ([\d,]+) \|\| all params: ([\d,]+) \|\| trainable%: ([\d.]+)/.exec(all)
      if (paramsMatch) {
        live.paramsTrainable = Number(paramsMatch[1].replace(/,/g, ''))
        live.paramsTotal = Number(paramsMatch[2].replace(/,/g, ''))
        live.paramsPercent = Number(paramsMatch[3])
      }
      const stepMatches = [...all.matchAll(/(\d+)\/120 \[/g)]
      if (stepMatches.length) live.stepsDone = Number(stepMatches[stepMatches.length - 1][1])
      const gpuMatch = /gpu: (.+)/.exec(all)
      if (gpuMatch) live.gpu = gpuMatch[1].trim()
      live.done = /TRAINING_DONE/.test(all)
      live.logTail = parsed.slice(-6).map((event) => String(event?.data || '').trim()).filter(Boolean)
    } catch (error) {
      console.log(`[kaggle-live] log pull failed: ${String(error?.message || error).slice(0, 150)}`)
    }
  }
  return live
}

export async function pullKernelOutput() {
  const config = kaggleConfig()
  const kernelRef = `${config.username}/${kernelSlug()}`
  const response = await kaggleFetch(`/kernels/output?id=${encodeURIComponent(kernelRef)}`, { raw: false })
  return { kernelRef, listing: response }
}
