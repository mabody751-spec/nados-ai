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
import { closeComputerSession, executeComputerStep, getNadosModels, getProviderManager, planComputerStep, removeManagedProvider, saveProvider, startComputerSession, testManagedProvider, transcribeNados, type ApiCapabilities, type ComputerPlan, type ComputerWindow, type ManagedProvider, type NadosModelOption, type ProviderPreset } from './api'
import type { AppSettings, HistoryItem, Space } from './types'

export function DiscoverView({ onAsk }: { onAsk: (question: string) => void }) {
  const [category, setCategory] = useState('الكل')
  const [query, setQuery] = useState('')
  const [bookmarks, setBookmarks] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('nados-discover-saved') || '[]') as string[] } catch { return [] }
  })
  useEffect(() => { try { localStorage.setItem('nados-discover-saved', JSON.stringify(bookmarks)) } catch {} }, [bookmarks])

  const topics = [
    { tag: 'تقنية', title: 'كيف تغيّر نماذج الذكاء الاصطناعي طريقة بناء البرمجيات؟', summary: 'نظرة عملية على أدوات البرمجة المدعومة بالذكاء الاصطناعي، وحدودها، وكيف يستفيد منها المطوّر اليوم.', source: 'قراءة في 6 دقائق', sources: 5, color: 'mint' },
    { tag: 'أعمال', title: 'اتجاهات العمل الرقمي التي تستحق المتابعة هذا الأسبوع', summary: 'أهم التحولات في سوق العمل الرقمي: العمل عن بُعد، الوكلاء الأذكياء، ومهارات المستقبل.', source: 'قراءة في 5 دقائق', sources: 6, color: 'coral' },
    { tag: 'علوم', title: 'لماذا أصبحت الحوسبة الكمية أقرب إلى الاستخدام العملي؟', summary: 'ما الذي تغيّر فعلياً في الحوسبة الكمية، وما الذي لا يزال بعيداً عن التطبيق التجاري.', source: 'قراءة في 8 دقائق', sources: 7, color: 'amber' },
    { tag: 'إبداع', title: 'أدوات بسيطة لتحويل الفكرة الأولى إلى مشروع قابل للاختبار', summary: 'خطوات عملية من الفكرة إلى نموذج أولي قابل للتجربة خلال أيام، دون تعقيد تقني.', source: 'قراءة في 4 دقائق', sources: 4, color: 'blue' },
    { tag: 'تقنية', title: 'دليل عملي لحماية بياناتك عند استخدام أدوات الذكاء الاصطناعي', summary: 'كيف تحمي بياناتك الحساسة، وما الذي يجب ألا تشاركه مع أي أداة ذكاء اصطناعي.', source: 'قراءة في 7 دقائق', sources: 7, color: 'coral' },
    { tag: 'أعمال', title: 'كيف تقيس نجاح فكرة جديدة قبل استثمار وقت طويل فيها؟', summary: 'منهجية سريعة لاختبار الطلب قبل البناء: مقابلات، صفحات هبوط، ومؤشرات قرار.', source: 'قراءة في 5 دقائق', sources: 5, color: 'mint' },
    { tag: 'تعليم', title: 'تعلّم التقنية بسرعة: خارطة طريق للمبتدئين في 2026', summary: 'ترتيب ذكي لمصادر التعلّم، ومشاريع صغيرة تبني منها مهارة حقيقية.', source: 'قراءة في 6 دقائق', sources: 8, color: 'blue' },
    { tag: 'علوم', title: 'الذكاء الاصطناعي في الطب: ما وصل إليه فعلاً؟', summary: 'تطبيقات موثوقة تساعد الأطباء اليوم، وحدود الاستخدام الآمن.', source: 'قراءة في 9 دقائق', sources: 6, color: 'amber' },
  ]
  const categories = ['الكل', 'تقنية', 'أعمال', 'علوم', 'إبداع', 'تعليم']
  const visible = topics.filter((topic) => (category === 'الكل' || topic.tag === category) && (!query.trim() || topic.title.includes(query) || topic.summary.includes(query)))
  const featured = visible[0]
  const toggleSave = (title: string) => setBookmarks((current) => current.includes(title) ? current.filter((item) => item !== title) : [...current, title])

  return (
    <section className="page-view discover-view">
      <div className="page-heading-row">
        <div className="page-heading"><span>مختارات يومية</span><h1>استكشف أفكاراً تستحق وقتك</h1><p>محتوى مختار مدعوم بالمصادر، جاهز للبحث العميق.</p></div>
        <label className="library-search discover-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث في المختارات..." /></label>
      </div>
      <div className="segmented-control topic-filter" aria-label="تصنيف المحتوى">
        {categories.map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}
      </div>
      {featured && (
        <article className={`discover-featured ${featured.color}`}>
          <div className="discover-featured-body">
            <span className="discover-featured-tag">مختار اليوم · {featured.tag}</span>
            <h2>{featured.title}</h2>
            <p>{featured.summary}</p>
            <div className="discover-featured-meta">
              <span><CalendarDays size={14} /> {featured.source}</span>
              <span><FileText size={14} /> {featured.sources} مصادر</span>
            </div>
            <div className="discover-featured-actions">
              <button className="primary-command" onClick={() => onAsk(`ابحث بعمق: ${featured.title}`)}><Sparkles size={16} /> بحث عميق</button>
              <button className="secondary-command" onClick={() => toggleSave(featured.title)}><Bookmark size={16} fill={bookmarks.includes(featured.title) ? 'currentColor' : 'none'} /> {bookmarks.includes(featured.title) ? 'محفوظ' : 'حفظ'}</button>
            </div>
          </div>
        </article>
      )}
      <div className="topic-grid">
        {visible.slice(1).map((topic, index) => (
          <article key={topic.title} className={`topic-card ${topic.color}`}>
            <div className="topic-number">0{index + 2}</div>
            <span>{topic.tag}</span>
            <h2>{topic.title}</h2>
            <p className="topic-summary">{topic.summary}</p>
            <small>{topic.source} · {topic.sources} مصادر</small>
            <div className="topic-actions">
              <button onClick={() => toggleSave(topic.title)} aria-label="حفظ" title="حفظ"><Bookmark size={17} fill={bookmarks.includes(topic.title) ? 'currentColor' : 'none'} /></button>
              <button onClick={() => onAsk(`ابحث بعمق: ${topic.title}`)} aria-label="افتح الموضوع" title="بحث عميق"><ArrowLeft size={19} /></button>
            </div>
          </article>
        ))}
      </div>
      {visible.length === 0 && <p className="work-empty">لا نتائج مطابقة. جرّب كلمة أخرى أو صنفاً مختلفاً.</p>}
    </section>
  )
}

