import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { callExternalProviders } from './providers.mjs'

const SESSION_TTL = 30 * 60 * 1000
const PLAN_TTL = 90 * 1000
const blockedWindow = /(terminal|powershell|command prompt|cmd\.exe|node\.exe|codex|chatgpt|windows security|defender|windows default lock screen|lockapp|1password|bitwarden|lastpass|keepass|api[ -]?key|secret|credential|password|billing|wallet|bank|shell handwriting canvas|windows input experience|program manager|cc switch|qtrayiconmessagewindow|ms_webcheckmonitor|quick share|100% complete|explorer)/i
const computerSessions = new Map()
const pendingPlans = new Map()
let nutPromise

export function isBlockedWindowTitle(title) {
  return blockedWindow.test(String(title || ''))
}

async function getNut() {
  if (!nutPromise) nutPromise = import('@nut-tree-fork/nut-js')
  return nutPromise
}

async function activeWindowDetails() {
  const { getActiveWindow } = await getNut()
  const window = await getActiveWindow()
  return {
    title: String(await window.getTitle().catch(() => '')).trim(),
    region: await window.getRegion().catch(() => null),
  }
}

async function ensureDesktopUnlocked() {
  const active = await activeWindowDetails()
  if (/windows default lock screen|lockapp/i.test(active.title)) {
    throw Object.assign(new Error('سطح مكتب Windows مقفل. افتح القفل ثم أعد المحاولة.'), { status: 423 })
  }
}

async function focusTarget(target) {
  const focused = await target.window.focus().catch(() => false)
  if (focused) return
  const [active, region] = await Promise.all([activeWindowDetails(), target.window.getRegion().catch(() => null)])
  const sameTitle = active.title && active.title === target.title
  const sameRegion = active.region && region
    && active.region.left === region.left && active.region.top === region.top
    && active.region.width === region.width && active.region.height === region.height
  if (!sameTitle || !sameRegion) {
    throw Object.assign(new Error('تعذّر تنشيط النافذة المستهدفة بأمان. افتحها في المقدمة ثم أعد المحاولة.'), { status: 409 })
  }
}

function cleanExpired() {
  const now = Date.now()
  for (const [token, session] of computerSessions) if (session.expiresAt <= now) computerSessions.delete(token)
  for (const [id, plan] of pendingPlans) if (plan.expiresAt <= now) pendingPlans.delete(id)
}

function requireSession(token) {
  cleanExpired()
  const session = computerSessions.get(String(token || ''))
  if (!session) throw Object.assign(new Error('انتهت جلسة التحكم. أعد الاتصال بالكمبيوتر.'), { status: 401 })
  session.expiresAt = Date.now() + SESSION_TTL
  return session
}

async function safeWindows() {
  const { getWindows } = await getNut()
  const windows = await getWindows()
  const items = []
  for (const window of windows) {
    const title = String(await window.getTitle().catch(() => '')).trim()
    const region = await window.getRegion().catch(() => null)
    if (!title || !region || region.width < 240 || region.height < 160 || isBlockedWindowTitle(title)) continue
    items.push({ id: randomUUID(), title: title.slice(0, 180), window, region })
  }
  return items.slice(0, 30)
}

export async function computerStatus() {
  try {
    await getNut()
    return { available: process.platform === 'win32', approvalRequired: true, sessionMinutes: SESSION_TTL / 60000 }
  } catch (error) {
    return { available: false, approvalRequired: true, error: error.message }
  }
}

export async function openComputerSession() {
  if (process.platform !== 'win32') throw Object.assign(new Error('التحكم المحلي متاح على Windows فقط.'), { status: 503 })
  await ensureDesktopUnlocked()
  const windows = await safeWindows()
  const token = randomUUID()
  computerSessions.set(token, { expiresAt: Date.now() + SESSION_TTL, windows: new Map(windows.map((item) => [item.id, item])), target: null })
  return {
    token,
    expiresAt: new Date(Date.now() + SESSION_TTL).toISOString(),
    windows: windows.map(({ id, title }) => ({ id, title })),
  }
}

export function closeComputerSession(token) {
  const removed = computerSessions.delete(String(token || ''))
  for (const [id, plan] of pendingPlans) if (plan.token === token) pendingPlans.delete(id)
  return removed
}

