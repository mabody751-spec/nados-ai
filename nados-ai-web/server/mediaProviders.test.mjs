import test from 'node:test'
import assert from 'node:assert/strict'
import { generateImageWithGemini, synthesizeWithGemini, transcribeWithGroq } from './mediaProviders.mjs'

const originalFetch = globalThis.fetch

test.afterEach(() => {
  globalThis.fetch = originalFetch
  delete process.env.GROQ_API_KEYS
  delete process.env.GEMINI_API_KEYS
})

test('transcribes audio through Groq Whisper', async () => {
  process.env.GROQ_API_KEY = 'groq-test'
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /groq\.com\/openai\/v1\/audio\/transcriptions/)
    assert.equal(options.headers.Authorization, 'Bearer groq-test')
    assert.equal(options.body.get('model'), 'whisper-large-v3-turbo')
    return new Response(JSON.stringify({ text: 'مرحبا من Nados' }), { status: 200 })
  }
  const text = await transcribeWithGroq({ buffer: Buffer.from('audio'), mimetype: 'audio/wav', originalname: 'sample.wav' })
  assert.equal(text, 'مرحبا من Nados')
})

test('retries transcription with a backup Groq key', async () => {
  process.env.GROQ_API_KEY = 'quota-key'
  process.env.GROQ_API_KEYS = 'working-key'
  const requestedKeys = []
  globalThis.fetch = async (_url, options) => {
    requestedKeys.push(options.headers.Authorization)
    if (options.headers.Authorization === 'Bearer quota-key') {
      return new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 })
    }
    return new Response(JSON.stringify({ text: 'المفتاح الاحتياطي يعمل' }), { status: 200 })
  }
  const text = await transcribeWithGroq({ buffer: Buffer.from('audio'), mimetype: 'audio/wav', originalname: 'sample.wav' })
  assert.equal(text, 'المفتاح الاحتياطي يعمل')
  assert.deepEqual(requestedKeys, ['Bearer quota-key', 'Bearer working-key'])
})

test('converts Gemini PCM speech to playable WAV', async () => {
  process.env.GEMINI_API_KEY = 'gemini-test'
  globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: Buffer.from([1, 2, 3, 4]).toString('base64') } }] } }],
  }), { status: 200 })
  const speech = await synthesizeWithGemini('مرحبا')
  assert.equal(speech.contentType, 'audio/wav')
  assert.equal(speech.buffer.subarray(0, 4).toString(), 'RIFF')
  assert.equal(speech.buffer.length, 48)
})

test('returns Gemini image as a browser data URL', async () => {
  process.env.GEMINI_API_KEY = 'gemini-test'
  globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] } }],
  }), { status: 200 })
  assert.equal(await generateImageWithGemini('Nados', 'square'), 'data:image/png;base64,aW1hZ2U=')
})
