import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  Archive,
  BookOpen,
  Bookmark,
  Boxes,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronUp,
  CircleUserRound,
  Clipboard,
  Compass,
  Download,
  EyeOff,
  Image as ImageIcon,
  Library,
  Menu,
  MessageSquareText,
  Mic,
  MonitorCog,
  Moon,
  MoreHorizontal,
  Pause,
  Pin,
  Plus,
  PlugZap,
  RefreshCw,
  SearchCheck,
  Settings2,
  Share2,
  Sparkles,
  Square,
  Sun,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Volume2,
  X,
} from 'lucide-react'
import { askNados, formatTokens, getNadosCapabilities, getNadosModels, synthesizeNadosSpeech, type ApiCapabilities, type ChatReply, type ConversationMessage, type ModelId, type NadosModelOption, type SearchMode } from './api'
import { Composer, modeData } from './Composer'
import { ComputerView, ConnectorsView, DiscoverView, LibraryView, SettingsPanel, SpacesView, StudioView, VoiceDialog } from './FeatureViews'
import { TrainingCenter } from './TrainingCenter'
import { initialHistory, initialSpaces, type AppSettings, type HistoryItem, type Space, type View } from './types'
import { countWords, MAX_CONVERSATION_CHARS, MAX_CONVERSATION_WORDS, MAX_MESSAGE_CHARS, MAX_MESSAGE_WORDS } from './limits'
import { RichAnswer } from './RichAnswer'
import { broadcastSessions, createEmptySession, deleteSession, loadSessions, saveSession, watchSessions, type ChatSession, type SessionMessage } from './sessionMemory'

const suggestions = [
  { icon: Compass, text: 'ما أهم أخبار التقنية اليوم؟', color: 'mint' },
  { icon: BookOpen, text: 'اشرح لي فكرة معقدة ببساطة', color: 'amber' },
  { icon: Sparkles, text: 'ساعدني في ابتكار مشروع جديد', color: 'coral' },
]

const automaticModel: NadosModelOption = {
  id: 'nados-v1',
  label: 'Nados v1.0',
  providerId: 'auto',
  provider: 'توجيه تلقائي',
  model: 'أفضل نموذج متاح',
  webSearch: true,
  vision: true,
  files: true,
}

function loadLocal<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

function loadSettings(): AppSettings {
  const loaded = loadLocal<AppSettings>('nados-settings', { dark: true, incognito: false, memory: true, citations: true, language: 'ar' })
  if (localStorage.getItem('nados-memory-enabled-v1') === null) {
    localStorage.setItem('nados-memory-enabled-v1', 'true')
  }
  return { ...loaded, memory: true }
}

function BrandMark({ small = false }: { small?: boolean }) {
  return <div className={`brand-mark ${small ? 'brand-mark--small' : ''}`} aria-hidden="true"><span>N</span><i /></div>
}

const LONG_MESSAGE_CHARS = 600
const LONG_MESSAGE_LINES = 8

