import test from 'node:test'
import assert from 'node:assert/strict'
import { runAgentLoop, MAX_STEPS, parseAgentResponse } from './agentLoop.mjs'

const originalFetch = globalThis.fetch

test.afterEach(() => { globalThis.fetch = originalFetch })

test('parses tool call JSON from agent response', () => {
  const parsed = parseAgentResponse('سأقرأ الملف.\n{"tool": "read_file", "params": {"path": "test.txt"}}')
  assert.equal(parsed.toolCall?.tool, 'read_file')
  assert.equal(parsed.toolCall?.params.path, 'test.txt')
})

test('returns content when no tool call present', () => {
  const parsed = parseAgentResponse('المهمة اكتملت بنجاح.')
  assert.equal(parsed.toolCall, undefined)
  assert.match(parsed.content, /اكتملت/)
})

test('agent loop completes a simple file task', async () => {
  process.env.GROQ_API_KEY = 'test-key'
  process.env.NADOS_PROVIDER_MODE = 'sequential'
  process.env.NADOS_PROVIDER_ORDER = 'groq'
  let calls = 0
  const scripted = [
    'سأنشئ الملف.\n{"tool": "write_file", "params": {"path": "agent-test.txt", "content": "hello from agent"}}',
    '{"tool": "read_file", "params": {"path": "agent-test.txt"}}',
    'أنشأت الملف وقرأته بنجاح. المحتوى: hello from agent',
  ]
  globalThis.fetch = async () => {
    const response = scripted[Math.min(calls, scripted.length - 1)]
    calls += 1
    return new Response(JSON.stringify({ choices: [{ message: { content: response } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const events = []
  const result = await runAgentLoop({ task: 'أنشئ ملف agent-test.txt بمحتوى hello from agent', mode: 'create', onEvent: (event) => events.push(event) })
  assert.ok(result.filesChanged.some((file) => file.includes('agent-test.txt')))
  assert.ok(result.steps >= 2)
  assert.ok(events.some((event) => event.type === 'tool_call'))
  assert.ok(events.some((event) => event.type === 'tool_result'))
  assert.ok(events.some((event) => event.type === 'agent_done'))
})

test('agent loop handles tool errors gracefully', async () => {
  process.env.GROQ_API_KEY = 'test-key'
  process.env.NADOS_PROVIDER_MODE = 'sequential'
  process.env.NADOS_PROVIDER_ORDER = 'groq'
  const scripted = [
    '{"tool": "read_file", "params": {"path": "nonexistent-file-xyz.txt"}}',
    'الملف غير موجود، المهمة لا يمكن إتمامها.',
  ]
  let calls = 0
  globalThis.fetch = async () => {
    const response = scripted[Math.min(calls, scripted.length - 1)]
    calls += 1
    return new Response(JSON.stringify({ choices: [{ message: { content: response } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const events = []
  const result = await runAgentLoop({ task: 'اقرأ ملفاً غير موجود', mode: 'create', onEvent: (event) => events.push(event) })
  const toolResult = events.find((event) => event.type === 'tool_result')
  assert.ok(toolResult?.result?.error || toolResult?.result?.output)
  assert.match(result.summary, /غير موجود|لا يمكن/)
})

test('respects max steps limit', () => {
  assert.equal(MAX_STEPS, 50)
})
