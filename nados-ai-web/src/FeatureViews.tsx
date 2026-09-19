import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  ArrowLeft,
  Bell,
  BookOpen,
  Bookmark,
  Boxes,
  CalendarDays,
  Check,
  ChevronRight,
  Cloud,
  Download,
  FileBox,
  FileText,
  Globe2,
  HardDrive,
  Image as ImageIcon,
  LockKeyhole,
  LoaderCircle,
  KeyRound,
  Keyboard,
  Mail,
  MessageCircle,
  MessageSquareText,
  Mic,
  MonitorCog,
  MousePointer2,
  Power,
  Plus,
  Search,
  RefreshCw,
  Settings,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Square,
  Upload,
  Trash2,
  Users,
  Video,
  Volume2,
  WandSparkles,
  X,
} from 'lucide-react'
import { closeComputerSession, executeComputerStep, generateNadosImage, getNadosModels, getProviderManager, planComputerStep, removeManagedProvider, saveProvider, startComputerSession, testManagedProvider, transcribeNados, type ApiCapabilities, type ComputerPlan, type ComputerWindow, type ManagedProvider, type NadosModelOption, type ProviderPreset } from './api'
import type { AppSettings, HistoryItem, Space } from './types'

export function DiscoverView({ onAsk }: { onAsk: (question: string) => void }) {
  const [category, setCategory] = useState('الكل')
  const [bookmarks, setBookmarks] = useState<string[]>([])
  const topics = [
    { tag: 'تقنية', title: 'كيف تغيّر نماذج الذكاء الاصطناعي طريقة بناء البرمجيات؟', source: 'قراءة في 6 دقائق', color: 'mint' },
    { tag: 'أعمال', title: 'اتجاهات العمل الرقمي التي تستحق المتابعة هذا الأسبوع', source: '5 مصادر', color: 'coral' },
    { tag: 'علوم', title: 'لماذا أصبحت الحوسبة الكمية أقرب إلى الاستخدام العملي؟', source: 'قراءة في 8 دقائق', color: 'amber' },
    { tag: 'إبداع', title: 'أدوات بسيطة لتحويل الفكرة الأولى إلى مشروع قابل للاختبار', source: '4 مصادر', color: 'blue' },
    { tag: 'تقنية', title: 'دليل عملي لحماية بياناتك عند استخدام أدوات الذكاء الاصطناعي', source: '7 مصادر', color: 'coral' },
    { tag: 'أعمال', title: 'كيف تقيس نجاح فكرة جديدة قبل استثمار وقت طويل فيها؟', source: 'قراءة في 5 دقائق', color: 'mint' },
  ]
  const visible = category === 'الكل' ? topics : topics.filter((topic) => topic.tag === category)

  return (
    <section className="page-view discover-view">
      <div className="page-heading-row">
        <div className="page-heading"><span>مختارات يومية</span><h1>استكشف أفكاراً تستحق وقتك</h1></div>
        <button className="secondary-command"><Bell size={17} /> متابعة يومية</button>
      </div>
      <div className="segmented-control topic-filter" aria-label="تصنيف المحتوى">
        {['الكل', 'تقنية', 'أعمال', 'علوم', 'إبداع'].map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}
      </div>
      <div className="topic-grid">
        {visible.map((topic, index) => (
          <article key={topic.title} className={`topic-card ${topic.color}`}>
            <div className="topic-number">0{index + 1}</div>
            <span>{topic.tag}</span>
            <h2>{topic.title}</h2>
            <small>{topic.source}</small>
            <div className="topic-actions">
              <button onClick={() => setBookmarks((current) => current.includes(topic.title) ? current.filter((item) => item !== topic.title) : [...current, topic.title])} aria-label="حفظ" title="حفظ"><Bookmark size={17} fill={bookmarks.includes(topic.title) ? 'currentColor' : 'none'} /></button>
              <button onClick={() => onAsk(topic.title)} aria-label="افتح الموضوع" title="افتح"><ArrowLeft size={19} /></button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

export function LibraryView({ history, spaces, onOpen }: { history: HistoryItem[]; spaces: Space[]; onOpen: (question: string) => void }) {
  const [filter, setFilter] = useState('')
  const [tab, setTab] = useState<'threads' | 'saved' | 'files'>('threads')
  const threads = history.filter((item) => (tab !== 'saved' || item.saved) && item.title.includes(filter))
  const files = ['خطة المنتج.pdf', 'محاضرات الذكاء الاصطناعي.docx', 'بيانات السوق.xlsx', 'ملاحظات المقابلات.txt'].filter((item) => item.includes(filter))

  return (
    <section className="page-view library-view">
      <div className="page-heading-row">
        <div className="page-heading"><span>كل ما حفظته</span><h1>المكتبة</h1></div>
        <div className="library-stats"><strong>{history.length}</strong><span>محادثة</span><strong>{spaces.length}</strong><span>مساحة</span></div>
      </div>
      <div className="library-toolbar">
        <label className="library-search"><Search size={18} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="ابحث في المكتبة..." /></label>
        <div className="segmented-control">
          <button className={tab === 'threads' ? 'active' : ''} onClick={() => setTab('threads')}>المحادثات</button>
          <button className={tab === 'saved' ? 'active' : ''} onClick={() => setTab('saved')}>المحفوظة</button>
          <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>الملفات</button>
        </div>
      </div>
      <div className="library-list">
        {tab !== 'files' ? threads.map((item) => (
          <button key={item.id} onClick={() => onOpen(item.title)}>
            <span className="library-icon"><MessageSquareText size={18} /></span>
            <div><strong>{item.title}</strong><small>{item.createdAt} · {item.mode === 'research' ? 'بحث عميق' : 'محادثة'}</small></div>
            {item.saved && <Bookmark size={15} fill="currentColor" />}
            <ArrowLeft size={18} />
          </button>
        )) : files.map((file) => (
          <button key={file} onClick={() => onOpen(`لخّص محتوى الملف ${file}`)}>
            <span className="library-icon file"><FileText size={18} /></span>
            <div><strong>{file}</strong><small>ملف مرفوع · جاهز للبحث</small></div>
            <ArrowLeft size={18} />
          </button>
        ))}
      </div>
    </section>
  )
}

export function SpacesView({ spaces, setSpaces, onAsk }: { spaces: Space[]; setSpaces: (spaces: Space[]) => void; onAsk: (question: string) => void }) {
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const selected = spaces.find((space) => space.id === selectedId)

  const createSpace = () => {
    if (!title.trim()) return
    const next: Space = { id: `s${Date.now()}`, title: title.trim(), description: description.trim() || 'مساحة جديدة للملفات والمحادثات.', emoji: title.trim()[0], files: 0, threads: 0, visibility: 'private' }
    setSpaces([next, ...spaces])
    setTitle('')
    setDescription('')
    setCreating(false)
  }

  if (selected) {
    return (
      <section className="page-view space-detail">
        <button className="back-command" onClick={() => setSelectedId(null)}><ChevronRight size={18} /> كل المساحات</button>
        <div className="space-detail-heading"><span className="space-avatar">{selected.emoji}</span><div><h1>{selected.title}</h1><p>{selected.description}</p></div><button className="secondary-command"><Users size={17} /> مشاركة</button></div>
        <div className="space-layout">
          <div className="space-main">
            <h2>محادثات المساحة</h2>
            <button className="space-ask" onClick={() => onAsk(`ابدأ بحثاً جديداً داخل مساحة ${selected.title}`)}><Plus size={18} /> اسأل داخل هذه المساحة</button>
            {['ملخص أحدث الملفات', 'أهم النقاط والقرارات', 'أسئلة تحتاج إلى متابعة'].map((item) => <button className="space-thread" key={item} onClick={() => onAsk(`${item} في ${selected.title}`)}><MessageSquareText size={18} /><span>{item}</span><ArrowLeft size={17} /></button>)}
          </div>
          <aside className="space-files">
            <div><h2>المصادر</h2><span>{selected.files} ملفات</span></div>
            <label className="upload-zone"><Upload size={22} /><strong>أضف ملفات</strong><small>PDF, DOCX, XLSX, TXT</small><input type="file" multiple hidden onChange={(event) => { const count = event.target.files?.length ?? 0; setSpaces(spaces.map((space) => space.id === selected.id ? { ...space, files: space.files + count } : space)) }} /></label>
            <h3>تعليمات المساحة</h3>
            <textarea defaultValue="اعتمد على الملفات المرفوعة أولاً، واذكر المصدر مع كل معلومة مهمة." aria-label="تعليمات المساحة" />
          </aside>
        </div>
      </section>
    )
  }

  return (
    <section className="page-view spaces-view">
      <div className="page-heading-row">
        <div className="page-heading"><span>المعرفة المشتركة</span><h1>المساحات</h1></div>
        <button className="primary-command" onClick={() => setCreating(true)}><Plus size={17} /> مساحة جديدة</button>
      </div>
      <div className="spaces-grid">
        {spaces.map((space) => (
          <button className="space-card" key={space.id} onClick={() => setSelectedId(space.id)}>
            <span className="space-avatar">{space.emoji}</span>
            <span className="space-privacy">{space.visibility === 'private' ? <LockKeyhole size={13} /> : <Users size={13} />}{space.visibility === 'private' ? 'خاصة' : 'مشتركة'}</span>
            <h2>{space.title}</h2>
            <p>{space.description}</p>
            <div><span><FileText size={14} />{space.files} ملفات</span><span><MessageSquareText size={14} />{space.threads} محادثة</span></div>
          </button>
        ))}
      </div>
      {creating && (
        <div className="modal-backdrop" role="presentation">
          <div className="form-modal" role="dialog" aria-modal="true" aria-label="إنشاء مساحة">
            <div className="modal-heading"><div><span>مساحة جديدة</span><h2>اجمع ملفاتك وبحوثك</h2></div><button className="icon-button" onClick={() => setCreating(false)} aria-label="إغلاق"><X size={19} /></button></div>
            <label>اسم المساحة<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="مثال: أبحاث المشروع" autoFocus /></label>
            <label>الوصف<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="ما الذي ستعمل عليه هنا؟" /></label>
            <div className="modal-actions"><button className="secondary-command" onClick={() => setCreating(false)}>إلغاء</button><button className="primary-command" onClick={createSpace} disabled={!title.trim()}>إنشاء المساحة</button></div>
          </div>
        </div>
      )}
    </section>
  )
}

type Ratio = 'square' | 'landscape' | 'portrait'

export function StudioView({ connected }: { connected: boolean }) {
  const [prompt, setPrompt] = useState('مدينة عربية مستقبلية هادئة عند شروق الشمس')
  const [style, setStyle] = useState('سينمائي')
  const [ratio, setRatio] = useState<Ratio>('landscape')
  const [result, setResult] = useState('')
  const [generating, setGenerating] = useState(false)
  const [usedCloud, setUsedCloud] = useState<boolean | null>(null)

  const createLocalPreview = () => {
    const dimensions: Record<Ratio, [number, number]> = { square: [960, 960], landscape: [1200, 800], portrait: [800, 1200] }
    const [width, height] = dimensions[ratio]
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')!
    const seed = [...prompt].reduce((sum, char) => sum + char.charCodeAt(0), 0)
    const colors = ['#151816', '#35b8a9', '#eb654b', '#f5c95d', '#5c8cd5']
    context.fillStyle = colors[seed % colors.length]
    context.fillRect(0, 0, width, height)
    for (let index = 0; index < 18; index += 1) {
      context.fillStyle = colors[(seed + index + 1) % colors.length]
      const x = ((seed * (index + 3)) % width) - width * 0.08
      const y = ((seed * (index + 7)) % height) - height * 0.08
      const size = Math.max(width, height) * (0.05 + (index % 5) * 0.025)
      if (index % 2) context.fillRect(x, y, size * 1.7, size)
      else { context.beginPath(); context.arc(x, y, size, 0, Math.PI * 2); context.fill() }
    }
    context.fillStyle = 'rgba(16,20,17,.78)'
    context.fillRect(0, height - 190, width, 190)
    context.direction = 'rtl'
    context.textAlign = 'right'
    context.fillStyle = '#ffffff'
    const caption = prompt.slice(0, 52)
    let captionSize = 42
    context.font = `700 ${captionSize}px Tahoma, Arial`
    while (context.measureText(caption).width > width - 116 && captionSize > 24) {
      captionSize -= 2
      context.font = `700 ${captionSize}px Tahoma, Arial`
    }
    context.fillText(caption, width - 58, height - 105)
    context.fillStyle = '#f5c95d'
    context.font = '24px Tahoma, Arial'
    context.fillText(`${style} · Nados AI`, width - 58, height - 55)
    setResult(canvas.toDataURL('image/png'))
  }

  const generate = async () => {
    if (!prompt.trim()) return
    setGenerating(true)
    setResult('')
    const generated = await generateNadosImage(prompt.trim(), style, ratio)
    if (generated.dataUrl) {
      setResult(generated.dataUrl)
      setUsedCloud(true)
    } else {
      createLocalPreview()
      setUsedCloud(false)
    }
    setGenerating(false)
  }

  const download = () => {
    if (!result) return
    const anchor = document.createElement('a')
    anchor.href = result
    anchor.download = 'nados-ai-image.png'
    anchor.click()
  }

  return (
    <section className="page-view studio-view">
      <div className="page-heading"><span>استوديو Nados</span><h1>إنشاء الصور</h1></div>
      <div className="studio-layout">
        <div className="studio-controls">
          <label>وصف الصورة<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} /></label>
          <div className="control-block"><span>الأسلوب</span><div className="choice-grid">{['سينمائي', 'واقعي', 'رسم رقمي', 'بسيط'].map((item) => <button key={item} className={style === item ? 'active' : ''} onClick={() => setStyle(item)}>{item}</button>)}</div></div>
          <div className="control-block"><span>الأبعاد</span><div className="ratio-picker"><button className={ratio === 'square' ? 'active' : ''} onClick={() => setRatio('square')}><i className="ratio-square" />1:1</button><button className={ratio === 'landscape' ? 'active' : ''} onClick={() => setRatio('landscape')}><i className="ratio-landscape" />3:2</button><button className={ratio === 'portrait' ? 'active' : ''} onClick={() => setRatio('portrait')}><i className="ratio-portrait" />2:3</button></div></div>
          <button className="generate-command" onClick={generate} disabled={generating || !prompt.trim()}><WandSparkles size={19} />{generating ? 'جارٍ الإنشاء...' : 'إنشاء الصورة'}</button>
          <small className={`demo-note ${connected ? 'online' : ''}`}><ShieldCheck size={14} /> {usedCloud === true ? 'تم إنشاء الصورة بالذكاء الاصطناعي.' : usedCloud === false ? 'تعذّر الاتصال؛ تم إنشاء معاينة محلية.' : connected ? 'مولّد الصور بالذكاء الاصطناعي متصل.' : 'معاينة محلية حتى تتم إضافة مفتاح API.'}</small>
        </div>
        <div className={`image-stage ratio-${ratio}`}>
          {result ? <><img src={result} alt={prompt} /><button className="download-image" onClick={download} aria-label="تنزيل الصورة" title="تنزيل"><Download size={19} /></button></> : <div><ImageIcon size={38} /><strong>ستظهر صورتك هنا</strong><span>اكتب وصفاً واختر الأسلوب والأبعاد</span></div>}
        </div>
      </div>
    </section>
  )
}

const connectorItems = [
  { id: 'gmail', name: 'Gmail', detail: 'ابحث في رسائلك ومرفقاتك', Icon: Mail, color: 'coral' },
  { id: 'drive', name: 'Google Drive', detail: 'استخدم ملفات Drive كمصادر', Icon: HardDrive, color: 'blue' },
  { id: 'calendar', name: 'Google Calendar', detail: 'اقرأ جدولك وأنشئ مواعيد', Icon: CalendarDays, color: 'mint' },
  { id: 'slack', name: 'Slack', detail: 'ابحث في قنوات فريقك', Icon: MessageCircle, color: 'amber' },
  { id: 'notion', name: 'Notion', detail: 'استفد من صفحات مساحة العمل', Icon: FileBox, color: 'dark' },
  { id: 'dropbox', name: 'Dropbox', detail: 'صل ملفاتك السحابية', Icon: Cloud, color: 'blue' },
]

export function ConnectorsView() {
  const [connected, setConnected] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('nados-connectors') || '[]') as string[] } catch { return [] }
  })
  useEffect(() => localStorage.setItem('nados-connectors', JSON.stringify(connected)), [connected])

  return (
    <section className="page-view connectors-view">
      <div className="page-heading"><span>مصادرك الخاصة</span><h1>التطبيقات المتصلة</h1><p>اختر المصادر التي يستطيع Nados استخدامها عند الإجابة.</p></div>
      <div className="connectors-grid">
        {connectorItems.map(({ id, name, detail, Icon, color }) => {
          const active = connected.includes(id)
          return (
            <article className="connector-card" key={id}>
              <span className={`connector-icon ${color}`}><Icon size={23} /></span>
              <div><h2>{name}</h2><p>{detail}</p></div>
              <button className={active ? 'connected' : ''} onClick={() => setConnected((items) => active ? items.filter((item) => item !== id) : [...items, id])}>{active ? <><Check size={15} /> متصل</> : 'ربط'}</button>
            </article>
          )
        })}
      </div>
      <div className="privacy-note"><ShieldCheck size={20} /><div><strong>أنت تتحكم بالوصول</strong><span>يمكن فصل أي تطبيق في أي وقت. لا تُستخدم بياناتك لتدريب النماذج في هذا الوضع.</span></div></div>
    </section>
  )
}

