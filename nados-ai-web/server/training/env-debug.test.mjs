import test from 'node:test'
import assert from 'node:assert/strict'

test('env debug', () => {
  const env = {
    U: process.env.KAGGLE_USERNAME || null,
    K: process.env.KAGGLE_KEY || null,
    T: process.env.KAGGLE_API_TOKEN || null,
    T_LEN: process.env.KAGGLE_API_TOKEN ? process.env.KAGGLE_API_TOKEN.length : 0,
  }
  console.log('KAGGLE ENV in test runner:', JSON.stringify(env))
  assert.ok(true)
})