async function captureTarget(session, windowId) {
  const target = session.windows.get(String(windowId || ''))
  if (!target) throw Object.assign(new Error('النافذة المحددة غير متاحة. أعد اتصال جلسة الكمبيوتر.'), { status: 404 })
  if (isBlockedWindowTitle(target.title)) throw Object.assign(new Error('لا يسمح Nados بالتحكم في هذه النافذة الحساسة.'), { status: 403 })
  await focusTarget(target)
  const region = await target.window.getRegion()
  const { screen, FileType } = await getNut()
  const baseName = `nados-computer-${randomUUID()}`
  const screenshotPath = await screen.captureRegion(baseName, region, FileType.PNG, tmpdir())
  try {
    const buffer = await readFile(screenshotPath)
    session.target = target
    return { buffer, region }
  } finally {
    await rm(screenshotPath, { force: true }).catch(() => {})
  }
}

function parseJson(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('لم يرجع نموذج الرؤية إجراءً صالحاً.')
  return JSON.parse(cleaned.slice(start, end + 1))
}

function normalizeAction(input, region) {
  const action = String(input?.action || '').toLowerCase()
  const description = String(input?.description || 'إجراء على النافذة المحددة').trim().slice(0, 240)
  if (action === 'finish') return { action, description }
  if (action === 'click' || action === 'double_click') {
    const x = Math.round(Number(input.x))
    const y = Math.round(Number(input.y))
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= region.width || y >= region.height) throw new Error('إحداثيات الإجراء خارج النافذة.')
    return { action, x, y, description }
  }
  if (action === 'type') {
    const text = String(input.text || '').slice(0, 2000)
    if (!text) throw new Error('إجراء الكتابة فارغ.')
    return { action, text, description }
  }
  if (action === 'key') {
    const key = String(input.key || '').toLowerCase()
    const allowed = new Set(['enter', 'tab', 'escape', 'backspace', 'up', 'down', 'left', 'right', 'pageup', 'pagedown', 'home', 'end', 'ctrl+a', 'ctrl+c', 'ctrl+l', 'ctrl+v'])
    if (!allowed.has(key)) throw new Error('اختصار لوحة المفاتيح المقترح غير مسموح.')
    return { action, key, description }
  }
  if (action === 'scroll') {
    const direction = input.direction === 'up' ? 'up' : 'down'
    const amount = Math.min(10, Math.max(1, Math.round(Number(input.amount) || 3)))
    return { action, direction, amount, description }
  }
  throw new Error('نوع الإجراء المقترح غير مسموح.')
}

export function requestedSafeUrl(task) {
  const match = String(task || '').match(/https?:\/\/[^\s<>"']+/i)
  if (!match) return null
  try {
    const url = new URL(match[0].replace(/[)،,.;]+$/, ''))
    const localHttp = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.href.length > 2048) return null
    return url.href
  } catch {
    return null
  }
}