export function LibraryView({ history, spaces, onOpen }: { history: HistoryItem[]; spaces: Space[]; onOpen: (question: string) => void }) {
  const [filter, setFilter] = useState('')
  const [tab, setTab] = useState<'threads' | 'saved' | 'spaces' | 'files'>('threads')
  const [sort, setSort] = useState<'recent' | 'title'>('recent')
  const savedCount = history.filter((item) => item.saved).length
  const files = [
    { name: 'خطة المنتج.pdf', kind: 'PDF', size: '1.2MB' },
    { name: 'محاضرات الذكاء الاصطناعي.docx', kind: 'DOCX', size: '860KB' },
    { name: 'بيانات السوق.xlsx', kind: 'XLSX', size: '2.4MB' },
    { name: 'ملاحظات المقابلات.txt', kind: 'TXT', size: '12KB' },
  ]
  const match = (value: string) => value.toLowerCase().includes(filter.trim().toLowerCase())
  const threads = history
    .filter((item) => (tab !== 'saved' || item.saved) && (!filter.trim() || match(item.title)))
    .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'ar') : String(b.createdAt).localeCompare(String(a.createdAt)))
  const filteredSpaces = spaces.filter((space) => !filter.trim() || match(space.title) || match(space.description))
  const filteredFiles = files.filter((file) => !filter.trim() || match(file.name))

  return (
    <section className="page-view library-view">
      <div className="page-heading-row">
        <div className="page-heading"><span>كل ما حفظته</span><h1>المكتبة</h1><p>محادثاتك، ملفاتك، ومساحاتك في مكان واحد.</p></div>
        <div className="library-stats"><div><strong>{history.length}</strong><span>محادثة</span></div><div><strong>{savedCount}</strong><span>محفوظة</span></div><div><strong>{spaces.length}</strong><span>مساحة</span></div></div>
      </div>
      <div className="library-toolbar">
        <label className="library-search"><Search size={18} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="ابحث في المكتبة..." /></label>
        <div className="segmented-control">
          <button className={tab === 'threads' ? 'active' : ''} onClick={() => setTab('threads')}>المحادثات</button>
          <button className={tab === 'saved' ? 'active' : ''} onClick={() => setTab('saved')}>المحفوظة</button>
          <button className={tab === 'spaces' ? 'active' : ''} onClick={() => setTab('spaces')}>المساحات</button>
          <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>الملفات</button>
        </div>
        {(tab === 'threads' || tab === 'saved') && (
          <div className="library-sort segmented-control">
            <button className={sort === 'recent' ? 'active' : ''} onClick={() => setSort('recent')}>الأحدث</button>
            <button className={sort === 'title' ? 'active' : ''} onClick={() => setSort('title')}>أبجدي</button>
          </div>
        )}
      </div>
      <div className="library-list">
        {(tab === 'threads' || tab === 'saved') && threads.map((item) => (
          <button key={item.id} onClick={() => onOpen(item.title)}>
            <span className="library-icon"><MessageSquareText size={18} /></span>
            <div><strong>{item.title}</strong><small>{item.createdAt} · {item.mode === 'research' ? 'بحث عميق' : 'محادثة'}</small></div>
            {item.saved ? <Bookmark size={15} fill="currentColor" /> : <span className="library-badge">{item.mode === 'research' ? 'بحث' : 'عام'}</span>}
            <ArrowLeft size={18} />
          </button>
        ))}
        {tab === 'spaces' && filteredSpaces.map((space) => (
          <button key={space.id} onClick={() => onOpen(`لخّص أهم ما في مساحة ${space.title}`)}>
            <span className="library-icon space">{space.emoji || <Boxes size={18} />}</span>
            <div><strong>{space.title}</strong><small>{space.files} ملفات · {space.threads} محادثة · {space.visibility === 'private' ? 'خاصة' : 'مشتركة'}</small></div>
            <ArrowLeft size={18} />
          </button>
        ))}
        {tab === 'files' && filteredFiles.map((file) => (
          <button key={file.name} onClick={() => onOpen(`لخّص محتوى الملف ${file.name}`)}>
            <span className="library-icon file"><FileText size={18} /></span>
            <div><strong>{file.name}</strong><small>{file.kind} · {file.size} · جاهز للبحث</small></div>
            <ArrowLeft size={18} />
          </button>
        ))}
        {((tab === 'threads' || tab === 'saved') && threads.length === 0) && <p className="work-empty">{tab === 'saved' ? 'لا محادثات محفوظة بعد — احفظ أي محادثة من زر المزيد.' : 'لا محادثات مطابقة. ابدأ محادثة جديدة من الرئيسية.'}</p>}
        {tab === 'spaces' && filteredSpaces.length === 0 && <p className="work-empty">لا مساحات مطابقة. أنشئ مساحة من قسم «المساحات».</p>}
        {tab === 'files' && filteredFiles.length === 0 && <p className="work-empty">لا ملفات مطابقة.</p>}
      </div>
    </section>
  )
}

