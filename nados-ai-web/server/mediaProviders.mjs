import { isModelSelectionError, modelPool } from './modelPools.mjs'
import { providerApiKeys } from './providerKeys.mjs'

function providerError(provider, response, body) {
  const detail = body?.error?.message || body?.message || `HTTP ${response.status}`
  const error = new Error(`${provider}: ${detail}`)
  error.status = response.status
  return error
}

async function withTimeout(promise, milliseconds, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: انتهت مهلة الطلب.`)), milliseconds) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function transcribeWithGroq(file) {
  const models = modelPool(process.env.GROQ_TRANSCRIBE_MODEL, process.env.GROQ_TRANSCRIBE_MODELS, ['whisper-large-v3-turbo', 'whisper-large-v3'])
  const keys = providerApiKeys('groq')
  let lastError
  for (const apiKey of keys) {
    for (const model of models) {
      try {
        const form = new FormData()
        form.set('model', model)
        form.set('file', new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' }), file.originalname || 'recording.webm')
        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
          signal: AbortSignal.timeout(120_000),
        })
        const body = await response.json().catch(() => null)
        if (!response.ok) throw providerError('Groq', response, body)
        return String(body?.text || '').trim()
      } catch (error) {
        lastError = error
        if (!isModelSelectionError(error)) break
      }
    }
  }
  throw lastError || new Error('Groq: لا يوجد نموذج تحويل صوت متاح.')
}

function pcmToWav(pcm, sampleRate) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

export async function synthesizeWithGemini(text) {
  const models = modelPool(process.env.GEMINI_TTS_MODEL, process.env.GEMINI_TTS_MODELS, ['gemini-2.5-flash-preview-tts'])
  const keys = providerApiKeys('gemini')
  let lastError
  for (const apiKey of keys) {
    for (const model of models) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_TTS_VOICE || 'Kore' } } },
            },
          }),
          signal: AbortSignal.timeout(120_000),
        })
        const body = await response.json().catch(() => null)
        if (!response.ok) throw providerError('Gemini TTS', response, body)
        const part = body?.candidates?.[0]?.content?.parts?.find((item) => item.inlineData || item.inline_data)
        const audio = part?.inlineData || part?.inline_data
        if (!audio?.data) throw new Error('Gemini TTS: لم تصل بيانات صوتية.')
        const mimeType = audio.mimeType || audio.mime_type || 'audio/L16;codec=pcm;rate=24000'
        const pcm = Buffer.from(audio.data, 'base64')
        const sampleRate = Number(/rate=(\d+)/i.exec(mimeType)?.[1] || 24_000)
        return { buffer: pcmToWav(pcm, sampleRate), contentType: 'audio/wav' }
      } catch (error) {
        lastError = error
        if (!isModelSelectionError(error)) break
      }
    }
  }
  throw lastError || new Error('Gemini TTS: لا يوجد نموذج متاح.')
}