export function ComputerView({ enabled }: { enabled: boolean }) {
  const [token, setToken] = useState('')
  const [windows, setWindows] = useState<ComputerWindow[]>([])
  const [windowId, setWindowId] = useState('')
  const [task, setTask] = useState('')
  const [plan, setPlan] = useState<ComputerPlan | null>(null)
  const [previous, setPrevious] = useState<string[]>([])
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState<'connect' | 'plan' | 'execute' | ''>('')
  const [message, setMessage] = useState('')
  const [availableModels, setAvailableModels] = useState<NadosModelOption[]>([])
  const [selectedModelId, setSelectedModelId] = useState('nados-v1')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewText, setPreviewText] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const tokenRef = useRef('')
  const fileInput = useRef<HTMLInputElement>(null)
  const computerModels = availableModels.filter((item) => item.id === 'nados-v1' || item.vision)
  const selectedWindow = windows.find((item) => item.id === windowId) ?? windows[0]
  const quickPrompts = [
    'افتح موقعًا جديدًا وراجع الصفحة الرئيسية',
    'انقل المؤشر إلى منطقة معينة ثم انسخ النص',
    'اكتب عنوان تقرير واحتفظ بالتنسيق البسيط',
  ]
  const toolCards = [
    { label: 'فتح صفحة', prompt: 'افتح صفحة ويب جديدة في المتصفح', icon: Globe2 },
    { label: 'نقل المؤشر', prompt: 'انقل المؤشر إلى مكان مناسب ثم أظهر الهدف', icon: MousePointer2 },
    { label: 'كتابة', prompt: 'اكتب نصًا مختصرًا في الحقل المناسب', icon: Keyboard },
  ] as const

  useEffect(() => {
    tokenRef.current = token
  }, [token])

  useEffect(() => {
    if (!selectedFile) {
      setPreviewText('')
      setPreviewUrl('')
      return
    }

    if (selectedFile.type.startsWith('image/')) {
      const objectUrl = URL.createObjectURL(selectedFile)
      setPreviewUrl(objectUrl)
      setPreviewText('')
      return () => URL.revokeObjectURL(objectUrl)
    }

    let active = true
    setPreviewUrl('')
    void selectedFile.text().then((text) => {
      if (!active) return
      setPreviewText(text.slice(0, 600))
    }).catch(() => {
      if (active) setPreviewText('')
    })

    return () => { active = false }
  }, [selectedFile])

  useEffect(() => {
    let active = true
    void getNadosModels().then((models) => {
      if (!active) return
      setAvailableModels(models)
      setSelectedModelId((current) => {
        if (models.some((item) => item.id === current)) return current
        const fallback = models.find((item) => item.id === 'nados-v1' || item.vision) || models[0]
        return fallback?.id || 'nados-v1'
      })
    }).catch(() => {
      if (active) setAvailableModels([])
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const nextSelected = computerModels.find((item) => item.id === selectedModelId) || computerModels[0]
    if (nextSelected && nextSelected.id !== selectedModelId) {
      setSelectedModelId(nextSelected.id)
    }
  }, [computerModels, selectedModelId])
  useEffect(() => () => {
    if (tokenRef.current) void closeComputerSession(tokenRef.current)
  }, [])

  const resetComputerSession = (nextMessage = 'تم إنهاء صلاحية التحكم.') => {
    setToken('')
    setWindows([])
    setWindowId('')
    setPlan(null)
    setPrevious([])
    setMessage(nextMessage)
  }

  const selectedModel = computerModels.find((item) => item.id === selectedModelId) || computerModels[0]

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null
    setSelectedFile(file)
    event.target.value = ''
  }

  const clearSelectedFile = () => {
    setSelectedFile(null)
    setPreviewText('')
    setPreviewUrl('')
    if (fileInput.current) fileInput.current.value = ''
  }

  const providerLabel = (_provider: string | undefined) => {
    return 'Nados'
  }

  const connect = async () => {
    setBusy('connect')
    setMessage('')
    try {
      const session = await startComputerSession()
      setToken(session.token)
      setWindows(session.windows)
      setWindowId(session.windows[0]?.id || '')
      setMessage(session.windows.length ? 'اختر نافذة واكتب المهمة.' : 'لا توجد نافذة مسموح بالتحكم بها حالياً.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذّر بدء جلسة الكمبيوتر.')
    } finally { setBusy('') }
  }

  const disconnect = async () => {
    if (token) await closeComputerSession(token)
    resetComputerSession('تم إنهاء صلاحية التحكم.')
  }

  const analyze = async () => {
    if (!token || !windowId || !task.trim()) return
    setBusy('plan')
    setPlan(null)
    setMessage('')
    try {
      const next = await planComputerStep(token, windowId, task, previous, selectedModel?.providerId || 'auto', selectedModel?.model || '', selectedFile)
      setPlan(next)
      if (next.action.action === 'finish') setMessage(next.action.description)
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'تعذّر تحليل الشاشة.'
      if (messageText.includes('انتهت جلسة التحكم')) {
        resetComputerSession('انتهت جلسة التحكم. أعد الاتصال بالكمبيوتر.')
        return
      }
      setMessage(messageText)
    } finally { setBusy('') }
  }

  const approve = async () => {
    if (!token || !plan?.planId) return
    setBusy('execute')
    try {
      const result = await executeComputerStep(token, plan.planId)
      setPrevious((items) => [...items, result.description].slice(-8))
      setPlan(null)
      setMessage('تم تنفيذ الخطوة. افحص النتيجة ثم اطلب الخطوة التالية.')
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'تعذّر تنفيذ الإجراء.'
      if (messageText.includes('انتهت جلسة التحكم')) {
        resetComputerSession('انتهت جلسة التحكم. أعد الاتصال بالكمبيوتر.')
        return
      }
      setMessage(messageText)
    } finally { setBusy('') }
  }

  const actionDetails = (current: ComputerPlan['action']) => {
    if (current.action === 'click' || current.action === 'double_click') return `${current.action === 'double_click' ? 'نقرتان' : 'نقرة'} عند (${current.x}, ${current.y})`
    if (current.action === 'type') return `كتابة: ${current.text}`
    if (current.action === 'key') return `مفتاح: ${current.key}`
    if (current.action === 'scroll') return `تمرير ${current.direction === 'up' ? 'للأعلى' : 'للأسفل'} بمقدار ${current.amount}`
    if (current.action === 'navigate_url') return `فتح الرابط: ${current.url}`
    return 'انتهت المهمة'
  }

  return (
    <section className="page-view computer-view">
      <div className="page-heading-row">
        <div className="page-heading"><span>Computer Use</span><h1>تحكم مرئي بموافقتك</h1><p>يحلل Nados نافذة واحدة ويقترح خطوة واحدة فقط قبل التنفيذ.</p></div>
        {token && <button className="secondary-command computer-disconnect" onClick={() => void disconnect()}><Power size={16} /> إنهاء الاتصال</button>}
      </div>
      <div className="computer-toolbar" aria-label="حالة التحكم بالكمبيوتر">
        <span className={`computer-pill ${token ? 'is-active' : 'is-idle'}`}><span className="computer-pill-dot" /> {token ? 'جلسة نشطة' : 'جاهز للاتصال'}</span>
        <span className="computer-pill"><ShieldCheck size={12} /> التحكم الآمن</span>
        <span className="computer-pill"><MonitorCog size={12} /> {selectedWindow?.title || 'تحديد النافذة'}</span>
      </div>
      <div className="computer-brief" aria-label="ملخص واجهة التحكم">
        <div>
          <strong>واجهة تحكم ذكية</strong>
          <span>حدد الهدف، ثم دع Nados يراجع النافذة ويقترح خطوة واحدة فقط قبل التنفيذ.</span>
        </div>
        <div className="computer-brief-meta">
          <span>أمان: معتمد</span>
          <span>خطوة واحدة</span>
          <span>جلسة: {token ? 'نشطة' : 'غير متصلة'}</span>
        </div>
        <div className="computer-brief-steps">
          <span>طريقة الاستخدام</span>
          <ol>
            <li>ابدأ الجلسة ثم اختر النافذة التي تريد التحكم بها.</li>
            <li>اكتب المهمة أو استخدم أحد الأوامر السريعة.</li>
            <li>راجع الخطوة المقترحة ثم وافق على التنفيذ عند الحاجة.</li>
          </ol>
        </div>
      </div>

      {!token ? (
        <div className="computer-onboarding">
          <MonitorCog size={38} />
          <div><h2>{enabled ? 'موصل الكمبيوتر جاهز' : 'موصل الكمبيوتر غير متاح'}</h2><p>{enabled ? 'يعمل محلياً على Windows عبر مزودات الذكاء المتاحة في Nados.' : 'يلزم Windows ومزوّد رؤية مهيأ داخل Nados لتشغيل الميزة.'}</p></div>
          <label className="computer-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>أوافق على إرسال لقطة النافذة المحددة إلى مزوّد الذكاء الاصطناعي لتحليلها.</span></label>
          <button className="primary-command" disabled={!enabled || !consent || busy === 'connect'} onClick={() => void connect()}>{busy === 'connect' ? <LoaderCircle className="spin" size={17} /> : <Power size={17} />} بدء جلسة تحكم لمدة 30 دقيقة</button>
        </div>
      ) : (
        <div className="computer-workspace">
          <div className="computer-controls">
            <div className="computer-summary">
              <div><span>الحالة</span><strong>{token ? 'جلسة نشطة' : 'غير متصل'}</strong></div>
              <div><span>النافذة</span><strong>{selectedWindow?.title || 'لا توجد نافذة'}</strong></div>
              <div><span>الخطوات</span><strong>{previous.length ? `${previous.length} سجل` : 'لا توجد خطوات حتى الآن'}</strong></div>
            </div>
            <label><span>النافذة المستهدفة</span><select value={windowId} onChange={(event) => { setWindowId(event.target.value); setPlan(null); setPrevious([]) }}>{windows.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
            <label><span>المهمة</span><textarea value={task} onChange={(event) => setTask(event.target.value)} placeholder="مثال: افتح تبويب الملف واكتب عنوان التقرير" /></label>
            <div className="computer-file-picker">
              <span>ملف/مرفق</span>
              <div className="computer-file-actions">
                <button type="button" className="secondary-command" onClick={() => fileInput.current?.click()}><Upload size={15} /> اختيار ملف</button>
                {selectedFile && <button type="button" className="text-button" onClick={clearSelectedFile}>حذف</button>}
              </div>
              <input ref={fileInput} type="file" hidden onChange={handleFileSelect} />
            </div>
            {selectedFile && (
              <div className="computer-preview">
                <div className="computer-preview-header">
                  <span>معاينة الملف</span>
                  <small>{selectedFile.name}</small>
                </div>
                {previewUrl ? (
                  <img src={previewUrl} alt={selectedFile.name} />
                ) : (
                  <pre>{previewText || 'لا توجد معاينة نصية لهذا الملف.'}</pre>
                )}
              </div>
            )}
            <label><span>نموذج الذكاء</span><select value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)}>{computerModels.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
            <div className="computer-tools">
              <div className="computer-tools-head"><span>أدوات سريعة</span></div>
              <div className="computer-tool-grid">
                {toolCards.map(({ label, prompt, icon: Icon }) => (
                  <button type="button" key={label} className="computer-tool-card" onClick={() => setTask(prompt)}>
                    <Icon size={15} />
                    <strong>{label}</strong>
                  </button>
                ))}
              </div>
            </div>
            <div className="computer-quick-actions">
              {quickPrompts.map((prompt) => (
                <button type="button" key={prompt} className="quick-prompt" onClick={() => setTask(prompt)}>{prompt}</button>
              ))}
            </div>
            <button className="analyze-command" disabled={!windowId || !task.trim() || Boolean(busy)} onClick={() => void analyze()}>{busy === 'plan' ? <LoaderCircle className="spin" size={17} /> : <MonitorCog size={17} />} {previous.length ? 'حلّل الخطوة التالية' : 'حلّل الشاشة'}</button>
            {previous.length > 0 && (
              <div className="computer-history">
                <h3>آخر الخطوات</h3>
                <ul>
                  {[...previous].reverse().slice(0, 4).map((item, index) => (
                    <li key={`${item}-${index}`}><span>{index + 1}</span><p>{item}</p></li>
                  ))}
                </ul>
              </div>
            )}
            <div className="computer-safety"><ShieldCheck size={17} /><span>النوافذ الحساسة والطرفية وإعدادات الأمان محظورة. تنتهي صلاحية كل خطوة بعد 90 ثانية.</span></div>
          </div>
          <div className="computer-stage">
            {plan ? <>
              {plan.screenshot
                ? <img src={plan.screenshot} alt="لقطة النافذة قبل تنفيذ الإجراء" />
                : <div className="computer-empty"><Globe2 size={34} /><strong>تنقل مباشر آمن</strong><span>لا يحتاج فتح الرابط إلى إرسال لقطة شاشة لمزوّد الذكاء الاصطناعي.</span></div>}
              <div className="computer-plan">
                <span>{plan.action.action === 'type' || plan.action.action === 'key' ? <Keyboard size={17} /> : <MousePointer2 size={17} />}</span>
                <div>
                  <strong>{plan.action.description}</strong>
                  <small dir="auto">{actionDetails(plan.action)}</small>
                  <small className="computer-plan-provider">مزوّد الذكاء: {providerLabel(plan.provider)}</small>
                </div>
                {plan.requiresConfirmation && <button onClick={() => void approve()} disabled={busy === 'execute'}>{busy === 'execute' ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} موافقة وتنفيذ</button>}
              </div>
            </> : <div className="computer-empty"><MousePointer2 size={34} /><strong>بانتظار تحليل الشاشة</strong><span>ستظهر لقطة النافذة والإجراء المقترح هنا قبل التنفيذ.</span></div>}
          </div>
        </div>
      )}
      {message && <div className="computer-message"><ShieldAlert size={16} /><span>{message}</span></div>}
    </section>
  )
}

