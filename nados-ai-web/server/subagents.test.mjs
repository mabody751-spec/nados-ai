import test from 'node:test'
import assert from 'node:assert/strict'
import { task, board_post, board_read, subagentCount } from './subagents.mjs'

const originalFetch = globalThis.fetch

test.afterEach(() => { globalThis.fetch = originalFetch })

test('board post and read work with since cursor', () => {
  const post1 = board_post('test-board', { agentId: 'a1', message: 'رسالة أولى', tags: ['t1'] })
  const post2 = board_post('test-board', { agentId: 'a2', message: 'رسالة ثانية', tags: ['t2'] })
  const all = board_read('test-board', {})
  assert.ok(all.length >= 2)
  const since = board_read('test-board', { since: post1.id })
  assert.equal(since.length, 1)
  assert.equal(since[0].message, 'رسالة ثانية')
  const filtered = board_read('test-board', { tags: ['t1'] })
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].agentId, 'a1')
})

test('subagent runs with clean context (foreground)', async () => {
  process.env.GROQ_API_KEY = 'test-key'
  process.env.NADOS_PROVIDER_MODE = 'sequential'
  process.env.NADOS_PROVIDER_ORDER = 'groq'
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'المهمة اكتملت بنجاح.' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const result = await task({ mode: 'ask', instructions: 'اختبر سياق نظيف' }, 'test-session')
  assert.ok(result.summary)
  assert.match(result.summary, /اكتملت/)
  assert.equal(result.error, undefined)
})

test('enforces max subagent depth', async () => {
  const result = await task({ mode: 'code', instructions: 'عميق', depth: 3 }, 'test')
  assert.match(result.error, /تجاوز عمق/)
  assert.equal(result.taskId, null)
})

test('background subagent returns taskId immediately', async () => {
  process.env.GROQ_API_KEY = 'test-key'
  process.env.NADOS_PROVIDER_MODE = 'sequential'
  process.env.NADOS_PROVIDER_ORDER = 'groq'
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'اكتمل' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const result = await task({ mode: 'code', instructions: 'مهمة خلفية', background: true }, 'bg-test')
  assert.ok(result.taskId)
  assert.equal(result.status, 'running')
})
