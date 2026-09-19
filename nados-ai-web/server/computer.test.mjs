import test from 'node:test'
import assert from 'node:assert/strict'
import { isBlockedWindowTitle, requestedSafeUrl } from './computer.mjs'

test('blocks sensitive and system windows from Computer Use', () => {
  assert.equal(isBlockedWindowTitle('API Key | Settings | OpenRouter - Google Chrome'), true)
  assert.equal(isBlockedWindowTitle('C:\\Program Files\\nodejs\\node.exe'), true)
  assert.equal(isBlockedWindowTitle('Windows Security'), true)
  assert.equal(isBlockedWindowTitle('Windows Default Lock Screen'), true)
  assert.equal(isBlockedWindowTitle('CC Switch'), true)
  assert.equal(isBlockedWindowTitle('QTrayIconMessageWindow'), true)
  assert.equal(isBlockedWindowTitle('MS_WebcheckMonitor'), true)
  assert.equal(isBlockedWindowTitle('Quick Share'), true)
  assert.equal(isBlockedWindowTitle('Nados AI - Google Chrome'), false)
})

test('allows HTTPS and local HTTP navigation only', () => {
  assert.equal(requestedSafeUrl('افتح https://example.com/path'), 'https://example.com/path')
  assert.equal(requestedSafeUrl('افتح http://127.0.0.1:5174/'), 'http://127.0.0.1:5174/')
  assert.equal(requestedSafeUrl('افتح http://localhost:5174/'), 'http://localhost:5174/')
  assert.equal(requestedSafeUrl('افتح http://example.com/'), null)
  assert.equal(requestedSafeUrl('افتح file:///C:/secret.txt'), null)
})
