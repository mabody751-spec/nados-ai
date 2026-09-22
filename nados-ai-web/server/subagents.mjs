import { runAgentLoop, MAX_STEPS } from './agentLoop.mjs'
import { getMode, modeToolsAllowed } from './modes.mjs'

const MAX_SUBAGENT_DEPTH = 3
const MAX_PARALLEL_SUBAGENTS = 10

const boards = new Map()

export function board_post(sessionId, { agentId, message, tags = [] }) {
  if (!boards.has(sessionId)) boards.set(sessionId, [])
  const board = boards.get(sessionId)
  const post = { id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, agentId, message: String(message || '').slice(0, 2000), tags, at: new Date().toISOString() }
  board.push(post)
  if (board.length > 200) board.splice(0, board.length - 200)
  return post
}

export function board_read(sessionId, { since = null, tags = null, limit = 50 } = {}) {
  const board = boards.get(sessionId) || []
  let items = board
  if (since) {
    const index = board.findIndex((post) => post.id === since)
    if (index >= 0) items = board.slice(index + 1)
  }
  if (tags) items = items.filter((post) => (post.tags || []).some((tag) => tags.includes(tag)))
  return items.slice(-limit)
}

const runningSubagents = new Map()

export function subagentCount(sessionId) {
  return runningSubagents.get(sessionId)?.length || 0
}

export async function task({ mode = 'code', instructions, background = false, depth = 0 }, parentSessionId = 'sandbox') {
  if (depth >= MAX_SUBAGENT_DEPTH) {
    return { error: `تجاوز عمق الوكلاء الفرعيين (الحد ${MAX_SUBAGENT_DEPTH} مستويات)`, taskId: null }
  }
  if (subagentCount(parentSessionId) >= MAX_PARALLEL_SUBAGENTS) {
    return { error: `تجاوز الوكلاء المتوازيين (الحد ${MAX_PARALLEL_SUBAGENTS})`, taskId: null }
  }
  const modeDef = getMode(mode)
  const taskId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  board_post(parentSessionId, { agentId: taskId, message: `انطلق وكيل فرعي (${modeDef.name}): ${String(instructions).slice(0, 150)}`, tags: ['spawn', modeDef.slug] })

  if (background) {
    const entry = { taskId, state: 'running', startedAt: Date.now() }
    runningSubagents.set(parentSessionId, [...(runningSubagents.get(parentSessionId) || []), entry])
    void runAgentLoop({ task: instructions, sessionId: taskId, mode: modeDef.slug })
      .then((result) => {
        entry.state = 'complete'
        entry.summary = result.summary?.slice(0, 400)
        entry.filesChanged = result.filesChanged
        board_post(parentSessionId, { agentId: taskId, message: `أنجزت المهمة: ${result.summary?.slice(0, 200)}`, tags: ['done', modeDef.slug] })
      })
      .catch((error) => {
        entry.state = 'failed'
        entry.error = String(error?.message || error).slice(0, 300)
        board_post(parentSessionId, { agentId: taskId, message: `فشلت المهمة: ${entry.error}`, tags: ['failed', modeDef.slug] })
      })
      .finally(() => {
        const list = (runningSubagents.get(parentSessionId) || []).filter((item) => item.taskId !== taskId)
        runningSubagents.set(parentSessionId, list)
      })
    return { taskId, status: 'running', mode: modeDef.slug }
  }

  try {
    const result = await runAgentLoop({ task: instructions, sessionId: taskId, mode: modeDef.slug })
    board_post(parentSessionId, { agentId: taskId, message: `أنجزت: ${result.summary?.slice(0, 200)}`, tags: ['done', modeDef.slug] })
    return { taskId, summary: result.summary, filesChanged: result.filesChanged, steps: result.steps, durationMs: result.durationMs }
  } catch (error) {
    board_post(parentSessionId, { agentId: taskId, message: `فشلت: ${String(error?.message || error).slice(0, 200)}`, tags: ['failed'] })
    return { taskId, error: String(error?.message || error), steps: 0 }
  }
}
