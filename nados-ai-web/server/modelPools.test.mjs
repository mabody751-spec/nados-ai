import test from 'node:test'
import assert from 'node:assert/strict'
import { isModelSelectionError, modelPool } from './modelPools.mjs'

test('builds a unique ordered internal model pool', () => {
  assert.deepEqual(modelPool('model-a', 'model-b,model-a, model-c', ['model-b']), ['model-a', 'model-b', 'model-c'])
})

test('only retries failures related to model availability', () => {
  assert.equal(isModelSelectionError({ status: 404 }), true)
  assert.equal(isModelSelectionError({ status: 429 }), false)
  assert.equal(isModelSelectionError({ status: 500 }), false)
})
