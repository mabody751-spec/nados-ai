import test from 'node:test'
import assert from 'node:assert/strict'
import { buildContextHistory } from './contextEngine.mjs'

const make = (n, prefix = 'm') => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${prefix}${i} نص الرسالة رقم ${i}` }))

test('returns short history unchanged with no memory', () => {
  const history = make(5)
  const result = buildContextHistory(history, 'سؤال جديد')
  assert.equal(result.history.length, 5)
  assert.equal(result.memory, '')
  assert.equal(result.stats.digested, 0)
})

test('keeps recent turns verbatim and digests older ones', () => {
  const history = make(40)
  const result = buildContextHistory(history, 'سؤال جديد', { keepRecent: 10 })
  assert.equal(result.history.length >= 10, true)
  assert.match(result.memory, /ملخص ذاكرة المحادثة/)
  assert.equal(result.stats.digested > 0, true)
  // The newest message must always survive.
  assert.equal(result.history.at(-1).content, history.at(-1).content)
})

test('selects older turns relevant to the current message', () => {
  const history = [
    { role: 'user', content: 'موضوع سابق عن الطقس في بغداد' },
    { role: 'assistant', content: 'الطقس معتدل' },
    { role: 'user', content: 'كلام غير مرتبط' },
    { role: 'assistant', content: 'حسنا' },
    ...make(8, 'tail'),
  ]
  const result = buildContextHistory(history, 'أعد لي ملخص الطقس في بغداد', { keepRecent: 6 })
  assert.equal(result.stats.relevant >= 1, true)
  assert.equal(result.history.some((m) => /الطقس في بغداد/.test(m.content)), true)
})

test('respects the character budget for kept turns', () => {
  const history = make(200, 'طويل')
  const result = buildContextHistory(history, 'سؤال', { budgetChars: 6000, keepRecent: 20 })
  const chars = result.history.reduce((n, m) => n + m.content.length, 0)
  assert.equal(chars <= 6000, true)
})

test('never returns an empty history when input had messages', () => {
  const result = buildContextHistory(make(50), 'سؤال', { budgetChars: 4200, keepRecent: 4 })
  assert.equal(result.history.length > 0, true)
})
