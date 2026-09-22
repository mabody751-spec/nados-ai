import test from 'node:test'
import assert from 'node:assert/strict'
import { board_post, board_read } from './subagents.mjs'
import { deepResearch } from './deepResearch.mjs'

const originalFetch = globalThis.fetch

test.afterEach(() => { globalThis.fetch = originalFetch })

test('deep research pipeline completes with plan and report', async () => {
  process.env.GROQ_API_KEY = 'test-key'
  process.env.NADOS_PROVIDER_MODE = 'sequential'
  process.env.NADOS_PROVIDER_ORDER = 'groq'
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"mainQuestion": "السؤال الرئيسي", "subQuestions": [{"question": "سؤال فرعي", "keywords": ["أ", "ب"]}]} ' } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const result = await deepResearch('سؤال بحثي تجريبي', 'research-test')
  assert.ok(result.mainQuestion)
  assert.ok(result.subQuestions.length >= 1)
  assert.ok(result.report)
  assert.ok(Array.isArray(result.sources))
})

test('research board logs all agent activity', async () => {
  const posts = board_read('research-test', {})
  assert.ok(posts.length >= 2)
  assert.ok(posts.some((post) => post.agentId === 'planner'))
  assert.ok(posts.some((post) => post.agentId === 'validator'))
  assert.ok(posts.some((post) => post.agentId === 'synthesizer'))
})
