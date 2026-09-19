import type { ChatReply, ModelId, SearchMode } from './api'

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  reply?: ChatReply
}

export interface ChatSession {
  id: string
  title: string
  messages: SessionMessage[]
  mode: SearchMode
  model: ModelId
  createdAt: string
  updatedAt: string
  pinned?: boolean
}

const DATABASE_NAME = 'nados-ai-memory'
const STORE_NAME = 'sessions'
const SESSIONS_KEY = 'all-v2'
const LEGACY_SESSION_KEY = 'main'
const CHANNEL_NAME = 'nados-sessions-v2'

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function readValue<T>(database: IDBDatabase, key: string) {
  return new Promise<T | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error)
  })
}

function writeValue(database: IDBDatabase, key: string, value: unknown) {
  return new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(value, key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

const CORRUPTED_NOTE = '(رسالة تالفة من إصدار سابق أُزيلت بعد إصلاح خطأ العرض.)'

function safeContent(content: unknown): string {
  if (typeof content === 'string') return content
  return CORRUPTED_NOTE
}

function sanitizeSession(session: ChatSession): ChatSession {
  if (!session.messages?.some((message) => typeof message.content !== 'string' || message.content.includes('[object Object]'))) return session
  return {
    ...session,
    messages: session.messages.map((message) => {
      if (typeof message.content !== 'string') {
        return { ...message, content: CORRUPTED_NOTE }
      }
      if (message.content.includes('[object Object]')) {
        const cleaned = message.content.replace(/\[object Object\]/g, '').replace(/^[,\s]+|[,\s]+$/g, '').trim()
        return { ...message, content: cleaned || CORRUPTED_NOTE }
      }
      return message
    }),
  }
}

function titleFromMessages(messages: SessionMessage[]) {
  return messages.find((message) => message.role === 'user')?.content.trim().slice(0, 80) || 'محادثة جديدة'
}

function normalizeSession(session: ChatSession): ChatSession {
  return { ...session, model: session.model || 'nados-v1' }
}

export function createEmptySession(): ChatSession {
  const now = new Date().toISOString()
  return {
    id: `session-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    title: 'محادثة جديدة',
    messages: [],
    mode: 'web',
    model: 'nados-v1',
    createdAt: now,
    updatedAt: now,
  }
}

export async function loadSessions(): Promise<ChatSession[]> {
  const database = await openDatabase()
  try {
    const stored = await readValue<ChatSession[]>(database, SESSIONS_KEY)
    if (Array.isArray(stored) && stored.length) {
      const normalized = stored.map(normalizeSession).map(sanitizeSession).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      const hadCorruption = stored.some((session) => session.messages?.some((message) => typeof message.content !== 'string' || message.content.includes('[object Object]')))
      if (hadCorruption) await writeValue(database, SESSIONS_KEY, normalized)
      return normalized
    }

    const legacy = await readValue<SessionMessage[]>(database, LEGACY_SESSION_KEY)
    if (!Array.isArray(legacy) || !legacy.length) return []
    const now = new Date().toISOString()
    const migrated: ChatSession = {
      id: 'nados-main-session',
      title: titleFromMessages(legacy),
      messages: legacy,
      mode: 'web',
      model: 'nados-v1',
      createdAt: now,
      updatedAt: now,
    }
    await writeValue(database, SESSIONS_KEY, [migrated])
    return [migrated]
  } finally {
    database.close()
  }
}

export async function saveSession(session: ChatSession) {
  const database = await openDatabase()
  try {
    const current = await readValue<ChatSession[]>(database, SESSIONS_KEY) || []
    const nextSession = { ...session, title: titleFromMessages(session.messages), updatedAt: new Date().toISOString() }
    const next = [nextSession, ...current.filter((item) => item.id !== session.id)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 50)
    await writeValue(database, SESSIONS_KEY, next)
    return next
  } finally {
    database.close()
  }
}

export async function deleteSession(id: string) {
  const database = await openDatabase()
  try {
    const current = await readValue<ChatSession[]>(database, SESSIONS_KEY) || []
    const next = current.filter((item) => item.id !== id)
    await writeValue(database, SESSIONS_KEY, next)
    return next
  } finally {
    database.close()
  }
}

export function broadcastSessions(sessionId: string) {
  if (!('BroadcastChannel' in globalThis)) return
  const channel = new BroadcastChannel(CHANNEL_NAME)
  channel.postMessage({ type: 'changed', sessionId })
  channel.close()
}

export function watchSessions(onChange: (sessionId: string) => void) {
  if (!('BroadcastChannel' in globalThis)) return () => {}
  const channel = new BroadcastChannel(CHANNEL_NAME)
  channel.onmessage = (event) => {
    if (event.data?.type === 'changed' && typeof event.data.sessionId === 'string') onChange(event.data.sessionId)
  }
  return () => channel.close()
}
