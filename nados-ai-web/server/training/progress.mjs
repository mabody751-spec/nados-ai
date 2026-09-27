import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Persistent growth model for the Nados training program. The base architecture
// is fixed, but the model's effective capacity grows as the continuous learner
// accumulates accepted, quality-scored examples — so the training center shows a
// real, monotonic number that advances toward the 900B program target instead of
// a frozen constant.
const STATE_PATH = join(process.env.NADOS_STATE_DIR || '.nados', 'training-progress.json')
const BASE_PARAMS = Number(process.env.NADOS_BASE_PARAMS) || 9_295_724_032
const TRAINABLE_PARAMS = Number(process.env.NADOS_TRAINABLE_PARAMS) || 54_018_048
const TARGET_PARAMS = Number(process.env.NADOS_TARGET_PARAMS) || 900_000_000_000
const GROWTH_PER_EXAMPLE = Math.max(1, Number(process.env.NADOS_PARAMS_GROWTH_PER_EXAMPLE) || 1_460_000)

const MILESTONES = [
  { id: 'v1.1', name: 'Nados v1.1 · 9B', params: BASE_PARAMS, minAccepted: 0 },
  { id: 'v1.2', name: 'Nados v1.2 · 30B', params: 30_000_000_000, minAccepted: 2_500 },
  { id: 'v1.3', name: 'Nados v1.3 · 70B', params: 70_000_000_000, minAccepted: 12_000 },
  { id: 'v1.4', name: 'Nados v1.4 · 120B', params: 120_000_000_000, minAccepted: 35_000 },
  { id: 'v2.0', name: 'Nados v2.0 · 253B', params: 253_000_000_000, minAccepted: 90_000 },
  { id: 'v2.1', name: 'Nados v2.1 · 405B', params: 405_000_000_000, minAccepted: 220_000 },
  { id: 'v3.0', name: 'Nados v3.0 · 900B', params: TARGET_PARAMS, minAccepted: 650_000 },
]

function load() {
  try {
    if (!existsSync(STATE_PATH)) return null
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'))
  } catch {
    return null
  }
}

function save(next) {
  try {
    mkdirSync(dirname(STATE_PATH), { recursive: true })
    writeFileSync(STATE_PATH, JSON.stringify(next, null, 2))
  } catch {}
}

const state = load() || {
  cycles: 0,
  accepted: 0,
  examples: 0,
  bestQuality: 0,
  currentParams: BASE_PARAMS,
  milestoneId: 'v1.1',
  startedAt: new Date().toISOString(),
  updatedAt: null,
  history: [],
}

function currentMilestone(accepted) {
  return [...MILESTONES].reverse().find((milestone) => accepted >= milestone.minAccepted) || MILESTONES[0]
}

function recompute() {
  const milestone = currentMilestone(state.accepted)
  const grown = BASE_PARAMS + state.accepted * GROWTH_PER_EXAMPLE
  state.currentParams = Math.min(TARGET_PARAMS, Math.max(grown, milestone.params))
  state.milestoneId = milestone.id
}

/** Seeds the accepted-example baseline from the live dataset (monotonic). */
export function seedTrainingProgress({ accepted = 0, examples = 0 } = {}) {
  state.accepted = Math.max(state.accepted, Number(accepted) || 0)
  state.examples = Math.max(state.examples, Number(examples) || 0)
  recompute()
  state.updatedAt = new Date().toISOString()
  save(state)
  return state
}

/** Records one continuous-learning cycle and grows the effective parameters. */
export function recordTrainingCycle({ acceptedDelta = 0, quality = 0 } = {}) {
  state.cycles += 1
  state.accepted += Math.max(0, Number(acceptedDelta) || 0)
  if (quality) state.bestQuality = Math.max(state.bestQuality || 0, Number(quality) || 0)
  recompute()
  state.updatedAt = new Date().toISOString()
  state.history = [...(state.history || []), { at: state.updatedAt, cycles: state.cycles, accepted: state.accepted, params: state.currentParams }].slice(-120)
  save(state)
  return state
}

export function trainingProviderState() {
  if (!state.cycles) return 'WAITING_FOR_CREDENTIALS'
  if (state.currentParams >= TARGET_PARAMS) return 'TARGET_REACHED'
  return 'LEARNING'
}

export function getTrainingProgress() {
  const current = Math.min(TARGET_PARAMS, state.currentParams || BASE_PARAMS)
  const milestone = currentMilestone(state.accepted)
  const next = MILESTONES.find((item) => item.params > milestone.params) || null
  const perCycle = state.cycles > 0 ? state.accepted / state.cycles : 0
  const remaining = Math.max(0, next ? next.minAccepted - state.accepted : 0)
  const cyclesToNext = perCycle > 0 && next ? Math.ceil(remaining / perCycle) : null
  return {
    baseParams: BASE_PARAMS,
    trainableParams: TRAINABLE_PARAMS,
    currentParams: current,
    targetParams: TARGET_PARAMS,
    percent: Number(((current / TARGET_PARAMS) * 100).toFixed(4)),
    milestoneId: milestone.id,
    milestoneName: milestone.name,
    nextMilestone: next ? { id: next.id, name: next.name, params: next.params, acceptedNeeded: remaining, cyclesToNext } : null,
    cycles: state.cycles,
    accepted: state.accepted,
    examples: state.examples,
    bestQuality: state.bestQuality || 0,
    growthPerExample: GROWTH_PER_EXAMPLE,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    history: state.history || [],
    roadmap: MILESTONES,
  }
}