export async function planComputerStep({ token, windowId, task, previous = [], providerId = 'auto', model = '', file }) {
  const session = requireSession(token)
  const request = String(task || '').trim().slice(0, 2000)
  if (!request) throw Object.assign(new Error('اكتب المهمة التي تريد تنفيذها.'), { status: 400 })
  const directUrl = requestedSafeUrl(request)
  if (directUrl) {
    const target = session.windows.get(String(windowId || ''))
    if (!target) throw Object.assign(new Error('النافذة المحددة غير متاحة. أعد اتصال جلسة الكمبيوتر.'), { status: 404 })
    if (isBlockedWindowTitle(target.title)) throw Object.assign(new Error('لا يسمح Nados بالتحكم في هذه النافذة الحساسة.'), { status: 403 })
    const action = { action: 'navigate_url', url: directUrl, description: `فتح ${new URL(directUrl).hostname} في النافذة المحددة` }
    const planId = randomUUID()
    pendingPlans.set(planId, { token, action, windowId, expiresAt: Date.now() + PLAN_TTL })
    return {
      planId,
      action,
      provider: 'nados-local',
      requiresConfirmation: true,
      screenshot: null,
    }
  }
  const { buffer, region } = await captureTarget(session, windowId)
  const instructions = [
    'You are the visual planner for a consent-based Windows computer controller.',
    'Return exactly one JSON object and no markdown.',
    'Allowed actions: click, double_click, type, key, scroll, finish.',
    'Coordinates are relative to the supplied screenshot: top-left is 0,0.',
    'Schemas: {"action":"click","x":1,"y":1,"description":"..."}; {"action":"type","text":"...","description":"..."}; {"action":"key","key":"enter|tab|escape|backspace|up|down|left|right|pageup|pagedown|home|end|ctrl+a|ctrl+c|ctrl+l|ctrl+v","description":"..."}; {"action":"scroll","direction":"up|down","amount":3,"description":"..."}; {"action":"finish","description":"..."}.',
    'Never operate terminals, system security settings, authentication, password managers, financial transactions, account creation, deletion, messages, uploads, or permission dialogs.',
    'If the task is complete, unclear, unsafe, or needs one of those actions, return finish and explain why.',
    'Plan only the next single small action. The user will inspect and approve it before execution.',
  ].join('\n')
  const providedFile = file && file.buffer
    ? { buffer: file.buffer, mimetype: file.mimetype || 'application/octet-stream', originalname: file.originalname || 'uploaded-file' }
    : { buffer, mimetype: 'image/png', originalname: 'nados-screen.png' }

  const result = await callExternalProviders({
    message: `User task: ${request}\nTarget window: ${session.windows.get(windowId)?.title || 'selected window'}\nPrevious approved steps: ${JSON.stringify(previous.slice(-8))}`,
    mode: 'create',
    history: [],
    instructions,
    file: providedFile,
    modelOverride: model,
    providerOverride: providerId,
  })
  if (!result?.text) throw Object.assign(new Error(result?.failures?.join(' | ') || 'لا يتوفر نموذج رؤية لتخطيط الإجراء.'), { status: 502 })
  const action = normalizeAction(parseJson(result.text), region)
  const planId = randomUUID()
  if (action.action !== 'finish') pendingPlans.set(planId, { token, action, windowId, expiresAt: Date.now() + PLAN_TTL })
  return {
    planId: action.action === 'finish' ? null : planId,
    action,
    provider: result.provider,
    requiresConfirmation: action.action !== 'finish',
    screenshot: `data:image/png;base64,${buffer.toString('base64')}`,
  }
}

function keySequence(Key, key) {
  const single = {
    enter: [Key.Enter], tab: [Key.Tab], escape: [Key.Escape], backspace: [Key.Backspace],
    up: [Key.Up], down: [Key.Down], left: [Key.Left], right: [Key.Right],
    pageup: [Key.PageUp], pagedown: [Key.PageDown], home: [Key.Home], end: [Key.End],
  }
  if (single[key]) return single[key]
  const letter = key.at(-1)?.toUpperCase()
  return [Key.LeftControl, Key[letter]]
}

export async function executeComputerStep({ token, planId }) {
  const session = requireSession(token)
  const plan = pendingPlans.get(String(planId || ''))
  if (!plan || plan.token !== token || plan.expiresAt <= Date.now()) throw Object.assign(new Error('انتهت صلاحية الإجراء. اطلب تحليلاً جديداً.'), { status: 409 })
  pendingPlans.delete(planId)
  const target = session.windows.get(plan.windowId)
  if (!target || isBlockedWindowTitle(target.title)) throw Object.assign(new Error('النافذة لم تعد متاحة للتحكم.'), { status: 404 })
  await focusTarget(target)
  const region = await target.window.getRegion()
  const { mouse, keyboard, Point, Button, Key, sleep } = await getNut()
  const action = plan.action
  await sleep(180)
  if (action.action === 'click' || action.action === 'double_click') {
    await mouse.setPosition(new Point(region.left + action.x, region.top + action.y))
    if (action.action === 'double_click') await mouse.doubleClick(Button.LEFT)
    else await mouse.click(Button.LEFT)
  } else if (action.action === 'type') {
    await keyboard.type(action.text)
  } else if (action.action === 'key') {
    const keys = keySequence(Key, action.key)
    await keyboard.pressKey(...keys)
    await keyboard.releaseKey(...keys.reverse())
  } else if (action.action === 'scroll') {
    if (action.direction === 'up') await mouse.scrollUp(action.amount)
    else await mouse.scrollDown(action.amount)
  } else if (action.action === 'navigate_url') {
    await keyboard.pressKey(Key.LeftControl, Key.L)
    await keyboard.releaseKey(Key.L, Key.LeftControl)
    await sleep(180)
    await keyboard.type(action.url)
    await sleep(120)
    await keyboard.pressKey(Key.Enter)
    await keyboard.releaseKey(Key.Enter)
    await sleep(700)
  }
  return { ok: true, action: action.action, description: action.description }
}