export function SpacesView({ spaces, setSpaces, onAsk }: { spaces: Space[]; setSpaces: (spaces: Space[]) => void; onAsk: (question: string) => void }) {
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [query, setQuery] = useState('')
  const selected = spaces.find((space) => space.id === selectedId)
  const visible = spaces.filter((space) => !query.trim() || space.title.includes(query) || space.description.includes(query))
  const totalFiles = spaces.reduce((sum, space) => sum + space.files, 0)
  const totalThreads = spaces.reduce((sum, space) => sum + space.threads, 0)

  const createSpace = () => {
    if (!title.trim()) return
    const next: Space = { id: `s${Date.now()}`, title: title.trim(), description: description.trim() || 'مساحة جديدة للملفات والمحادثات.', emoji: title.trim()[0], files: 0, threads: 0, visibility: 'private' }
    setSpaces([next, ...spaces])
    setTitle('')
    setDescription('')
    setCreating(false)
  }
  const updateSpace = (id: string, patch: Partial<Space>) => setSpaces(spaces.map((space) => space.id === id ? { ...space, ...patch } : space))
  const deleteSpace = (id: string) => { setSpaces(spaces.filter((space) => space.id !== id)); if (selectedId === id) setSelectedId(null) }

  if (selected) {
    return (
      <section className="page-view space-detail">
        <button className="back-command" onClick={() => setSelectedId(null)}><ChevronRight size={18} /> كل المساحات</button>
        <div className="space-detail-heading"><span className="space-avatar">{selected.emoji}</span><div><h1>{selected.title}</h1><p>{selected.description}</p></div><div className="space-detail-actions"><button className="secondary-command" onClick={() => updateSpace(selected.id, { visibility: selected.visibility === 'private' ? 'shared' : 'private' })}>{selected.visibility === 'private' ? <LockKeyhole size={16} /> : <Users size={16} />} {selected.visibility === 'private' ? 'خاصة' : 'مشتركة'}</button><button className="secondary-command danger" onClick={() => deleteSpace(selected.id)}><Trash2 size={16} /> حذف</button></div></div>
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
            <textarea value={selected.instructions || ''} onChange={(event) => updateSpace(selected.id, { instructions: event.target.value })} placeholder="مثال: اعتمد على الملفات المرفوعة أولاً، واذكر المصدر مع كل معلومة مهمة." aria-label="تعليمات المساحة" />
            <small className="space-hint">تُطبَّق هذه التعليمات على كل محادثة داخل المساحة.</small>
          </aside>
        </div>
      </section>
    )
  }

  return (
    <section className="page-view spaces-view">
      <div className="page-heading-row">
        <div className="page-heading"><span>المعرفة المشتركة</span><h1>المساحات</h1><p>اجمع الملفات والمحادثات في مساحات مركّزة.</p></div>
        <button className="primary-command" onClick={() => setCreating(true)}><Plus size={17} /> مساحة جديدة</button>
      </div>
      <div className="spaces-stats">
        <div><strong>{spaces.length}</strong><span>مساحة</span></div>
        <div><strong>{totalFiles}</strong><span>ملف</span></div>
        <div><strong>{totalThreads}</strong><span>محادثة</span></div>
        <label className="library-search spaces-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث في المساحات..." /></label>
      </div>
      <div className="spaces-grid">
        {visible.map((space) => (
          <button className="space-card" key={space.id} onClick={() => setSelectedId(space.id)}>
            <span className="space-avatar">{space.emoji}</span>
            <span className="space-privacy">{space.visibility === 'private' ? <LockKeyhole size={13} /> : <Users size={13} />}{space.visibility === 'private' ? 'خاصة' : 'مشتركة'}</span>
            <h2>{space.title}</h2>
            <p>{space.description}</p>
            <div><span><FileText size={14} />{space.files} ملفات</span><span><MessageSquareText size={14} />{space.threads} محادثة</span></div>
          </button>
        ))}
      </div>
      {visible.length === 0 && <p className="work-empty">لا مساحات مطابقة. أنشئ مساحة جديدة للبدء.</p>}
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

const connectorItems = [
  { id: 'gmail', name: 'Gmail', detail: 'ابحث في رسائلك ومرفقاتك', Icon: Mail, color: 'coral', category: 'البريد والتواصل' },
  { id: 'calendar', name: 'Google Calendar', detail: 'اقرأ جدولك وأنشئ مواعيد', Icon: CalendarDays, color: 'mint', category: 'البريد والتواصل' },
  { id: 'slack', name: 'Slack', detail: 'ابحث في قنوات فريقك', Icon: MessageCircle, color: 'amber', category: 'البريد والتواصل' },
  { id: 'drive', name: 'Google Drive', detail: 'استخدم ملفات Drive كمصادر', Icon: HardDrive, color: 'blue', category: 'الملفات والتخزين' },
  { id: 'dropbox', name: 'Dropbox', detail: 'صل ملفاتك السحابية', Icon: Cloud, color: 'blue', category: 'الملفات والتخزين' },
  { id: 'notion', name: 'Notion', detail: 'استفد من صفحات مساحة العمل', Icon: FileBox, color: 'dark', category: 'العمل والمعرفة' },
]

export function ConnectorsView() {
  const [connected, setConnected] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('nados-connectors') || '[]') as string[] } catch { return [] }
  })
  const [query, setQuery] = useState('')
  useEffect(() => localStorage.setItem('nados-connectors', JSON.stringify(connected)), [connected])

  const categories = Array.from(new Set(connectorItems.map((item) => item.category)))
  const visible = connectorItems.filter((item) => !query.trim() || item.name.toLowerCase().includes(query.trim().toLowerCase()) || item.detail.includes(query))
  const toggle = (id: string) => setConnected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id])

  return (
    <section className="page-view connectors-view">
      <div className="page-heading-row">
        <div className="page-heading"><span>مصادرك الخاصة</span><h1>التطبيقات المتصلة</h1><p>اختر المصادر التي يستطيع Nados استخدامها عند الإجابة.</p></div>
        <div className="connectors-summary"><strong>{connected.length}</strong><span>متصل من {connectorItems.length}</span></div>
      </div>
      <label className="library-search connectors-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث في التطبيقات..." /></label>
      {categories.map((category) => {
        const items = visible.filter((item) => item.category === category)
        if (!items.length) return null
        return (
          <div className="connectors-group" key={category}>
            <h3>{category}</h3>
            <div className="connectors-grid">
              {items.map(({ id, name, detail, Icon, color }) => {
                const active = connected.includes(id)
                return (
                  <article className={`connector-card ${active ? 'active' : ''}`} key={id}>
                    <span className={`connector-icon ${color}`}><Icon size={23} /></span>
                    <div><h2>{name}</h2><p>{detail}</p></div>
                    <button className={active ? 'connected' : ''} onClick={() => toggle(id)}>{active ? <><Check size={15} /> متصل</> : 'ربط'}</button>
                  </article>
                )
              })}
            </div>
          </div>
        )
      })}
      {visible.length === 0 && <p className="work-empty">لا تطبيقات مطابقة.</p>}
      <div className="privacy-note"><ShieldCheck size={20} /><div><strong>أنت تتحكم بالوصول</strong><span>يمكن فصل أي تطبيق في أي وقت. لا تُستخدم بياناتك لتدريب النماذج في هذا الوضع.</span></div></div>
    </section>
  )
}

