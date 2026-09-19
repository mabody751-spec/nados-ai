import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_CONVERSATION_CHARS, MAX_CONVERSATION_WORDS, MAX_MESSAGE_CHARS, MAX_MESSAGE_WORDS, validateConversationHistory, validateConversationText, validateMessageText } from './limits.mjs'

test('accepts the configured conversation limits', () => {
  assert.equal(validateConversationText('a'.repeat(MAX_CONVERSATION_CHARS)).length, MAX_CONVERSATION_CHARS)
  assert.equal(validateConversationText('a '.repeat(MAX_CONVERSATION_WORDS).trim()).split(/\s+/).length, MAX_CONVERSATION_WORDS)
})

test('rejects conversations above either limit', () => {
  assert.throws(() => validateConversationText('a'.repeat(MAX_CONVERSATION_CHARS + 1)), /12,000,000/)
  assert.throws(() => validateConversationText('a '.repeat(MAX_CONVERSATION_WORDS + 1)), /1,000,000/)
})

test('accepts and rejects the expanded single-message limit', () => {
  assert.equal(validateMessageText('a'.repeat(MAX_MESSAGE_CHARS)).length, MAX_MESSAGE_CHARS)
  assert.equal(validateMessageText('a '.repeat(MAX_MESSAGE_WORDS).trim()).split(/\s+/).length, MAX_MESSAGE_WORDS)
  assert.throws(() => validateMessageText('a'.repeat(MAX_MESSAGE_CHARS + 1)), /2,000,000/)
  assert.throws(() => validateMessageText('a '.repeat(MAX_MESSAGE_WORDS + 1)), /200,000/)
})

test('normalizes valid conversation memory', () => {
  const history = validateConversationHistory(JSON.stringify([
    { role: 'user', content: 'اسمي علي' },
    { role: 'assistant', content: 'أهلاً علي' },
  ]), 'ما اسمي؟')
  assert.deepEqual(history, [
    { role: 'user', content: 'اسمي علي' },
    { role: 'assistant', content: 'أهلاً علي' },
  ])
})

test('accepts array history payloads sent by the app', () => {
  const history = validateConversationHistory([
    { role: 'user', content: 'اسمي علي' },
    { role: 'assistant', content: 'أهلاً علي' },
  ], 'ما اسمي؟')
  assert.deepEqual(history, [
    { role: 'user', content: 'اسمي علي' },
    { role: 'assistant', content: 'أهلاً علي' },
  ])
})
