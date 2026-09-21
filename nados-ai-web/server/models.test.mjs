import test from 'node:test'
import assert from 'node:assert/strict'
import { availableModels, resolveModelSelection } from './models.mjs'

test('publishes the unified Nados v1.1 model with 1M context', () => {
  process.env.KAGGLE_TRAINING_DONE = '1'
  const models = availableModels()
  const nados = models.find((item) => item.id === 'nados')
  assert.ok(nados)
  assert.equal(nados.label, 'Nados v1.1')
  assert.equal(nados.providerId, 'nados')
  assert.equal(nados.provider, 'Nados')
  assert.equal(nados.contextWindow, 1_000_000)
  assert.equal(nados.webSearch, true)
  assert.equal(nados.vision, true)
  assert.equal(nados.files, true)
  assert.ok(nados.params?.trainable > 50_000_000)
  assert.equal(JSON.stringify(models).includes('sk-'), false)
  delete process.env.KAGGLE_TRAINING_DONE
})

test('falls back to unified Nados v1.0 without the trained model', () => {
  delete process.env.NADOS_LOCAL_LLM_URL
  delete process.env.KAGGLE_TRAINING_DONE
  const models = availableModels()
  const nados = models.find((item) => item.id === 'nados')
  assert.ok(nados)
  assert.equal(nados.label, 'Nados v1.0')
  assert.equal(nados.contextWindow, 1_000_000)
  assert.equal(models.some((item) => item.id === 'nados-v1-1'), false)
})

test('resolves any model id to the unified Nados model', () => {
  assert.equal(resolveModelSelection('model-not-allowed').id, 'nados')
  assert.equal(resolveModelSelection('nados').id, 'nados')
  assert.equal(resolveModelSelection('nados-v1').id, 'nados')
})