export function SettingsPanel({ settings, capabilities, onChange, onProvidersChanged, onClearSessions, onExportData, onClose }: { settings: AppSettings; capabilities: ApiCapabilities; onChange: (next: Partial<AppSettings>) => void; onProvidersChanged: () => void; onClearSessions?: () => void; onExportData?: () => void; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'general' | 'chat' | 'providers' | 'data' | 'about'>('general')
  const connectedCount = capabilities.providers?.filter((item) => item.configured).length || 0
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
  const [confirmClear, setConfirmClear] = useState(false)
  const featureItems = [
    ['chat', 'المحادثة', MessageSquareText],
    ['webSearch', 'بحث الويب', Globe2],
    ['files', 'تحليل الملفات', FileText],
    ['vision', 'الرؤية', ImageIcon],
    ['video', 'تحليل الفيديو', Video],
    ['transcription', 'تفريغ الصوت', Mic],
    ['speech', 'توليد الصوت', Volume2],
  ] as const

  const clearLocal = (key: string) => { try { localStorage.removeItem(key) } catch {} }

  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="settings-drawer" role="dialog" aria-modal="true" aria-label="الإعدادات" onClick={(event) => event.stopPropagation()}>
        <div className="modal-heading"><div><span>حسابي</span><h2>الإعدادات</h2></div><button className="icon-button" onClick={onClose} aria-label="إغلاق"><X size={19} /></button></div>
        <div className="settings-profile"><span>N</span><div><strong>Nados AI</strong><small>{isLocal ? 'الإدارة الكاملة متاحة' : 'الإصدار المنتشر — الإدارة من النسخة المحلية'}</small></div><i className={connectedCount ? 'connected' : ''}>{connectedCount ? 'متصل' : 'تجريبي'}</i></div>
        <div className="settings-tabs settings-tabs--scroll" role="tablist" aria-label="أقسام الإعدادات">
          <button className={activeTab === 'general' ? 'active' : ''} role="tab" onClick={() => setActiveTab('general')}>عام</button>
          <button className={activeTab === 'chat' ? 'active' : ''} role="tab" onClick={() => setActiveTab('chat')}>المحادثة</button>
          {isLocal && <button className={activeTab === 'providers' ? 'active' : ''} role="tab" onClick={() => setActiveTab('providers')}>المزودات</button>}
          <button className={activeTab === 'data' ? 'active' : ''} role="tab" onClick={() => setActiveTab('data')}>البيانات</button>
          <button className={activeTab === 'about' ? 'active' : ''} role="tab" onClick={() => setActiveTab('about')}>عنا</button>
        </div>

        {activeTab === 'general' && (
          <>
            <div className="settings-group settings-card-general">
              <h3>المظهر</h3>
              <div className="settings-choice"><span>السمة</span><div className="segmented-control"><button className={!settings.dark ? 'active' : ''} onClick={() => onChange({ dark: false })}>نهاري</button><button className={settings.dark ? 'active' : ''} onClick={() => onChange({ dark: true })}>ليلي</button></div></div>
              <div className="settings-choice"><span>حجم الخط</span><div className="segmented-control"><button className={(settings.fontSize ?? 'md') === 'sm' ? 'active' : ''} onClick={() => onChange({ fontSize: 'sm' })}>صغير</button><button className={(settings.fontSize ?? 'md') === 'md' ? 'active' : ''} onClick={() => onChange({ fontSize: 'md' })}>متوسط</button><button className={settings.fontSize === 'lg' ? 'active' : ''} onClick={() => onChange({ fontSize: 'lg' })}>كبير</button></div></div>
              <div className="settings-choice"><span>اللغة</span><div className="segmented-control"><button className={settings.language === 'ar' ? 'active' : ''} onClick={() => onChange({ language: 'ar' })}>العربية</button><button className={settings.language === 'en' ? 'active' : ''} onClick={() => onChange({ language: 'en' })}>English</button></div></div>
            </div>
            <div className="settings-group">
              <h3>التفضيلات</h3>
              <SettingToggle icon={Sparkles} title="التفكير العميق افتراضياً" note="يبدأ كل سؤال جديد بوضع التفكير والبحث" checked={Boolean(settings.defaultThinking)} onChange={(value) => onChange({ defaultThinking: value })} />
              <SettingToggle icon={Bell} title="الإشعارات" note="تنبيه عند اكتمال إجابة طويلة أو مهمة" checked={Boolean(settings.notifications)} onChange={(value) => onChange({ notifications: value })} />
              <SettingToggle icon={Volume2} title="الردود الصوتية" note="إمكانية نطق الإجابات بصوت واضح" checked={Boolean(settings.voiceReplies)} onChange={(value) => onChange({ voiceReplies: value })} />
            </div>
          </>
        )}

        {activeTab === 'chat' && (
          <>
            <div className="settings-group settings-card-chat">
              <h3>الخصوصية والذاكرة</h3>
              <SettingToggle icon={ShieldCheck} title="الوضع الخفي" note="لا تحفظ المحادثات الجديدة" checked={settings.incognito} onChange={(value) => onChange({ incognito: value })} />
              <SettingToggle icon={Sparkles} title="ذاكرة المحادثة" note="يتذكر Nados الرسائل السابقة داخل المحادثة" checked={settings.memory} onChange={(value) => onChange({ memory: value })} />
              <SettingToggle icon={BookOpen} title="إظهار المصادر" note="أرفق المراجع مع الإجابات" checked={settings.citations} onChange={(value) => onChange({ citations: value })} />
            </div>
            <div className="settings-group">
              <h3>التخصيص</h3>
              <div className="settings-choice"><span>عمق الذاكرة الممتدة</span><div className="segmented-control"><button className={(settings.memoryDepth ?? 'balanced') === 'full' ? 'active' : ''} onClick={() => onChange({ memoryDepth: 'full' })}>كامل</button><button className={(settings.memoryDepth ?? 'balanced') === 'balanced' ? 'active' : ''} onClick={() => onChange({ memoryDepth: 'balanced' })}>متوازن</button><button className={settings.memoryDepth === 'off' ? 'active' : ''} onClick={() => onChange({ memoryDepth: 'off' })}>موقوف</button></div><small>«كامل» يحتفظ بسياق أطول من المحادثة (ذاكرة ممتدة)، و«موقوف» يرسل آخر الرسائل فقط.</small></div>
              <div className="settings-prompt">
                <label htmlFor="system-prompt">التعليمات الأساسية (System Prompt)</label>
                <textarea id="system-prompt" value={settings.systemPrompt || ''} onChange={(event) => onChange({ systemPrompt: event.target.value })} rows={4} maxLength={2000} placeholder="تعليمات مخصصة تتبعها Nados في كل محادثة — مثال: أجب بإيجاز وبأسلوب تقني." dir="auto" />
                <small>{(settings.systemPrompt || '').length}/2000</small>
              </div>
              <div className="settings-choice"><span>درجة الإبداع (Temperature)</span><div className="temperature-slider"><input type="range" min="0" max="2" step="0.1" value={settings.temperature ?? 0.7} onChange={(event) => onChange({ temperature: Number(event.target.value) })} aria-label="درجة الإبداع" /><strong dir="ltr">{(settings.temperature ?? 0.7).toFixed(1)}</strong></div><small>{(settings.temperature ?? 0.7) < 0.4 ? 'دقيق ومحافظ' : (settings.temperature ?? 0.7) > 1.2 ? 'إبداعي وتنوع أعلى' : 'متوازن'}</small></div>
            </div>
          </>
        )}

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

        {activeTab === 'data' && (
          <>
            <div className="settings-group">
              <h3>بياناتك</h3>
              <button className="settings-link" onClick={() => onExportData?.()}><Download size={17} /><span>تصدير المحادثات والإعدادات</span><ArrowLeft size={16} /></button>
              <button className="settings-link" onClick={() => { clearLocal('nados-discover-saved'); clearLocal('nados-connectors') }}><Trash2 size={17} /><span>مسح العناصر المحفوظة والتطبيقات المتصلة</span><ArrowLeft size={16} /></button>
              <button className="settings-link" onClick={() => onChange({ systemPrompt: '', temperature: 0.7, incognito: false, memory: true, citations: true, fontSize: 'md', notifications: false, voiceReplies: false, defaultThinking: false })}><RefreshCw size={17} /><span>استعادة الإعدادات الافتراضية</span><ArrowLeft size={16} /></button>
            </div>
            <div className="settings-group danger-zone">
              <h3>منطقة الخطر</h3>
              <p>حذف كل المحادثات نهائياً من هذا الجهاز. لا يمكن التراجع.</p>
              {confirmClear ? (
                <div className="danger-actions">
                  <button className="secondary-command danger" onClick={() => { onClearSessions?.(); setConfirmClear(false) }}>تأكيد حذف كل المحادثات</button>
                  <button className="secondary-command" onClick={() => setConfirmClear(false)}>إلغاء</button>
                </div>
              ) : (
                <button className="secondary-command danger" onClick={() => setConfirmClear(true)}><ShieldAlert size={16} /> حذف كل المحادثات</button>
              )}
            </div>
          </>
        )}

        {activeTab === 'about' && (
          <>
            <div className="settings-group settings-about-card">
              <span className="about-logo">N</span>
              <strong>Nados (نادوس)</strong>
              <small>أول نموذج ذكاء اصطناعي عراقي بالكامل · الإصدار Nados v1.1</small>
              <div className="about-badges">
                <span>عراقي بالكامل</span>
                <span>نموذجنا المدرَّب وحده</span>
                <span>عربي أولاً</span>
                <span>ويب + Android</span>
              </div>
              <p className="about-desc">Nados يعمل بنموذجنا المدرَّب <b>Nados v1.1</b> وحده — دون أي مزوّد ذكاء اصطناعي خارجي. نموذج مدرَّب بتخصيص LoRA فوق قاعدة مفتوحة، يخدمه خادم خاص (CPU خارجي)، مع ذاكرة ممتدة تحافظ على سياق المحادثة الطويلة.</p>
              <ul className="about-features">
                <li>محادثة عربية أولاً: فصحى ولهجات، بإجابات مباشرة ومركّزة.</li>
                <li>ذاكرة ممتدة: آخر الرسائل حرفياً + الأكثر صلة + تلخيص للأقدم.</li>
                <li>تفكير عميق ممنهج بخمس مراحل عند تفعيل «تفكير».</li>
                <li>معرفة التاريخ والوقت الحاليين تلقائياً في كل رد.</li>
                <li>نفس النموذج على الويب وتطبيق Android بنفس الجودة.</li>
                <li>خصوصية: لا تُرسل مفاتيحك ولا أسرارك داخل التطبيق.</li>
              </ul>
              <div className="about-meta">
                <div><span>المطوّر</span><strong>عبدالنور محمد إبراهيم</strong></div>
                <div><span>المزوّدات المتصلة</span><strong>{connectedCount}</strong></div>
                <div><span>ميزات مفعّلة</span><strong>{featureItems.filter(([id]) => capabilities.features[id]).length}/{featureItems.length}</strong></div>
                <div><span>المحاذاة</span><strong>{settings.language === 'ar' ? 'العربية' : 'English'}</strong></div>
              </div>
            </div>
            <div className="settings-group">
              <h3>روابط</h3>
              <button className="settings-link" onClick={() => window.open('https://kilo.ai/docs', '_blank', 'noopener')}><Globe2 size={17} /><span>التوثيق والمساعدة</span><ArrowLeft size={16} /></button>
              <button className="settings-link" onClick={() => window.open('https://github.com/Kilo-Org/kilocode/issues', '_blank', 'noopener')}><MessageSquareText size={17} /><span>الإبلاغ عن مشكلة</span><ArrowLeft size={16} /></button>
            </div>
          </>
        )}
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
