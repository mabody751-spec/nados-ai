import test from 'node:test'
import assert from 'node:assert/strict'
import { availableModels, resolveModelSelection } from './models.mjs'

test('publishes only the unified Nados v1.0 model option', () => {
  const models = availableModels()
  assert.deepEqual(models, [{
    id: 'nados-v1',
    label: 'Nados v1.0',
    providerId: 'auto',
    provider: 'توجيه تلقائي',
    model: 'أفضل نموذج متاح',
    webSearch: true,
    vision: true,
    files: true,
  }])
  assert.equal(JSON.stringify(models).includes('sk-'), false)
})

test('resolves any model id to the unified Nados model', () => {
  assert.equal(resolveModelSelection('model-not-allowed').id, 'nados-v1')
  assert.equal(resolveModelSelection('nados-v1').id, 'nados-v1')
})