export function SettingsPanel({ settings, capabilities, onChange, onProvidersChanged, onClose }: { settings: AppSettings; capabilities: ApiCapabilities; onChange: (next: Partial<AppSettings>) => void; onProvidersChanged: () => void; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'providers' | 'preferences'>('providers')
  const connectedCount = capabilities.providers?.filter((item) => item.configured).length || 0
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
  const featureItems = [
    ['chat', 'المحادثة', MessageSquareText],
    ['webSearch', 'بحث الويب', Globe2],
    ['files', 'تحليل الملفات', FileText],
    ['vision', 'الرؤية', ImageIcon],
    ['video', 'تحليل الفيديو', Video],
    ['images', 'إنشاء الصور', WandSparkles],
    ['transcription', 'تفريغ الصوت', Mic],
    ['speech', 'توليد الصوت', Volume2],
    ['computer', 'التحكم بالكمبيوتر', MonitorCog],
  ] as const
  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="settings-drawer" role="dialog" aria-modal="true" aria-label="الإعدادات" onClick={(event) => event.stopPropagation()}>
        <div className="modal-heading"><div><span>حسابي</span><h2>الإعدادات</h2></div><button className="icon-button" onClick={onClose} aria-label="إغلاق"><X size={19} /></button></div>
        <div className="settings-profile"><span>N</span><div><strong>Nados v1.0</strong><small>{isLocal ? 'الإدارة الكاملة متاحة' : 'الإصدار المنتشر — الإدارة من النسخة المحلية'}</small></div><i className={connectedCount ? 'connected' : ''}>{connectedCount ? 'متصل' : 'تجريبي'}</i></div>
        <div className="settings-tabs" role="tablist" aria-label="أقسام الإعدادات">
          {isLocal && <button className={activeTab === 'providers' ? 'active' : ''} role="tab" aria-selected={activeTab === 'providers'} onClick={() => setActiveTab('providers')}>المزودات</button>}
          <button className={activeTab === 'preferences' ? 'active' : ''} role="tab" aria-selected={activeTab === 'preferences'} onClick={() => setActiveTab('preferences')}>الإعدادات</button>
        </div>
        {activeTab === 'providers' && isLocal && (
          <>
            <div className="settings-group provider-group">
              <h3>مزودو النموذج</h3>
              <div className="provider-list">
                {(capabilities.providers || []).map((provider) => (
                  <div className={`provider-card ${provider.configured ? 'connected' : 'pending'}`} key={provider.id}>
                    <div className="provider-card-header">
                      <span className={`provider-status ${provider.configured ? 'connected' : ''}`} />
                      <strong>{provider.name}</strong>
                      <small>{provider.configured ? 'متصل' : 'غير مهيأ'}</small>
                    </div>
                    <div className="provider-card-meta">
                      <span>{provider.configured ? 'جاهز لاستخدامه في المحادثات' : 'في انتظار تكوين مفتاح API'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="settings-group feature-status-group">
              <h3>ميزات Nados</h3>
              <div>{featureItems.map(([id, label, Icon]) => {
                const available = capabilities.features[id]
                return <span className={available ? 'available' : ''} key={id}><Icon size={14} /><strong>{label}</strong><small>{available ? 'جاهزة' : 'تحتاج مزوّداً'}</small></span>
              })}</div>
            </div>
            <ProviderManager onChanged={onProvidersChanged} />
          </>
        )}
        {activeTab === 'preferences' && (
          <>
            <div className="settings-group">
              <h3>التجربة</h3>
              <SettingToggle icon={ShieldCheck} title="الوضع الخفي" note="لا تحفظ المحادثات الجديدة" checked={settings.incognito} onChange={(value) => onChange({ incognito: value })} />
              <SettingToggle icon={Sparkles} title="ذاكرة المحادثة" note="يتذكر Nados الرسائل السابقة داخل المحادثة" checked={settings.memory} onChange={(value) => onChange({ memory: value })} />
              <SettingToggle icon={BookOpen} title="إظهار المصادر" note="أرفق المراجع مع الإجابات" checked={settings.citations} onChange={(value) => onChange({ citations: value })} />
            </div>
            <div className="settings-group">
              <h3>المظهر</h3>
              <div className="settings-choice"><span>السمة</span><div className="segmented-control"><button className={settings.dark ? '' : 'active'} onClick={() => onChange({ dark: false })}>نهاري</button><button className={settings.dark ? 'active' : ''} onClick={() => onChange({ dark: true })}>ليلي</button></div></div>
              <div className="settings-choice"><span>اللغة</span><div className="segmented-control"><button className={settings.language === 'ar' ? 'active' : ''} onClick={() => onChange({ language: 'ar' })}>العربية</button><button className={settings.language === 'en' ? 'active' : ''} onClick={() => onChange({ language: 'en' })}>English</button></div></div>
            </div>
          </>
        )}
        <button className="settings-link"><Settings size={17} /><span>إدارة الحساب والفوترة</span><ArrowLeft size={16} /></button>
      </aside>
    </div>
  )
}

function ProviderManager({ onChanged }: { onChanged: () => void }) {
  const [catalog, setCatalog] = useState<ProviderPreset[]>([])
  const [managed, setManaged] = useState<ManagedProvider[]>([])
  const [available, setAvailable] = useState<Array<{ id: string; name: string; configured: boolean }>>([])
  const [presetId, setPresetId] = useState('openai-api')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState<Record<string, 'ok' | 'error' | 'testing'>>({})
  const [message, setMessage] = useState('')

  const refresh = async () => {
    const data = await getProviderManager()
    setCatalog(data.catalog)
    setManaged(data.managed)
    setAvailable(data.providers || [])
    const selected = data.catalog.find((item) => item.id === presetId) || data.catalog[0]
    if (selected && !model) setModel(selected.model)
  }

  useEffect(() => { void refresh().catch((error) => setMessage(error.message)) }, [])
  const selected = catalog.find((item) => item.id === presetId)
  const choosePreset = (id: string) => {
    const item = catalog.find((provider) => provider.id === id)
    setPresetId(id)
    setName(item?.id === 'custom' ? name : '')
    setBaseUrl(item?.id === 'custom' ? baseUrl : '')
    setModel(item?.model || '')
    setMessage('')
  }

  const save = async () => {
    setBusy('save')
    setMessage('')
    try {
      await saveProvider({ presetId, name, baseUrl, model, apiKey })
      setApiKey('')
      await refresh()
      onChanged()
      setMessage('تم حفظ المزوّد محليًا. افحص الاتصال الآن.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذّر حفظ المزوّد.')
    } finally { setBusy('') }
  }

  const testOne = async (id: string) => {
    setStatus((current) => ({ ...current, [id]: 'testing' }))
    try {
      await testManagedProvider(id)
      setStatus((current) => ({ ...current, [id]: 'ok' }))
    } catch {
      setStatus((current) => ({ ...current, [id]: 'error' }))
    }
  }

  const testAll = async () => {
    setBusy('test-all')
    for (const provider of available.filter((item) => item.configured)) await testOne(provider.id)
    setBusy('')
    onChanged()
  }

  const remove = async (id: string) => {
    setBusy(id)
    await removeManagedProvider(id)
    await refresh()
    onChanged()
    setBusy('')
  }

  return <div className="settings-group api-manager">
    <div className="api-manager-title"><div><h3>إضافة API عالمي</h3><small>OpenAI-compatible أو مزوّد مخصص</small></div>{available.some((item) => item.configured) && <button onClick={testAll} disabled={Boolean(busy)}><RefreshCw size={14} /> فحص الكل</button>}</div>
    <div className="provider-quick-stats">
      <div className="provider-stat"><span>{available.filter((item) => item.configured).length}</span><small>مزود متصل</small></div>
      <div className="provider-stat"><span>{managed.length}</span><small>مزوّد محفوظ</small></div>
      <div className="provider-stat"><span>{catalog.length}</span><small>قوالب متاحة</small></div>
    </div>
    <div className="provider-preset-grid">
      {catalog.map((provider) => (
        <button
          key={provider.id}
          type="button"
          className={`provider-preset-card ${presetId === provider.id ? 'active' : ''}`}
          onClick={() => choosePreset(provider.id)}
        >
          <span className="provider-preset-badge">{provider.id === 'custom' ? 'مخصص' : 'جاهز'}</span>
          <strong>{provider.name}</strong>
          <small>{provider.id === 'custom' ? 'Base URL & API Key' : provider.model}</small>
        </button>
      ))}
    </div>
    {selected?.id === 'custom' && <><label><span>اسم المزوّد</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="My AI Provider" /></label><label><span>Base URL</span><input dir="ltr" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" /></label></>}
    <label><span>النموذج</span><input dir="ltr" value={model} onChange={(event) => setModel(event.target.value)} placeholder="model-id" /></label>
    <label><span>API Key</span><div className="api-key-input"><KeyRound size={15} /><input dir="ltr" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="يُحفظ على الخادم فقط" /></div></label>
    <button className="save-provider" onClick={save} disabled={!apiKey || !model || busy === 'save'}>{busy === 'save' ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} حفظ وربط</button>
    {message && <p className="api-manager-message">{message}</p>}
    {(available.some((item) => item.configured) || managed.length > 0) && (
      <div className="managed-providers-panel">
        <div className="managed-providers-header">
          <div>
            <strong>المزوّدات المسجلة</strong>
            <small>ادارة سريعة وتحديثات الحالة</small>
          </div>
        </div>
        <div className="managed-providers">
          {available.filter((item) => item.configured && !managed.some((managedProvider) => managedProvider.id === item.id)).map((provider) => (
            <div className="managed-provider-item" key={provider.id}>
              <span className={status[provider.id] || ''} />
              <div>
                <strong>{provider.name}</strong>
                <small>من إعدادات الخادم</small>
              </div>
              <button onClick={() => testOne(provider.id)} disabled={status[provider.id] === 'testing'} title="فحص الاتصال">
                {status[provider.id] === 'testing' ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
              </button>
            </div>
          ))}
          {managed.map((provider) => (
            <div className="managed-provider-item managed-provider-item--saved" key={provider.id}>
              <span className={status[provider.id] || ''} />
              <div>
                <strong>{provider.name}</strong>
                <small dir="ltr">{provider.model}</small>
              </div>
              <button onClick={() => testOne(provider.id)} disabled={status[provider.id] === 'testing'} title="فحص الاتصال">
                {status[provider.id] === 'testing' ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
              </button>
              <button onClick={() => remove(provider.id)} disabled={busy === provider.id} title="فصل المزوّد">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </div>
    )}
    <p className="api-security"><ShieldCheck size={14} /> المفاتيح لا تُعرض مجددًا ولا تُرسل إلا إلى المزوّد الذي أضفته.</p>
  </div>
}

function SettingToggle({ icon: Icon, title, note, checked, onChange }: { icon: typeof Globe2; title: string; note: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="setting-toggle"><Icon size={18} /><div><strong>{title}</strong><small>{note}</small></div><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="switch" /></label>
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

export function VoiceDialog({ cloudTranscription, onClose, onSubmit }: { cloudTranscription: boolean; onClose: () => void; onSubmit: (text: string) => void }) {
  const [listening, setListening] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [transcript, setTranscript] = useState('')
  const recognition = useRef<Recognition | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const mediaStream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])

  const startBrowserRecognition = () => {
    const Speech = (window as typeof window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition || (window as typeof window & { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition
    if (!Speech) { setTranscript('الإملاء الصوتي غير مدعوم في هذا المتصفح. يمكنك كتابة سؤالك هنا.'); return }
    const instance = new Speech()
    recognition.current = instance
    instance.lang = 'ar-SA'
    instance.interimResults = false
    instance.onstart = () => setListening(true)
    instance.onend = () => setListening(false)
    instance.onerror = () => { setListening(false); setTranscript('تعذّر الوصول إلى الميكروفون.') }
    instance.onresult = (event) => setTranscript(event.results[0][0].transcript)
    instance.start()
  }

  const stopTracks = () => {
    mediaStream.current?.getTracks().forEach((track) => track.stop())
    mediaStream.current = null
  }

  const start = async () => {
    if (listening) {
      if (recorder.current?.state === 'recording') recorder.current.stop()
      else recognition.current?.stop()
      return
    }
    if (!cloudTranscription || typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      startBrowserRecognition()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStream.current = stream
      chunks.current = []
      const instance = new MediaRecorder(stream)
      recorder.current = instance
      instance.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data) }
      instance.onstart = () => setListening(true)
      instance.onstop = async () => {
        setListening(false)
        setProcessing(true)
        const audio = new Blob(chunks.current, { type: instance.mimeType || 'audio/webm' })
        const text = await transcribeNados(audio)
        setTranscript(text || 'تعذّر تحويل التسجيل إلى نص. يمكنك كتابة سؤالك هنا.')
        setProcessing(false)
        stopTracks()
      }
      instance.start()
    } catch {
      setListening(false)
      setTranscript('تعذّر الوصول إلى الميكروفون. تحقق من إذن المتصفح.')
      stopTracks()
    }
  }

  const close = () => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
    recognition.current?.stop()
    stopTracks()
    onClose()
  }

  return (
    <div className="modal-backdrop voice-backdrop" role="presentation">
      <div className="voice-dialog" role="dialog" aria-modal="true" aria-label="المحادثة الصوتية">
        <button className="icon-button voice-close" onClick={close} aria-label="إغلاق"><X size={20} /></button>
        <div className="voice-brand"><span>N</span><i /></div>
        <span className="voice-status">{processing ? 'أحوّل التسجيل إلى نص...' : listening ? 'أستمع إليك الآن' : transcript ? 'جاهز للإرسال' : cloudTranscription ? 'تفريغ صوتي بالذكاء الاصطناعي' : 'محادثة صوتية'}</span>
        <div className={`voice-wave ${listening ? 'active' : ''}`} aria-hidden="true">{Array.from({ length: 11 }).map((_, index) => <i key={index} />)}</div>
        <textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="سيظهر كلامك هنا..." aria-label="النص الصوتي" />
        <div className="voice-actions">
          <button className={`voice-mic ${listening ? 'recording' : ''}`} onClick={start} disabled={processing} aria-label={listening ? 'إيقاف التسجيل' : 'ابدأ التحدث'}>{processing ? <LoaderCircle className="spin" size={21} /> : listening ? <Square size={18} /> : <Mic size={21} />}</button>
          <button className="primary-command" disabled={!transcript.trim()} onClick={() => onSubmit(transcript)}>إرسال إلى Nados <ArrowLeft size={17} /></button>
        </div>
      </div>
    </div>
  )
}
