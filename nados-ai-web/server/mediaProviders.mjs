import { InferenceClient } from '@huggingface/inference'
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

export async function generateImageWithGemini(prompt, ratio) {
  const models = modelPool(process.env.GEMINI_IMAGE_MODEL, process.env.GEMINI_IMAGE_MODELS, ['gemini-3.1-flash-image'])
  const keys = providerApiKeys('gemini')
  const aspectRatios = { square: '1:1', landscape: '3:2', portrait: '2:3' }
  let lastError
  for (const apiKey of keys) {
    for (const model of models) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspectRatios[ratio] || '1:1' } },
          }),
          signal: AbortSignal.timeout(120_000),
        })
        const body = await response.json().catch(() => null)
        if (!response.ok) throw providerError('Gemini Images', response, body)
        const part = body?.candidates?.[0]?.content?.parts?.find((item) => item.inlineData || item.inline_data)
        const image = part?.inlineData || part?.inline_data
        if (!image?.data) throw new Error('Gemini Images: لم تصل بيانات صورة.')
        return `data:${image.mimeType || image.mime_type || 'image/png'};base64,${image.data}`
      } catch (error) {
        lastError = error
        if (!isModelSelectionError(error)) break
      }
    }
  }
  throw lastError || new Error('Gemini Images: لا يوجد نموذج متاح.')
}

export async function generateImageWithHuggingFace(prompt, ratio) {
  const keys = providerApiKeys('huggingface')
  const models = modelPool(process.env.HUGGINGFACE_IMAGE_MODEL, process.env.HUGGINGFACE_IMAGE_MODELS, ['stabilityai/stable-diffusion-xl-base-1.0'])
  const dimensions = { square: [768, 768], landscape: [1024, 680], portrait: [680, 1024] }
  const [width, height] = dimensions[ratio] || dimensions.square
  let lastError
  for (const apiKey of keys) {
    const client = new InferenceClient(apiKey)
    for (const model of models) {
      try {
        const image = await withTimeout(client.textToImage({
          provider: process.env.HUGGINGFACE_IMAGE_PROVIDER || 'fal-ai',
          model,
          inputs: prompt,
          parameters: { width, height, num_inference_steps: 4 },
        }), 120_000, 'Hugging Face Images')
        const buffer = Buffer.from(await image.arrayBuffer())
        if (!buffer.length) throw new Error('Hugging Face Images: لم تصل بيانات صورة.')
        return `data:${image.type || 'image/jpeg'};base64,${buffer.toString('base64')}`
      } catch (error) {
        lastError = error
      }
    }
  }
  throw lastError || new Error('Hugging Face Images: لا يوجد نموذج متاح.')
}

export async function generateImageWithProviders(prompt, ratio) {
  const failures = []
  if (providerApiKeys('gemini').length) {
    try {
      return await generateImageWithGemini(prompt, ratio)
    } catch (error) {
      failures.push(error)
    }
  }
  if (providerApiKeys('huggingface').length) {
    try {
      return await generateImageWithHuggingFace(prompt, ratio)
    } catch (error) {
      failures.push(error)
    }
  }
  const error = failures.at(-1) || new Error('لا يوجد مزود صور مهيأ.')
  error.message = failures.map((failure) => failure.message).join(' | ') || error.message
  throw error
}