function UserQuestion({ message, onEdit, onDelete, onCopy, disabled = false }: { message: SessionMessage; onEdit: (id: string, content: string) => void; onDelete: (id: string) => void; onCopy: (content: string) => void; disabled?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const isLong = message.content.length > LONG_MESSAGE_CHARS || message.content.split('\n').length > LONG_MESSAGE_LINES

  return (
    <div className="user-question">
      <div className="avatar">ن</div>
      <div className="user-question-content">
        <span>أنت</span>
        {editing ? (
          <div className="user-message user-message--editing">
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={Math.min(10, Math.max(2, draft.split('\n').length))} autoFocus dir="auto" />
            <div className="user-message-edit-actions">
              <button type="button" className="edit-save" disabled={disabled || !draft.trim()} onClick={() => { setEditing(false); onEdit(message.id, draft.trim()) }}><Check size={14} /> حفظ وإعادة الإرسال</button>
              <button type="button" className="edit-cancel" onClick={() => { setEditing(false); setDraft(message.content) }}><X size={14} /> إلغاء</button>
            </div>
          </div>
        ) : (
          <div className={`user-message ${isLong && !expanded ? 'user-message--collapsed' : ''}`}>
            <p dir="auto">{typeof message.content === 'string' ? message.content : ''}</p>
          </div>
        )}
        {isLong && !editing && (
          <button
            className="user-message-toggle"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            {expanded ? 'تصغير الرسالة' : 'توسيع الرسالة'}
          </button>
        )}
        {!editing && (
          <div className="user-message-actions">
            <button type="button" onClick={() => onCopy(message.content)} aria-label="نسخ" title="نسخ"><Clipboard size={14} /></button>
            <button type="button" disabled={disabled} onClick={() => { setDraft(message.content); setEditing(true) }} aria-label="تعديل" title="تعديل وإعادة الإرسال"><Settings2 size={14} /></button>
            <button type="button" disabled={disabled} onClick={() => onDelete(message.id)} aria-label="حذف" title="حذف"><Trash2 size={14} /></button>
          </div>
        )}
      </div>
    </div>
  )
}

function AppV2() {
  const [view, setView] = useState<View>('home')
  const [query, setQuery] = useState('')
  const [activeQuestion, setActiveQuestion] = useState('')
  const [reply, setReply] = useState<ChatReply | null>(null)
  const [messages, setMessages] = useState<SessionMessage[]>([])
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState('')
  const [sessionReady, setSessionReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mode, setMode] = useState<SearchMode>('web')
  const [model, setModel] = useState<ModelId>('nados-v1')
  const [models, setModels] = useState<NadosModelOption[]>([automaticModel])
  const [modeOpen, setModeOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [capabilities, setCapabilities] = useState<ApiCapabilities>({
    ok: false,
    configured: false,
    provider: 'offline',
    providers: [],
    model: 'Nados v1.0',
    features: { chat: false, webSearch: false, files: false, vision: false, video: false, images: false, transcription: false, speech: false, computer: false },
  })
  const [toast, setToast] = useState('')
  const [listening, setListening] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [reasoningOpen, setReasoningOpen] = useState(true)
  const [sessionSearch, setSessionSearch] = useState('')
  const [chatSearchOpen, setChatSearchOpen] = useState(false)
  const [chatQuery, setChatQuery] = useState('')
  const [moreMenuFor, setMoreMenuFor] = useState<string | null>(null)
  const [enableSearch, setEnableSearch] = useState(false)
  const [enableThinking, setEnableThinking] = useState(false)
  const [streamMeta, setStreamMeta] = useState<{ provider: string; model: string } | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>(() => loadLocal('nados-history', initialHistory))
  const [spaces, setSpaces] = useState<Space[]>(() => loadLocal('nados-spaces', initialSpaces))
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const voiceReply = useRef(false)
  const activeSessionIdRef = useRef('')
  const remoteSessionUpdate = useRef(false)
  const audioPlaybackRef = useRef<HTMLAudioElement | null>(null)
  const recognitionRef = useRef<Recognition | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const stopGeneration = () => {
    abortControllerRef.current?.abort()
  }

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem('nados-draft')
      if (saved && !query) setQuery(saved)
    } catch {}
  }, [])
  useEffect(() => {
    if (!query) return
    const timeout = window.setTimeout(() => {
      try { window.sessionStorage.setItem('nados-draft', query) } catch {}
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [query])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
    if (activeSessionId) localStorage.setItem('nados-active-session', activeSessionId)
  }, [activeSessionId])

  useEffect(() => {
    document.documentElement.dataset.theme = settings.dark ? 'dark' : 'light'
    localStorage.setItem('nados-settings', JSON.stringify({ ...settings, dark: settings.dark }))
  }, [settings])
  useEffect(() => localStorage.setItem('nados-history', JSON.stringify(history)), [history])
  useEffect(() => localStorage.setItem('nados-spaces', JSON.stringify(spaces)), [spaces])
  useEffect(() => {
    let active = true
    const refreshConnection = () => Promise.all([getNadosCapabilities(), getNadosModels()]).then(([nextCapabilities, nextModels]) => {
      if (!active) return
      setCapabilities(nextCapabilities)
      const availableModels = nextModels.length ? nextModels : [automaticModel]
      setModels(availableModels)
      setModel((current) => availableModels.some((item) => item.id === current) ? current : 'nados-v1')
    })
    void refreshConnection()
    const interval = window.setInterval(refreshConnection, 10_000)
    window.addEventListener('online', refreshConnection)
    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('online', refreshConnection)
    }
  }, [])
  useEffect(() => {
    let active = true
    loadSessions().then(async (stored) => {
      if (!active) return
      let available = stored
      if (!available.length) {
        const empty = createEmptySession()
        available = await saveSession(empty)
      }
      const preferredId = localStorage.getItem('nados-active-session')
      const selected = available.find((session) => session.id === preferredId) || available[0]
      setSessions(available)
      setActiveSessionId(selected.id)
      setMessages(selected.messages)
      setMode(selected.mode)
      setModel(selected.model || 'nados-v1')
      setActiveQuestion([...selected.messages].reverse().find((message) => message.role === 'user')?.content || '')
      if (selected.messages.length) setView('chat')
    }).catch(() => setToast('تعذّر تحميل جلساتك')).finally(() => { if (active) setSessionReady(true) })
    return () => { active = false }
  }, [])
  useEffect(() => watchSessions(async (changedId) => {
    const stored = await loadSessions().catch(() => [])
    if (!stored.length) return
    setSessions(stored)
    if (changedId !== activeSessionIdRef.current) return
    const selected = stored.find((session) => session.id === changedId) || stored[0]
    remoteSessionUpdate.current = true
    setActiveSessionId(selected.id)
    setMessages(selected.messages)
    setMode(selected.mode)
    setModel(selected.model || 'nados-v1')
    if (selected.messages.length) setView('chat')
  }), [])
  useEffect(() => {
    if (!sessionReady || !activeSessionId) return
    if (remoteSessionUpdate.current) {
      remoteSessionUpdate.current = false
      return
    }
    const current = sessions.find((session) => session.id === activeSessionId)
    const now = new Date().toISOString()
    const nextSession: ChatSession = {
      id: activeSessionId,
      title: messages.find((message) => message.role === 'user')?.content.slice(0, 80) || 'محادثة جديدة',
      messages,
      mode,
      model,
      createdAt: current?.createdAt || now,
      updatedAt: now,
    }
    setSessions((items) => [nextSession, ...items.filter((item) => item.id !== activeSessionId)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
    if (!settings.memory || settings.incognito) return
    void saveSession(nextSession).then((next) => {
      setSessions(next)
      broadcastSessions(activeSessionId)
    }).catch(() => setToast('تعذّر حفظ ذاكرة الجلسة'))
  }, [messages, mode, model, activeSessionId, sessionReady, settings.incognito, settings.memory])
  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 2200)
    return () => window.clearTimeout(timeout)
  }, [toast])

  useEffect(() => {
    if (view !== 'chat') {
      setShowScrollButton(false)
      return
    }

    const updateScrollState = () => {
      const distanceFromBottom = document.documentElement.scrollHeight - window.innerHeight - window.scrollY
      setShowScrollButton(distanceFromBottom > 180)
    }

    updateScrollState()
    window.addEventListener('scroll', updateScrollState, { passive: true })
    window.addEventListener('resize', updateScrollState)

    return () => {
      window.removeEventListener('scroll', updateScrollState)
      window.removeEventListener('resize', updateScrollState)
    }
  }, [view, messages.length, loading])

  const isNearBottom = useRef(true)
  useEffect(() => {
    const trackPosition = () => {
      isNearBottom.current = document.documentElement.scrollHeight - window.innerHeight - window.scrollY < 240
    }
    window.addEventListener('scroll', trackPosition, { passive: true })
    return () => window.removeEventListener('scroll', trackPosition)
  }, [])

  useEffect(() => {
    if (view !== 'chat' || !messages.length) return
    if (loading && !isNearBottom.current) return
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: loading ? 'auto' : 'smooth' })
  }, [messages.length, loading, view, reply])

  const stopSpeechPlayback = () => {
    if (audioPlaybackRef.current) {
      audioPlaybackRef.current.pause()
      audioPlaybackRef.current.currentTime = 0
      audioPlaybackRef.current.src = ''
      audioPlaybackRef.current = null
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setIsSpeaking(false)
  }

  const playSpeechText = async (text: string) => {
    if (isSpeaking) {
      stopSpeechPlayback()
      return
    }

    if (capabilities.features.speech) {
      try {
        setToast('جارٍ تجهيز الصوت...')
        const blob = await synthesizeNadosSpeech(text)
        if (blob) {
          const url = URL.createObjectURL(blob)
          const audio = new Audio(url)
          audioPlaybackRef.current = audio
          audio.onended = () => {
            URL.revokeObjectURL(url)
            audioPlaybackRef.current = null
            setIsSpeaking(false)
          }
          audio.onerror = () => {
            URL.revokeObjectURL(url)
            audioPlaybackRef.current = null
            setIsSpeaking(false)
            setToast('تعذّر تشغيل الصوت')
          }
          setIsSpeaking(true)
          await audio.play()
          setToast('بدأت قراءة الإجابة')
          return
        }
      } catch {
        setToast('تعذّر تجهيز الصوت، سأستخدم وضع المتصفح بدلاً من ذلك')
      }
    }

    if ('speechSynthesis' in window) {
      const speech = new SpeechSynthesisUtterance(text)
      speech.lang = 'ar-SA'
      speech.onstart = () => {
        setIsSpeaking(true)
        setToast('بدأت القراءة بصوت المتصفح')
      }
      speech.onend = () => setIsSpeaking(false)
      speech.onerror = () => {
        setIsSpeaking(false)
        setToast('تعذّر تشغيل الصوت')
      }
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(speech)
      return
    }

    setToast('القراءة الصوتية غير مدعومة في هذا المتصفح')
  }

  const openCurrentSession = () => {
    setView(messages.length ? 'chat' : 'home')
    setQuery('')
    setSelectedFiles([])
    setSidebarOpen(false)
    window.setTimeout(() => textarea.current?.focus(), 50)
  }

  const openStoredSession = (session: ChatSession) => {
    if (loading || session.id === activeSessionId) {
      openCurrentSession()
      return
    }
    setActiveSessionId(session.id)
    setMessages(session.messages)
    setMode(session.mode)
    setModel(session.model || 'nados-v1')
    setActiveQuestion([...session.messages].reverse().find((message) => message.role === 'user')?.content || '')
    setReply(null)
    setFeedback(null)
    setView(session.messages.length ? 'chat' : 'home')
    setSidebarOpen(false)
  }

  const createNewSession = async () => {
    if (loading) return
    const session = createEmptySession()
    setSessions(await saveSession(session))
    setActiveSessionId(session.id)
    setMessages([])
    setMode('web')
    setModel('nados-v1')
    setActiveQuestion('')
    setReply(null)
    setFeedback(null)
    setQuery('')
    setSelectedFiles([])
    setView('home')
    setSidebarOpen(false)
    broadcastSessions(session.id)
    window.setTimeout(() => textarea.current?.focus(), 50)
  }

  const removeSession = async (session: ChatSession) => {
    if (!window.confirm(`حذف جلسة «${session.title}»؟ لا يمكن التراجع عن هذا الإجراء.`)) return
    let next = await deleteSession(session.id)
    if (!next.length) next = await saveSession(createEmptySession())
    setSessions(next)
    if (session.id === activeSessionId) openStoredSession(next[0])
    broadcastSessions(session.id)
    setToast('تم حذف الجلسة')
  }

  const renameSession = async (session: ChatSession) => {
    const next = window.prompt('اسم الجلسة الجديد:', session.title)
    const title = next?.trim()
    if (!title || title === session.title) return
    const renamed: ChatSession = { ...session, title }
    setSessions((items) => items.map((item) => item.id === session.id ? renamed : item))
    if (!settings.incognito) {
      try { await saveSession(renamed); broadcastSessions(session.id) } catch { setToast('تعذّر حفظ الاسم') }
    }
    setToast('تمت إعادة التسمية')
  }

  const togglePin = async (session: ChatSession) => {
    const next = { ...session, pinned: !session.pinned }
    setSessions((items) => [next, ...items.filter((item) => item.id !== session.id)].sort(
      (a, b) => (Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))) || b.updatedAt.localeCompare(a.updatedAt),
    ))
    if (!settings.incognito) {
      try { await saveSession(next); broadcastSessions(session.id) } catch { setToast('تعذّر حفظ التثبيت') }
    }
    setToast(next.pinned ? 'تم تثبيت الجلسة' : 'أُزيل تثبيت الجلسة')
  }

  const groupSessions = (list: ChatSession[]) => {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const startOfYesterday = startOfToday - 86_400_000
    const groups: Array<{ label: string; items: ChatSession[] }> = []
    const add = (label: string, items: ChatSession[]) => { if (items.length) groups.push({ label, items }) }
    add('مثبتة', list.filter((item) => item.pinned))
    add('اليوم', list.filter((item) => !item.pinned && new Date(item.updatedAt).getTime() >= startOfToday))
    add('أمس', list.filter((item) => !item.pinned && new Date(item.updatedAt).getTime() >= startOfYesterday && new Date(item.updatedAt).getTime() < startOfToday))
    add('سابقاً', list.filter((item) => !item.pinned && new Date(item.updatedAt).getTime() < startOfYesterday))
    return groups
  }

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        void createNewSession()
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [loading])

  const navigate = (next: View) => {
    setView(next)
    setSidebarOpen(false)
    setModeOpen(false)
    setModelOpen(false)
  }

  const runCompletion = async (question: string, previousMessages: SessionMessage[], attachments: File[] | File | null) => {
    setLoading(true)
    setReply(null)
    setStreamMeta(null)
    setReasoningOpen(true)
    const memoryHistory: ConversationMessage[] = settings.memory
      ? previousMessages.map((message) => ({ role: message.role, content: message.content }))
      : []
    const controller = new AbortController()
    abortControllerRef.current = controller
    let result: ChatReply
    try {
      result = await askNados(question, mode, model, attachments, (text) => {
        setReply({ answer: [text], bullets: [], sources: [] })
      }, memoryHistory, controller.signal, (provider, modelLabel) => {
        setStreamMeta({ provider, model: modelLabel })
      }, { enableThinking, systemPrompt: settings.systemPrompt, temperature: settings.temperature ?? 0.7 })
    } finally {
      abortControllerRef.current = null
    }
    const assistantContent = [...result.answer, ...result.bullets].join('\n\n')
    if (assistantContent.trim()) {
      setMessages((current) => [...current, { id: `m${Date.now()}-a`, role: 'assistant', content: assistantContent, reply: result }])
    }
    setReply(null)
    setLoading(false)
    setStreamMeta(null)
    if (result.stopped) setToast('تم إيقاف التوليد — حُفظ النص الجزئي')
    if (!result.stopped && voiceReply.current) {
      voiceReply.current = false
      void playSpeechText([...result.answer, ...result.bullets].join(' '))
    }
    if (!settings.incognito) {
      const item: HistoryItem = { id: activeSessionId, title: previousMessages.find((message) => message.role === 'user')?.content || question, mode, model, createdAt: 'الآن', saved: false }
      setHistory((current) => previousMessages.length
        ? current.map((entry) => entry.id === activeSessionId ? { ...entry, createdAt: 'الآن' } : entry)
        : [item, ...current.filter((entry) => entry.id !== item.id)].slice(0, 30))
    }
  }

  const submit = async (preset?: string) => {
    const question = (preset ?? query).trim()
    if (!question || loading) return
    if (question.length > MAX_MESSAGE_CHARS || countWords(question) > MAX_MESSAGE_WORDS) {
      setToast(`الحد الأقصى للرسالة الواحدة ${MAX_MESSAGE_CHARS.toLocaleString()} حرف و${MAX_MESSAGE_WORDS.toLocaleString()} كلمة`)
      return
    }
    const previousMessages = messages
    const conversationText = [...previousMessages.map((message) => message.content), question].join('\n')
    if (conversationText.length > MAX_CONVERSATION_CHARS || countWords(conversationText) > MAX_CONVERSATION_WORDS) {
      setToast(`تجاوزت سعة ذاكرة المحادثة الحالية`)
      return
    }
    const userMessage: SessionMessage = { id: `m${Date.now()}-u`, role: 'user', content: question }
    setMessages([...previousMessages, userMessage])
    setModeOpen(false)
    setModelOpen(false)
    setQuery('')
    setActiveQuestion(question)
    setFeedback(null)
    setView('chat')
    setSidebarOpen(false)
    const attachments = selectedFiles
    setSelectedFiles([])
    await runCompletion(question, previousMessages, attachments)
  }

  const regenerate = async (assistantId: string) => {
    if (loading) return
    const index = messages.findIndex((message) => message.id === assistantId)
    if (index < 1) return
    const previous = messages.slice(0, index)
    const lastUser = [...previous].reverse().find((message) => message.role === 'user')
    if (!lastUser) return
    setMessages(previous)
    setFeedback(null)
    setActiveQuestion(lastUser.content)
    await runCompletion(lastUser.content, previous.slice(0, -1), null)
  }

  const editUserMessage = async (id: string, content: string) => {
    if (loading) return
    const index = messages.findIndex((message) => message.id === id)
    if (index < 0 || !content.trim()) return
    const kept = messages.slice(0, index)
    setMessages([...kept, { ...messages[index], content }])
    setActiveQuestion(content)
    await runCompletion(content, kept, null)
  }

  const copyUserMessage = async (content: string) => {
    await navigator.clipboard.writeText(content)
    setToast('تم نسخ الرسالة')
  }

  const deleteMessage = (id: string) => {
    const index = messages.findIndex((message) => message.id === id)
    if (index < 0 || loading) return
    const next = [...messages]
    if (next[index].role === 'user' && next[index + 1]?.role === 'assistant') next.splice(index, 2)
    else next.splice(index, 1)
    setMessages(next)
    setToast('تم حذف الرسالة')
  }

  const jumpToMessage = (index: number) => {
    const element = document.getElementById(`msg-${index}`)
    if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const jumpToChatMatch = (direction: 'next' | 'prev') => {
    if (!chatQuery.trim()) return
    const needle = chatQuery.trim().toLowerCase()
    const matching = messages.map((message, index) => ({ index, hit: message.content.toLowerCase().includes(needle) })).filter((item) => item.hit)
    if (!matching.length) { setToast('لا توجد نتائج مطابقة'); return }
    const visible = document.querySelector('.conversation .answer-row.is-search-hit, .conversation .user-question.is-search-hit')
    let current = visible ? Number((visible as HTMLElement).dataset.index) : -1
    const nextHit = direction === 'next'
      ? matching.find((item) => item.index > current) || matching[0]
      : [...matching].reverse().find((item) => item.index < current) || matching[matching.length - 1]
    jumpToMessage(nextHit.index)
  }

  const startDictation = () => {
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
      setListening(false)
      return
    }

    const typedWindow = window as typeof window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
    const Speech = typedWindow.SpeechRecognition || typedWindow.webkitSpeechRecognition
    if (!Speech) { setToast('الإملاء الصوتي غير مدعوم في هذا المتصفح'); return }

    const recognition = new Speech()
    recognition.lang = 'ar-SA'
    recognition.interimResults = false
    recognition.onstart = () => setListening(true)
    recognition.onend = () => {
      recognitionRef.current = null
      setListening(false)
    }
    recognition.onerror = () => {
      recognitionRef.current = null
      setListening(false)
      setToast('تعذّر تشغيل الميكروفون')
    }
    recognition.onresult = (event) => setQuery(event.results[0][0].transcript)
    recognitionRef.current = recognition
    recognition.start()
  }

  const copyAnswer = async (target: ChatReply) => {
    await navigator.clipboard.writeText([...target.answer, ...target.bullets].join('\n'))
    setToast('تم نسخ الإجابة')
  }

  const speakAnswer = async (target: ChatReply) => {
    await playSpeechText([...target.answer, ...target.bullets].join(' '))
  }

  const shareConversation = async () => {
    const text = messages.length ? messages.map((message) => `${message.role === 'user' ? 'أنت' : 'Nados AI'}:\n${message.content}`).join('\n\n') : 'Nados AI'
    try {
      if (navigator.share) await navigator.share({ title: activeQuestion || 'Nados AI', text })
      else { await navigator.clipboard.writeText(text); setToast('تم نسخ نص المشاركة') }
    } catch { setToast('تم إلغاء المشاركة') }
  }

  const exportConversation = () => {
    if (!messages.length) return
    const markdown = `# ${messages.find((message) => message.role === 'user')?.content || 'محادثة Nados'}\n\n${messages.map((message) => `## ${message.role === 'user' ? 'أنت' : 'Nados AI'}\n\n${message.content}`).join('\n\n')}`
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'nados-conversation.md'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const saveConversation = () => {
    setHistory((current) => current.map((item) => item.id === activeSessionId ? { ...item, saved: true } : item))
    setToast('تم الحفظ في المكتبة')
  }

  const updateSettings = (next: Partial<AppSettings>) => setSettings((current) => ({ ...current, ...next }))
  const selectedModel = models.find((item) => item.id === model) || automaticModel
  const composerProps = { query, setQuery, onSubmit: () => submit(), mode, setMode, model, models, setModel, modelOpen, setModelOpen, modeOpen, setModeOpen, fileInput, cameraInput, selectedFiles, setSelectedFiles, textarea, startVoice: startDictation, listening, loading, onStop: stopGeneration, enableSearch: enableSearch || mode === 'web', enableThinking, setEnableSearch: (value: boolean) => { setEnableSearch(value); setMode(value ? 'web' : 'create') }, setEnableThinking }
  const viewTitles: Partial<Record<View, string>> = { chat: 'محادثة', discover: 'استكشف', library: 'المكتبة', spaces: 'المساحات', studio: 'إنشاء الصور', computer: 'التحكم بالكمبيوتر', connectors: 'التطبيقات المتصلة', training: 'مركز التدريب' }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''} ${sidebarCollapsed ? 'sidebar--collapsed' : ''}`}>
        {window.innerWidth >= 900 && <button className="sidebar-collapse" onClick={() => setSidebarCollapsed((value) => !value)} aria-label={sidebarCollapsed ? 'توسيع القائمة' : 'طي القائمة'} title={sidebarCollapsed ? 'توسيع' : 'طي'}>{sidebarCollapsed ? <ChevronDown size={15} style={{ transform: 'rotate(90deg)' }} /> : <ChevronDown size={15} style={{ transform: 'rotate(-90deg)' }} />}</button>}
        <div className="sidebar-top"><button className="sidebar-brand" onClick={openCurrentSession} aria-label="الجلسة الحالية"><BrandMark small /><strong>Nados <span>AI</span></strong></button><button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="إغلاق القائمة" title="إغلاق"><X size={19} /></button></div>
        <button className="new-chat" onClick={() => void createNewSession()} disabled={loading}><Plus size={18} /><span>محادثة جديدة</span><kbd>Ctrl K</kbd></button>
        <nav className="main-nav" aria-label="التنقل الرئيسي">
          <button className={view === 'home' || view === 'chat' ? 'active' : ''} onClick={openCurrentSession}><MessageSquareText size={18} /><span>الرئيسية</span></button>
          <button className={view === 'discover' ? 'active' : ''} onClick={() => navigate('discover')}><Compass size={18} /><span>استكشف</span></button>
          <button className={view === 'library' ? 'active' : ''} onClick={() => navigate('library')}><Library size={18} /><span>المكتبة</span></button>
          <button className={view === 'spaces' ? 'active' : ''} onClick={() => navigate('spaces')}><Boxes size={18} /><span>المساحات</span></button>
          <button className={view === 'studio' ? 'active' : ''} onClick={() => navigate('studio')}><ImageIcon size={18} /><span>إنشاء الصور</span></button>
          <button className={view === 'computer' ? 'active' : ''} onClick={() => navigate('computer')}><MonitorCog size={18} /><span>الكمبيوتر</span></button>
          <button className={view === 'connectors' ? 'active' : ''} onClick={() => navigate('connectors')}><PlugZap size={18} /><span>التطبيقات المتصلة</span></button>
          {['localhost', '127.0.0.1', '::1'].includes(window.location.hostname) && <button className={view === 'training' ? 'active' : ''} onClick={() => navigate('training')}><BrainCircuit size={18} /><span>مركز التدريب</span></button>}
        </nav>
        <div className="recent"><div className="section-label"><span>الجلسات</span><small>{sessions.length}</small></div>
          {sessions.length > 3 && (
            <div className="session-search"><SearchCheck size={14} /><input value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)} placeholder="ابحث في الجلسات..." aria-label="بحث في الجلسات" /></div>
          )}
          <div className="session-list">{groupSessions(sessions.filter((session) => {
            if (!sessionSearch.trim()) return true
            const needle = sessionSearch.trim().toLowerCase()
            return session.title.toLowerCase().includes(needle) || session.messages.some((message) => message.content.toLowerCase().includes(needle))
          })).map(({ label, items }) => (
            <div className="session-group" key={label}>
              <div className="session-group-label">{label}</div>
              {items.map((session) => <div className={session.id === activeSessionId ? 'active' : ''} key={session.id}><button onClick={() => openStoredSession(session)} title={session.title}><MessageSquareText size={15} /><span>{session.title}</span></button><button className={`session-pin ${session.pinned ? 'pinned' : ''}`} onClick={() => void togglePin(session)} aria-label={session.pinned ? 'إلغاء التثبيت' : 'تثبيت'} title={session.pinned ? 'إلغاء التثبيت' : 'تثبيت'}><Pin size={14} /></button><button className="session-rename" onClick={() => void renameSession(session)} aria-label={`إعادة تسمية ${session.title}`} title="إعادة التسمية"><Settings2 size={14} /></button><button className="session-delete" onClick={() => void removeSession(session)} aria-label={`حذف ${session.title}`} title="حذف الجلسة"><Trash2 size={14} /></button></div>)}
            </div>
          ))}</div></div>
        <div className="sidebar-footer">
          <button className={`plan-row ${settings.incognito ? 'incognito' : capabilities.configured ? 'online' : 'offline'}`} onClick={() => updateSettings({ incognito: !settings.incognito })}>{settings.incognito ? <EyeOff size={17} /> : <span className="status-dot" />}<div><strong>{settings.incognito ? 'الوضع الخفي مفعل' : capabilities.configured ? 'Nados v1.0 متصل' : capabilities.provider === 'demo' ? 'Nados v1.0 تجريبي' : 'الخادم غير متصل'}</strong><small>{settings.incognito ? 'لن تحفظ المحادثات' : capabilities.configured ? 'نموذج Nados الموحد في خدمتك' : 'تأكد من اتصال خدمة Nados'}</small></div></button>
          <button className="profile-button" onClick={() => setSettingsOpen(true)}><CircleUserRound size={21} /><span>حسابي</span><ChevronDown size={15} /></button>
          <div className="sidebar-quick-actions">
            <button className="icon-button" onClick={() => setVoiceOpen(true)} aria-label="المحادثة الصوتية" title="المحادثة الصوتية"><Mic size={18} /></button>
            <button className="icon-button" onClick={() => updateSettings({ dark: !settings.dark })} aria-label={settings.dark ? 'الوضع النهاري' : 'الوضع الليلي'} title={settings.dark ? 'الوضع النهاري' : 'الوضع الليلي'}>{settings.dark ? <Sun size={18} /> : <Moon size={18} />}</button>
            <button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="الإعدادات" title="الإعدادات"><Settings2 size={18} /></button>
          </div>
        </div>
      </aside>
      {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="إغلاق القائمة" />}

      <main className="main-content">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setSidebarOpen(true)} aria-label="فتح القائمة" title="القائمة"><Menu size={21} /></button>
          <div className="topbar-title">{viewTitles[view] && <span>{viewTitles[view]}</span>}{settings.incognito && <span className="incognito-label"><EyeOff size={14} /> خفي</span>}</div>
          <div className="topbar-actions">
            {view === 'chat' && <button className="icon-button" onClick={shareConversation} aria-label="مشاركة" title="مشاركة"><Share2 size={18} /></button>}
            {view === 'chat' && <button className="icon-button" onClick={() => setChatSearchOpen((value) => !value)} aria-label="بحث في المحادثة" title="بحث في المحادثة"><SearchCheck size={19} /></button>}
            <button className="icon-button profile-button-top" onClick={() => setSettingsOpen(true)} aria-label="الإعدادات والحساب" title="الإعدادات"><CircleUserRound size={20} /></button>
          </div>
        </header>

        {view === 'home' && (
          <section className="home-view">
            <div className="home-hero">
              <div className="home-graphic" aria-hidden="true"><span className="line line-one" /><span className="line line-two" /><span className="line line-three" /><BrandMark /></div>
              <div className="welcome"><p>Nados AI</p><h1>مرحباً، ما الذي يدور في ذهنك اليوم؟</h1></div>
              <div className="hero-badges" aria-label="ميزات Nados">
                <span className="hero-badge mint"><SearchCheck size={14} /> بحث عميق</span>
                <span className="hero-badge blue"><ImageIcon size={14} /> صورة وصوت</span>
                <span className="hero-badge coral"><Archive size={14} /> ملفات ومرفقات</span>
                <span className="hero-badge amber"><MonitorCog size={14} /> تحكم بالكمبيوتر</span>
              </div>
            </div>
            <Composer {...composerProps} />
            <div className="suggestions">{suggestions.map(({ icon: Icon, text, color }) => <button key={text} onClick={() => submit(text)}><span className={`suggestion-icon ${color}`}><Icon size={18} /></span><span>{text}</span><ArrowLeft size={17} /></button>)}</div>
          </section>
        )}

        {view === 'chat' && (
          <section className="chat-view">
            <div className="chat-header">
              <div className="chat-header-badge"><span className="chat-header-dot" /> محادثة حالية</div>
              <div className="chat-header-meta">
                <span className="meta-pill">{modeData[mode].label}</span>
                <span className="meta-pill meta-pill--soft">{selectedModel.label}</span>
                <button className="icon-button meta-pill" onClick={() => setChatSearchOpen((value) => !value)} aria-label="بحث في المحادثة" title="بحث في المحادثة"><SearchCheck size={16} /></button>
              </div>
            </div>
            {chatSearchOpen && (
              <div className="chat-search-bar">
                <SearchCheck size={16} />
                <input value={chatQuery} onChange={(event) => setChatQuery(event.target.value)} placeholder="ابحث في هذه المحادثة..." aria-label="بحث في المحادثة" autoFocus />
                <button type="button" onClick={() => jumpToChatMatch('prev')} aria-label="النتيجة السابقة" title="النتيجة السابقة"><ChevronUp size={16} /></button>
                <button type="button" onClick={() => jumpToChatMatch('next')} aria-label="النتيجة التالية" title="النتيجة التالية"><ChevronDown size={16} /></button>
                <button type="button" onClick={() => { setChatQuery(''); setChatSearchOpen(false) }} aria-label="إغلاق البحث" title="إغلاق"><X size={16} /></button>
              </div>
            )}
            <article className="conversation">
              {messages.map((message, index) => {
              const isSearchHit = chatQuery.trim() && message.content.toLowerCase().includes(chatQuery.trim().toLowerCase())
              const searchClass = isSearchHit ? ' is-search-hit' : ''
              return message.role === 'user' ? (
                <div className={`user-question-wrap${searchClass}`} key={message.id} id={`msg-${index}`} data-index={index}>
                  <UserQuestion message={message} disabled={loading} onEdit={(id, content) => void editUserMessage(id, content)} onDelete={deleteMessage} onCopy={(content) => void copyUserMessage(content)} />
                </div>
              ) : message.reply && (
                <div className={`answer-row${searchClass}`} key={message.id} id={`msg-${index}`} data-index={index}><BrandMark small /><div className="answer-content">
                  <div className="answer-heading"><strong>Nados AI</strong><span><i />{modeData[mode].label}{message.reply.usage?.total ? ` · Context: ${formatTokens(message.reply.usage.total)} / ${formatTokens(message.reply.usage.contextWindow)}` : ''}</span></div>
                  <RichAnswer answer={message.reply.answer} bullets={message.reply.bullets} />
                  {settings.citations && message.reply.sources.length > 0 && <div className="sources-block"><div className="sources-title"><strong>المصادر</strong><span>{message.reply.sources.length}</span></div><div className="source-grid">{message.reply.sources.map((source, sourceIndex) => <a key={`${source.domain}-${sourceIndex}`} href={source.url} target="_blank" rel="noreferrer"><i style={{ background: source.accent }}>{sourceIndex + 1}</i><strong>{source.title}</strong><span>{source.domain}</span></a>)}</div></div>}
                  <div className="answer-actions">
                    <button className="icon-button" onClick={() => copyAnswer(message.reply!)} aria-label="نسخ الإجابة" title="نسخ"><Clipboard size={17} /></button>
                    {index === messages.length - 1 && <button className="icon-button" onClick={() => void regenerate(message.id)} disabled={loading} aria-label="إعادة التوليد" title="إعادة التوليد"><RefreshCw size={17} /></button>}
                    {index === messages.length - 1 && <><button className={`icon-button ${feedback === 'up' ? 'selected' : ''}`} onClick={() => setFeedback('up')} aria-label="إجابة مفيدة" title="مفيدة"><ThumbsUp size={17} /></button><button className={`icon-button ${feedback === 'down' ? 'selected' : ''}`} onClick={() => setFeedback('down')} aria-label="إجابة غير مفيدة" title="غير مفيدة"><ThumbsDown size={17} /></button></>}
                    <span className="action-separator" />
                    <button className="icon-button" onClick={() => setMoreMenuFor(moreMenuFor === message.id ? null : message.id)} aria-label="المزيد" title="المزيد"><MoreHorizontal size={17} /></button>
                    {moreMenuFor === message.id && (
                      <div className="actions-more-menu" role="menu">
                        <button role="menuitem" onClick={() => { speakAnswer(message.reply!); setMoreMenuFor(null) }}><Volume2 size={15} /> قراءة الإجابة</button>
                        <button role="menuitem" onClick={() => { saveConversation(); setMoreMenuFor(null) }}><Bookmark size={15} /> حفظ في المكتبة</button>
                        <button role="menuitem" onClick={() => { exportConversation(); setMoreMenuFor(null) }}><Download size={15} /> تنزيل المحادثة</button>
                        <button role="menuitem" onClick={() => { shareConversation(); setMoreMenuFor(null) }}><Share2 size={15} /> مشاركة</button>
                      </div>
                    )}
                  </div>
                </div></div>
              );
              })}
              {loading && <div className="answer-row answer-row--streaming"><BrandMark small /><div className="answer-content">
                <div className="answer-heading"><strong>Nados AI</strong><span><i />{`الذاكرة ${settings.memory ? 'مفعلة' : 'بدون'} · ${selectedModel.label}`}</span><button type="button" className="stop-generation" onClick={stopGeneration} aria-label="إيقاف التوليد" title="إيقاف التوليد"><Square size={14} /> إيقاف</button></div>
                {reply ? <RichAnswer answer={reply.answer} bullets={reply.bullets} /> : (
                  <div className="thinking-panel">
                    <button type="button" className="thinking-panel__header" onClick={() => setReasoningOpen((value) => !value)} aria-expanded={reasoningOpen} aria-label="تبديل قسم التفكير">
                      <div className="thinking-panel__title">
                        <span className="thinking-panel__dot" />
                        <span>{loading && !reply ? 'يفكر...' : 'التفكير'}</span>
                      </div>
                      <div className="thinking-panel__status">
                        <span className="thinking-wave"><span /><span /><span /></span>
                        <span>{reasoningOpen ? 'إخفاء' : 'إظهار'}</span>
                      </div>
                    </button>
                    {reasoningOpen && (
                      <div className="thinking-panel__body">
                        <p>{mode === 'research' ? 'أراجع عدة مصادر وأقارنها قبل أن أكتب التقرير النهائي.' : 'أحلل السؤال أولاً ثم أرتب الإجابة بشكل واضح ومباشر.'}</p>
                        <ul>
                          <li>أحدد الهدف من السؤال.</li>
                          <li>أجمع المعلومات الأساسية ذات العلاقة.</li>
                          <li>أصوغ الإجابة النهائية بأسلوب عملي.</li>
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div></div>}
              {!loading && messages.length > 1 && <div className="followups"><span>تابع المحادثة</span>{['ما الخطوات العملية؟', 'قارن بين الخيارات', 'أعطني مثالاً واقعياً'].map((item) => <button key={item} onClick={() => submit(item)}>{item}<ArrowLeft size={15} /></button>)}</div>}
            </article>
            <div className="chat-composer-wrap"><Composer compact {...composerProps} /></div>
          </section>
        )}

        {view === 'discover' && <DiscoverView onAsk={submit} />}
        {view === 'training' && <TrainingCenter />}
        {view === 'library' && <LibraryView history={history} spaces={spaces} onOpen={openCurrentSession} />}
        {view === 'spaces' && <SpacesView spaces={spaces} setSpaces={setSpaces} onAsk={submit} />}
        {view === 'studio' && <StudioView connected={capabilities.features.images} />}
        {view === 'computer' && <ComputerView enabled={capabilities.features.computer} />}
        {view === 'connectors' && <ConnectorsView />}
      </main>

      {settingsOpen && <SettingsPanel settings={settings} capabilities={capabilities} onClose={() => setSettingsOpen(false)} onProvidersChanged={() => { void Promise.all([getNadosCapabilities(), getNadosModels()]).then(([nextCapabilities, nextModels]) => { setCapabilities(nextCapabilities); if (nextModels.length) setModels(nextModels) }) }} onChange={updateSettings} />}
      {voiceOpen && <VoiceDialog cloudTranscription={capabilities.features.transcription} onClose={() => setVoiceOpen(false)} onSubmit={(text) => { voiceReply.current = true; setVoiceOpen(false); submit(text) }} />}
      {view === 'chat' && (
        <button className={`scroll-to-bottom ${showScrollButton ? '' : 'hidden'}`} onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })} aria-label="الانتقال للأسفل" title="الانتقال للأسفل">
          <ArrowDown size={18} />
        </button>
      )}
      {toast && <div className="toast"><Check size={17} />{toast}</div>}
    </div>
  )
}

interface Recognition {
  lang: string
  interimResults: boolean
  onstart: () => void
  onend: () => void
  onerror: () => void
  onresult: (event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void
  start: () => void
  stop: () => void
}

export default AppV2
