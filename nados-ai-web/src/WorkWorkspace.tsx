import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Code2,
  Download,
  ExternalLink,
  File,
  FileArchive,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react'
import * as api from './workApi'
import type { CommandResult, WorkDiff, WorkFileChange, WorkRun, WorkServerInfo, WorkStatus, WorkStep, WorkTreeNode, WorkVerification } from './workApi'

const STATUS_LABELS: Record<string, string> = {
  idle: 'جاهز',
  created: 'أُنشئ',
  planning: '🧠 التخطيط',
  running: '⚙️ التنفيذ',
  waiting_approval: 'بانتظار الموافقة',
  testing: '🧪 الاختبار',
  fixing: '🔧 الإصلاح',
  previewing: '🌐 المعاينة',
  completed: '✅ اكتمل',
  completed_with_warnings: '⚠️ اكتمل مع تحذيرات',
  failed: '❌ فشل',
  paused: '⏸ متوقف مؤقتاً',
  stalled: '⚠️ توقف عن التقدم',
  cancelled: '⛔ أُلغي',
  pausing: '⏸ جارٍ الإيقاف',
  ready: 'جاهز',
  modified: 'معدّل',
}

const STACK_OPTIONS = [
  { id: 'static', label: 'HTML/CSS/JS' },
  { id: 'react-vite', label: 'React + Vite' },
  { id: 'node-api', label: 'Node.js API' },
  { id: 'python', label: 'Python' },
]

const TERMINAL_HINTS = ['npm install', 'npm run build', 'npm test', 'git status', 'node --version']

type LeftView = 'files' | 'editor' | 'terminal'

export function WorkWorkspace() {
  const [status, setStatus] = useState<WorkStatus | null>(null)
  const [projects, setProjects] = useState<api.WorkProject[]>([])
  const [activeId, setActiveId] = useState('')
  const [project, setProject] = useState<api.WorkProject | null>(null)
  const [tree, setTree] = useState<WorkTreeNode[]>([])
  const [changes, setChanges] = useState<WorkFileChange[]>([])
  const [stats, setStats] = useState({ files: 0, bytes: 0 })
  const [server, setServer] = useState<WorkServerInfo | null>(null)
  const [run, setRun] = useState<WorkRun | null>(null)
  const [agentStatus, setAgentStatus] = useState('idle')
  const [agentLog, setAgentLog] = useState<Array<{ at: string; text: string; kind: string }>>([])
  const [verification, setVerification] = useState<WorkVerification | null>(null)
  const [task, setTask] = useState('')
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [leftView, setLeftView] = useState<LeftView>('files')
  const [busy, setBusy] = useState(false)

  const [openFile, setOpenFile] = useState<{ path: string; content: string } | null>(null)
  const [editorKey, setEditorKey] = useState(0)
  const [diff, setDiff] = useState<WorkDiff | null>(null)
  const [readOnly, setReadOnly] = useState(false)
  const [fileSearch, setFileSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ file: string; line: number; snippet: string }>>([])

  const [commandInput, setCommandInput] = useState('')
  const [commandLog, setCommandLog] = useState<Array<CommandResult & { at: string }>>([])

  const [newProject, setNewProject] = useState({ name: '', stack: 'static' })
  const [previewNonce, setPreviewNonce] = useState(0)

  const abortRef = useRef<AbortController | null>(null)

  const notify = (kind: 'error' | 'info', text: string) => setNotice({ kind, text })

  const serverErrorText = (error: unknown) => {
    const message = (error as Error).message || ''
    return /HTTP 5\d\d|Failed to fetch|NetworkError|Load failed|fetch/i.test(message)
      ? 'تعذّر الوصول إلى خادم Nados. شغّل الخادم المحلي (npm run dev) واضبط واجهة API.'
      : message
  }

  const refreshStatus = useCallback(async () => {
    try { setStatus(await api.getWorkStatus()) } catch (error) { notify('error', `تعذّر فحص بيئة التنفيذ: ${serverErrorText(error)}`) }
  }, [])

  const refreshProjects = useCallback(async () => {
    try {
      const body = await api.listWorkProjects()
      setProjects(body.projects || [])
      if (!activeId && body.projects?.length) setActiveId(body.projects[0].id)
    } catch (error) { notify('error', `تعذّر جلب المشاريع: ${serverErrorText(error)}`) }
  }, [activeId])

  const loadProject = useCallback(async (id: string) => {
    try {
      const body = await api.getWorkProject(id)
      setProject(body.project)
      setTree(body.tree || [])
      setChanges(body.changes || [])
      setStats(body.stats || { files: 0, bytes: 0 })
      setServer(body.server || null)
      setRun(body.run || null)
      if (body.run?.steps?.length) setAgentStatus(body.run.status)
    } catch (error) { notify('error', `تعذّر جلب المشروع: ${(error as Error).message}`) }
  }, [])

  useEffect(() => { void refreshStatus() }, [refreshStatus])
  useEffect(() => { void refreshProjects() }, [refreshProjects])
  useEffect(() => {
    if (!activeId) { setProject(null); setTree([]); setOpenFile(null); return }
    void loadProject(activeId)
  }, [activeId, loadProject])

  const pushLog = (text: string, kind = 'info') => setAgentLog((current) => [...current.slice(-200), { at: new Date().toISOString(), text, kind }])

  const createProject = async () => {
    if (!newProject.name.trim()) { notify('error', 'اسم المشروع مطلوب.'); return }
    setBusy(true)
    try {
      const body = await api.createWorkProject({ name: newProject.name.trim(), stack: newProject.stack })
      setNewProject({ name: '', stack: 'static' })
      pushLog(`أُنشئ المشروع ${body.project.name} (${body.project.stackLabel}) — ${body.fileCount} ملفات فعلية.`, 'success')
      await refreshProjects()
      setActiveId(body.project.id)
      notify('info', `تم إنشاء المشروع فعلياً على القرص: ${body.project.id}`)
    } catch (error) { notify('error', (error as Error).message) } finally { setBusy(false) }
  }

  const removeProject = async () => {
    if (!project) return
    if (!window.confirm(`حذف المشروع «${project.name}» ومجلد مساحته بالكامل؟`)) return
    setBusy(true)
    try {
      await api.deleteWorkProject(project.id)
      setActiveId('')
      setProject(null)
      setOpenFile(null)
      setTree([])
      await refreshProjects()
      notify('info', 'تم حذف المشروع ومساحة عمله.')
    } catch (error) { notify('error', (error as Error).message) } finally { setBusy(false) }
  }

  const reloadFiles = async () => {
    if (!activeId) return
    try {
      const [treeBody, changesBody] = await Promise.all([api.getWorkTree(activeId), api.getWorkChanges(activeId)])
      setTree(treeBody.tree || [])
      setChanges(changesBody.changes || [])
    } catch {}
  }

  const openPath = async (path: string) => {
    if (!activeId) return
    try {
      const body = await api.readWorkFile(activeId, path)
      setOpenFile({ path: body.path, content: body.content })
      setEditorKey((value) => value + 1)
      setDiff(null)
      setLeftView('editor')
      notify('info', `فُتح ${body.path} (${body.bytes} بايت).`)
    } catch (error) { notify('error', (error as Error).message) }
  }

  const saveOpenFile = async (path: string, draft: string) => {
    if (!activeId) return
    try {
      const result = await api.writeWorkFile(activeId, path, draft)
      setOpenFile({ path, content: draft })
      pushLog(`كُتب ${result.path} فعلياً (${result.bytes} بايت).`, 'success')
      await reloadFiles()
      // Refresh the preview for static projects too, not only running servers.
      setPreviewNonce((value) => value + 1)
    } catch (error) { notify('error', (error as Error).message) }
  }

  const runCommand = async (command?: string) => {
    const cmd = (command ?? commandInput).trim()
    if (!activeId || !cmd) return
    setBusy(true)
    try {
      const result = await api.runWorkCommand(activeId, cmd)
      setCommandLog((current) => [{ ...result, at: new Date().toISOString() }, ...current].slice(0, 40))
      setCommandInput('')
      setLeftView('terminal')
      if (result.exitCode === 0) pushLog(`نُفّذ الأمر بنجاح: ${cmd}`, 'success')
      else pushLog(`فشل الأمر (${result.exitCode}): ${cmd}`, 'error')
      await reloadFiles()
    } catch (error) {
      const result: CommandResult & { at: string } = { status: 'error', exitCode: null, stdout: '', stderr: (error as Error).message, durationMs: 0, at: new Date().toISOString(), error: (error as Error).message }
      setCommandLog((current) => [result, ...current].slice(0, 40))
      notify('error', (error as Error).message)
    } finally { setBusy(false) }
  }

  const startPreview = async () => {
    if (!activeId) return
    setBusy(true)
    try {
      const result = await api.startWorkServer(activeId)
      if (!result.started) {
        notify('error', result.error || 'لم يبدأ خادم المشروع.')
        pushLog(`❌ لم يبدأ الخادم: ${result.error || 'غير معروف'}`, 'error')
      } else {
        pushLog(`بدأ الخادم على المنفذ ${result.port} (HTTP ${result.httpStatus ?? '—'}).`, 'success')
        notify('info', `المعاينة جاهزة على المنفذ ${result.port}`)
        await loadProject(activeId)
        setPreviewNonce((value) => value + 1)
      }
    } catch (error) { notify('error', (error as Error).message); pushLog(`❌ ${(error as Error).message}`, 'error') } finally { setBusy(false) }
  }

  const stopPreview = async () => {
    if (!activeId) return
    setBusy(true)
    try {
      await api.stopWorkServer(activeId)
      setServer(null)
      pushLog('أُوقف خادم المشروع فعلياً.', 'info')
    } catch (error) { notify('error', (error as Error).message) } finally { setBusy(false) }
  }

  const handleEvent = (event: api.WorkEvent) => {
    const type = String(event.type)
    switch (type) {
      case 'agent_start':
        setAgentStatus('running')
        setStepsFromEvent([])
        setVerification(null)
        pushLog(`بدأ الوكيل المهمة على ${event.stack}.`, 'info')
        break
      case 'tool_started':
        setRun((current) => {
          const step: WorkStep = {
            id: String(event.step), type: 'tool', status: 'running', description: String(event.description || event.tool),
            tool: String(event.tool), arguments: (event.parameters as Record<string, unknown>) || {}, result: null, error: null,
            startedAt: new Date().toISOString(), completedAt: null, durationMs: null,
          }
          const steps = [...(current?.steps || []), step]
          return { ...(current || emptyRun()), steps }
        })
        pushLog(`${String(event.description || event.tool)}…`, 'running')
        break
      case 'tool_completed':
      case 'tool_failed':
        setRun((current) => {
          if (!current) return current
          const steps = current.steps.map((step) => step.id === String(event.step) && step.status === 'running'
            ? { ...step, status: String(event.status), result: (event.result as Record<string, unknown>) || null, error: (event.error as string) || null, completedAt: new Date().toISOString(), durationMs: Number(event.durationMs) || null }
            : step)
          return { ...current, steps }
        })
        pushLog(`${type === 'tool_failed' ? '❌' : '✓'} ${String(event.tool)}${event.path ? ` → ${String(event.path)}` : ''} (${Number(event.durationMs) || 0}ms)${event.error ? ` — ${String(event.error).slice(0, 160)}` : ''}`, type === 'tool_failed' ? 'error' : 'success')
        break
      case 'build_started':
      case 'test_started':
        pushLog(`${type === 'build_started' ? 'بدء البناء' : 'بدء الاختبارات'}: ${String(event.command || '')}`, 'running')
        break
      case 'build_completed':
        pushLog(`اكتمل البناء (${String(event.status)}).`, 'success')
        break
      case 'test_completed':
        pushLog('اكتملت الاختبارات.', 'success')
        break
      case 'verify_passed':
        pushLog(`✓ تحقق: ${String(event.label || '')}`, 'success')
        break
      case 'verify_failed':
        pushLog(`❌ فشل تحقق: ${String(event.label || event.command || '')}`, 'error')
        break
      case 'verification_completed':
        setVerification({ allPassed: Boolean(event.allPassed), results: (event.results as WorkVerification['results']) || [] })
        pushLog(event.allPassed ? 'اكتمل التحقق بنجاح.' : 'التحقق لم ينجح بالكامل.', event.allPassed ? 'success' : 'error')
        break
      case 'auto_fix_attempt':
        pushLog(`🔧 محاولة إصلاح تلقائي ${event.attempt}/${event.max}…`, 'running')
        break
      case 'agent_stalled':
        setAgentStatus('stalled')
        pushLog(`⚠️ ${String(event.message || 'توقف الوكيل عن إحراز تقدم')}`, 'error')
        break
      case 'agent_model':
        pushLog(`🧠 الموديل الأساسي للعمل: ${String(event.providerId)} · ${String(event.model)} (${String(event.targets)} هدفاً للتبديل)`, 'info')
        break
      case 'agent_model_fallback':
        pushLog(`↩️ تبديل إلى: ${String(event.providerId)} · ${String(event.model)}`, 'info')
        break
      case 'agent_nudge':
        pushLog(`↻ تنبيه الوكيل: لم يُنفّذ أداة بعد — إعادة التوجيه (${String(event.attempt)})`, 'running')
        break
      case 'agent_done':
        setAgentStatus(String(event.status))
        if (Array.isArray(event.steps)) setStepsFromEvent(event.steps as WorkStep[])
        pushLog(`انتهى الوكيل بحالة: ${STATUS_LABELS[String(event.status)] || event.status}.`, String(event.status) === 'failed' ? 'error' : 'success')
        break
      case 'task_completed': {
        const result = event as unknown as { status: string; summary: string; filesChanged: string[]; verification?: WorkVerification; autoFixAttempts?: number; durationMs?: number; steps?: WorkStep[] }
        setAgentStatus(result.status)
        if (Array.isArray(result.steps)) setStepsFromEvent(result.steps)
        if (result.verification) setVerification(result.verification)
        setRun((current) => ({ ...(current || emptyRun()), status: result.status, summary: result.summary || '', filesChanged: result.filesChanged || [], durationMs: result.durationMs || null }))
        pushLog(`اكتملت المهمة: ${result.summary?.slice(0, 300) || ''}`, result.status === 'failed' ? 'error' : 'success')
        void loadProject(activeId)
        break
      }
      case 'error':
        setAgentStatus('failed')
        pushLog(`❌ ${String(event.message || 'خطأ غير معروف')}`, 'error')
        notify('error', String(event.message || 'خطأ غير معروف'))
        break
      default:
        break
    }
  }

  const setStepsFromEvent = (steps: WorkStep[]) => {
    setRun((current) => ({ ...(current || emptyRun()), steps }))
  }

  const runAgent = async () => {
    if (!activeId || !task.trim()) { notify('error', 'اكتب المهمة أولاً.'); return }
    setBusy(true)
    setLeftView('files')
    setAgentLog([])
    setRun({ ...emptyRun(), task: task.trim(), status: 'running' })
    setAgentStatus('running')
    setVerification(null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      await api.runWorkAgent(activeId, task.trim(), handleEvent, controller.signal)
      setTask('')
    } catch (error) {
      if ((error as Error).name !== 'AbortError') notify('error', (error as Error).message)
      else pushLog('أُوقفت المهمة بواسطة المستخدم.', 'info')
    } finally {
      abortRef.current = null
      setBusy(false)
      await reloadFiles()
    }
  }

  const control = async (action: 'stop' | 'pause' | 'resume') => {
    if (!activeId) return
    try {
      await api.controlWorkRun(activeId, action)
      pushLog(action === 'stop' ? 'طُلب إيقاف المهمة.' : action === 'pause' ? 'طُلب الإيقاف المؤقت.' : 'استُؤنفت المهمة.', 'info')
      if (action === 'stop') { abortRef.current?.abort(); setAgentStatus('cancelled') }
    } catch (error) { notify('error', (error as Error).message) }
  }

  const verify = async () => {
    if (!activeId) return
    setBusy(true)
    try {
      const result = await api.verifyWorkProject(activeId)
      setVerification(result)
      pushLog(result.allPassed ? 'نتيجة التحقق: نجاح كامل.' : 'نتيجة التحقق: بعض الفحوصات فشلت.', result.allPassed ? 'success' : 'error')
      await loadProject(activeId)
    } catch (error) { notify('error', (error as Error).message) } finally { setBusy(false) }
  }

  const viewDiff = async (path: string) => {
    if (!activeId) return
    try {
      const result = await api.getWorkDiff(activeId, path)
      setDiff(result)
      setOpenFile({ path, content: result.after || result.before || '' })
      setEditorKey((value) => value + 1)
      setLeftView('editor')
    } catch (error) { notify('error', (error as Error).message) }
  }

  const doSearch = async () => {
    if (!activeId || !fileSearch.trim()) return
    try {
      const result = await api.searchWorkFiles(activeId, fileSearch.trim())
      setSearchResults(result.results || [])
      if (!result.results?.length) notify('info', 'لا نتائج مطابقة.')
    } catch (error) { notify('error', (error as Error).message) }
  }

  const createNode = async (dir: string, kind: 'file' | 'dir') => {
    if (!activeId) return
    const name = window.prompt(kind === 'file' ? 'اسم الملف الجديد (مع الامتداد):' : 'اسم المجلد الجديد:')
    if (!name) return
    const path = dir && dir !== '.' ? `${dir}/${name}` : name
    try {
      await api.workFileAction(activeId, kind === 'file' ? 'create_file' : 'create_dir', { path, content: '' })
      pushLog(`أُنشئ ${kind === 'file' ? 'الملف' : 'المجلد'} ${path} فعلياً.`, 'success')
      await reloadFiles()
    } catch (error) { notify('error', (error as Error).message) }
  }

  const renameNode = async (path: string) => {
    if (!activeId) return
    const name = window.prompt('الاسم الجديد:', path.split('/').pop())
    if (!name) return
    try {
      await api.workFileAction(activeId, 'rename', { path, name })
      pushLog(`أُعيدت تسمية ${path} إلى ${name}.`, 'success')
      if (openFile?.path === path) setOpenFile(null)
      await reloadFiles()
    } catch (error) { notify('error', (error as Error).message) }
  }

  const deleteNode = async (path: string) => {
    if (!activeId) return
    if (!window.confirm(`حذف ${path} من مساحة العمل فعلياً؟`)) return
    try {
      await api.workFileAction(activeId, 'delete', { path })
      pushLog(`حُذف ${path} فعلياً.`, 'info')
      if (openFile?.path === path) setOpenFile(null)
      await reloadFiles()
    } catch (error) { notify('error', (error as Error).message) }
  }

  const downloadFile = async (path: string) => {
    if (!activeId) return
    try { await api.downloadWorkFile(activeId, path) } catch (error) { notify('error', (error as Error).message) }
  }

  const downloadZip = async () => {
    if (!activeId || !project) return
    setBusy(true)
    try {
      await api.downloadWorkZip(activeId, project.name)
      pushLog('صُدّر المشروع كأرشيف ZIP حقيقي.', 'success')
    } catch (error) { notify('error', (error as Error).message) } finally { setBusy(false) }
  }

  const modifiedPaths = useMemo(() => new Set(changes.map((change) => change.path)), [changes])
  const running = agentStatus === 'running' || agentStatus === 'pausing'
  const steps = run?.steps || []

  return (
    <section className="work-view">
      <header className="work-header">
        <div className="work-header-title">
          <Zap size={20} />
          <div>
            <h2>وضع العمل — تنفيذ حقيقي</h2>
            <p>{project ? `${project.name} · ${project.stackLabel}` : 'أنشئ مشروعاً لبدء التنفيذ الفعلي'}</p>
          </div>
        </div>
        <div className="work-header-actions">
          {status?.workModel ? (
            <span className="work-model-pill" dir="ltr" title="نموذج العمل الأساسي">
              <Zap size={12} /> {status.workModel.providerId} · {status.workModel.model}
            </span>
          ) : null}
          <span className={`work-status-pill ${status?.executionAvailable ? 'online' : 'offline'}`}>
            {status?.executionAvailable ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
            {status?.executionAvailable ? `بيئة التنفيذ متاحة (${status.provider})` : 'بيئة التنفيذ غير متاحة'}
          </span>
          <button className="icon-button" onClick={() => void refreshStatus()} aria-label="تحديث الحالة"><RefreshCw size={16} /></button>
        </div>
      </header>

      {status && !status.executionAvailable && (
        <div className="work-banner work-banner--error">
          <AlertTriangle size={16} />
          <div>
            <strong>⚠️ Execution environment unavailable</strong>
            <p>لا يمكن تنفيذ ملفات أو أوامر حقيقية الآن. السبب: {status.executionError || 'غير معروف'}</p>
          </div>
        </div>
      )}

      {notice && (
        <div className={`work-banner work-banner--${notice.kind}`}>
          {notice.kind === 'error' ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
          <div><p>{notice.text}</p></div>
          <button className="icon-button" onClick={() => setNotice(null)} aria-label="إغلاق"><XCircle size={15} /></button>
        </div>
      )}

      <div className="work-toolbar">
        <select value={activeId} onChange={(event) => setActiveId(event.target.value)} aria-label="اختيار المشروع" disabled={!projects.length}>
          {!projects.length && <option value="">لا مشاريع بعد</option>}
          {projects.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.stackLabel}</option>)}
        </select>
        <input value={newProject.name} onChange={(event) => setNewProject({ ...newProject, name: event.target.value })} placeholder="اسم مشروع جديد" aria-label="اسم المشروع الجديد" />
        <select value={newProject.stack} onChange={(event) => setNewProject({ ...newProject, stack: event.target.value })} aria-label="نوع المشروع">
          {STACK_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <button className="work-button" onClick={() => void createProject()} disabled={busy || !newProject.name.trim()}><Plus size={15} /> إنشاء مشروع</button>
        {project && <button className="work-button work-button--danger" onClick={() => void removeProject()} disabled={busy}><Trash2 size={15} /> حذف</button>}
        {project && <button className="work-button" onClick={() => void downloadZip()} disabled={busy}><FileArchive size={15} /> تحميل ZIP</button>}
      </div>

      <div className="work-grid">
        <section className="work-panel work-panel--left">
          <div className="work-panel-head">
            <div className="work-left-switch" role="tablist" aria-label="أدوات مساحة العمل">
              <button className={leftView === 'files' ? 'active' : ''} onClick={() => setLeftView('files')} role="tab" aria-selected={leftView === 'files'}><Folder size={14} /> الملفات</button>
              <button className={leftView === 'editor' ? 'active' : ''} onClick={() => setLeftView('editor')} role="tab" aria-selected={leftView === 'editor'}><Code2 size={14} /> المحرر</button>
              <button className={leftView === 'terminal' ? 'active' : ''} onClick={() => setLeftView('terminal')} role="tab" aria-selected={leftView === 'terminal'}><TerminalIcon size={14} /> الطرفية</button>
            </div>
            <div className="work-panel-tools">
              {leftView === 'files' && <>
                <button className="icon-button" title="ملف جديد" onClick={() => void createNode('.', 'file')}><FilePlus2 size={15} /></button>
                <button className="icon-button" title="مجلد جديد" onClick={() => void createNode('.', 'dir')}><FolderPlus size={15} /></button>
                <button className="icon-button" title="تحديث" onClick={() => void reloadFiles()}><RefreshCw size={15} /></button>
              </>}
              {leftView === 'editor' && <>
                {openFile && <button className={`work-chip ${readOnly ? 'active' : ''}`} onClick={() => setReadOnly((value) => !value)}>{readOnly ? 'قراءة فقط' : 'تحرير'}</button>}
                {diff && <button className="work-chip" onClick={() => setDiff(null)}>إغلاق الفرق</button>}
              </>}
              {leftView === 'terminal' && <button className="work-chip" onClick={() => setCommandLog([])}>مسح</button>}
            </div>
          </div>

          {leftView === 'files' && <>
            <div className="work-search">
              <Search size={14} />
              <input value={fileSearch} onChange={(event) => setFileSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void doSearch() }} placeholder="بحث في الملفات..." aria-label="بحث في الملفات" />
            </div>
            {searchResults.length > 0 && (
              <div className="work-search-results">
                {searchResults.map((result) => (
                  <button key={`${result.file}:${result.line}`} onClick={() => void openPath(result.file)}>
                    <strong dir="ltr">{result.file}:{result.line}</strong>
                    <small dir="auto">{result.snippet}</small>
                  </button>
                ))}
                <button className="work-search-clear" onClick={() => setSearchResults([])}>إغلاق النتائج</button>
              </div>
            )}
            <div className="work-tree">
              {!tree.length && <p className="work-empty">لا ملفات — أنشئ مشروعاً أو أضف ملفاً.</p>}
              {tree.map((node) => (
                <TreeNode key={node.path} node={node} modified={modifiedPaths} activePath={openFile?.path || ''} onOpen={(path) => void openPath(path)} onNew={(dir, kind) => void createNode(dir, kind)} onRename={(path) => void renameNode(path)} onDelete={(path) => void deleteNode(path)} onDownload={(path) => void downloadFile(path)} />
              ))}
            </div>
          </>}

          {leftView === 'editor' && (
            diff ? (
              <div className="work-diff">
                <div className="work-diff-head">
                  <span dir="ltr">{diff.path}</span>
                  <span className="work-diff-stats">+{diff.diff.added} / −{diff.diff.removed}</span>
                </div>
                <div className="work-diff-body" dir="ltr">
                  {diff.diff.lines.map((line, index) => (
                    <div key={index} className={`work-diff-line ${line.type}`}>
                      <span className="work-diff-marker">{line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}</span>
                      <code>{line.type === 'add' ? line.right : line.left}</code>
                    </div>
                  ))}
                </div>
              </div>
            ) : openFile ? (
              <EditorPane key={`${openFile.path}-${editorKey}`} path={openFile.path} content={openFile.content} readOnly={readOnly} onSave={saveOpenFile} />
            ) : (
              <p className="work-empty">اختر ملفاً من تبويب الملفات لعرضه وتحريره فعلياً.</p>
            )
          )}

          {leftView === 'terminal' && <>
            <div className="work-terminal-input">
              <span dir="ltr">$</span>
              <input value={commandInput} onChange={(event) => setCommandInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runCommand() }} placeholder="npm run build" aria-label="أمر الطرفية" dir="ltr" />
              <button className="work-button work-button--primary" onClick={() => void runCommand()} disabled={busy || !commandInput.trim() || !status?.executionAvailable}>تنفيذ</button>
            </div>
            <div className="work-hints">
              {TERMINAL_HINTS.map((hint) => <button key={hint} className="work-chip" onClick={() => void runCommand(hint)} dir="ltr">{hint}</button>)}
            </div>
            <div className="work-terminal-output" dir="ltr">
              {!commandLog.length && <p className="work-empty" dir="rtl">لا أوامر بعد — نفّذ أمراً حقيقياً داخل مساحة العمل.</p>}
              {commandLog.map((entry, index) => (
                <div key={index} className={`work-cmd cmd-${entry.status}`}>
                  <div className="work-cmd-head">
                    <span className="work-cmd-prompt">$</span>
                    <code>{entry.command || commandInput}</code>
                    <span className={`work-cmd-code ${entry.exitCode === 0 ? 'ok' : 'fail'}`}>exit {entry.exitCode ?? '—'}</span>
                    <span className="work-cmd-time">{entry.durationMs}ms</span>
                    <span className={`work-cmd-status ${entry.status}`}>{entry.status}</span>
                  </div>
                  {entry.stdout ? <pre>{entry.stdout}</pre> : null}
                  {entry.stderr ? <pre className="stderr">{entry.stderr}</pre> : null}
                </div>
              ))}
            </div>
          </>}
        </section>

        <section className="work-panel work-panel--preview">
          <div className="work-panel-head">
            <h3><Globe size={15} /> المعاينة</h3>
            <div className="work-panel-tools">
              <button className="work-button work-button--primary" onClick={() => void startPreview()} disabled={busy || !project || !status?.executionAvailable}><Play size={14} /> تشغيل الخادم</button>
              <button className="work-button" onClick={() => void stopPreview()} disabled={busy || !server}><Square size={14} /> إيقاف</button>
              <button className="icon-button" title="تحديث المعاينة" onClick={() => setPreviewNonce((value) => value + 1)}><RefreshCw size={15} /></button>
              {project && <a className="icon-button" href={api.workPreviewUrl(project.id)} target="_blank" rel="noreferrer" title="فتح في تبويب جديد"><ExternalLink size={15} /></a>}
            </div>
          </div>
          <div className="work-preview-meta">
            {server?.port
              ? <span className="work-preview-pill ok">▶ يعمل على المنفذ {server.port} — {server.command}</span>
              : <span className="work-preview-pill">الخادم متوقف — المشاريع الثابتة تُعرض مباشرة من الملفات</span>}
          </div>
          {project ? (
            <iframe
              key={`${project.id}-${previewNonce}`}
              className="work-preview-frame"
              src={`${api.workPreviewUrl(project.id)}?t=${previewNonce}`}
              title="معاينة المشروع"
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
            />
          ) : <p className="work-empty">لا مشروع للمعاينة.</p>}
          {server?.logs?.length ? (
            <div className="work-server-logs" dir="ltr">
              {server.logs.slice(-12).map((line, index) => <div key={index}>{line}</div>)}
            </div>
          ) : null}
        </section>

        <section className="work-panel work-panel--agent">
          <div className="work-panel-head">
            <h3><Zap size={15} /> محادثة العمل</h3>
            <span className={`work-run-state state-${agentStatus}`}>{STATUS_LABELS[agentStatus] || agentStatus}</span>
          </div>
          <textarea className="work-task" value={task} onChange={(event) => setTask(event.target.value)} placeholder="اكتب المهمة... مثال: أنشئ صفحة هبوط عربية RTL" aria-label="مهمة الوكيل" dir="auto" />
          <div className="work-agent-actions">
            <button className="work-button work-button--primary" onClick={() => void runAgent()} disabled={busy || running || !project || !status?.executionAvailable}><Play size={15} /> تشغيل</button>
            <button className="work-button" onClick={() => void control('pause')} disabled={!running}><Pause size={15} /> إيقاف مؤقت</button>
            <button className="work-button" onClick={() => void control('resume')} disabled={running}><Play size={15} /> استئناف</button>
            <button className="work-button work-button--danger" onClick={() => void control('stop')} disabled={!running}><Square size={15} /> إيقاف</button>
            <button className="work-button" onClick={() => void verify()} disabled={busy || !project}><CheckCircle2 size={15} /> تحقق</button>
          </div>
          {running && <div className="work-progress"><Loader2 size={14} className="spin" /> {STATUS_LABELS[agentStatus] || agentStatus}…</div>}

          <div className="work-steps">
            {!steps.length && <p className="work-empty">لا خطوات بعد — شغّل مهمة ليرى الوكيل الملفات والأوامر الحقيقية.</p>}
            {steps.map((step) => (
              <div key={step.id} className={`work-step step-${step.status}`}>
                <span className="work-step-icon">{step.status === 'running' ? <Loader2 size={13} className="spin" /> : step.status === 'success' ? <CheckCircle2 size={13} /> : <XCircle size={13} />}</span>
                <div>
                  <strong dir="auto">{step.description || step.tool}</strong>
                  {step.error ? <small dir="auto" className="work-step-error">{String(step.error).slice(0, 200)}</small> : null}
                  <small>{step.durationMs != null ? `${step.durationMs}ms` : step.status}</small>
                </div>
              </div>
            ))}
          </div>

          {run?.summary && <div className="work-summary" dir="auto"><strong>الملخص:</strong> {run.summary}</div>}

          {verification && (
            <div className="work-verification">
              <div className={`work-verification-head ${verification.allPassed ? 'ok' : 'fail'}`}>
                {verification.allPassed ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                {verification.allPassed ? 'PROJECT VERIFIED' : 'التحقق لم يكتمل'}
              </div>
              {verification.results.map((item, index) => (
                <div key={index} className={`work-verification-row ${item.passed ? 'ok' : 'fail'}`}>
                  <span>{item.passed ? '✓' : '✗'}</span>
                  <div><strong dir="auto">{item.label}</strong>{item.output ? <small dir="auto">{item.output.slice(0, 240)}</small> : null}</div>
                </div>
              ))}
            </div>
          )}

          {changes.length > 0 && (
            <div className="work-changes">
              <h4>التغييرات ({changes.length})</h4>
              {changes.slice(-20).reverse().map((change) => (
                <div key={change.path} className="work-change-row">
                  <span className="modified-dot">●</span>
                  <span dir="ltr">{change.path}</span>
                  <small>{change.tool || change.source}</small>
                  <button className="work-chip" onClick={() => void viewDiff(change.path)}>عرض الفرق</button>
                </div>
              ))}
            </div>
          )}

          <div className="work-agent-log">
            {agentLog.slice(-40).map((entry, index) => (
              <div key={index} className={`work-log-line log-${entry.kind}`} dir="auto">
                <span>{new Date(entry.at).toLocaleTimeString('ar')}</span>
                <p>{entry.text}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {project && (
        <footer className="work-footer">
          <span>{stats.files} ملف · {Math.round(stats.bytes / 1024)}KB · {changes.length} تغيير</span>
          <span dir="ltr" className="work-footer-id">{project.id}</span>
        </footer>
      )}
    </section>
  )
}

function emptyRun(): WorkRun {
  return { projectId: '', taskId: null, status: 'idle', task: '', summary: '', error: null, startedAt: null, finishedAt: null, durationMs: null, filesChanged: [], steps: [] }
}

// The editor owns its draft so typing does not re-render the whole workspace or
// rebuild the line-number gutter for every panel.
const EditorPane = memo(function EditorPane({ path, content, readOnly, onSave }: {
  path: string
  content: string
  readOnly: boolean
  onSave: (path: string, draft: string) => void | Promise<void>
}) {
  const [draft, setDraft] = useState(content)
  const [saving, setSaving] = useState(false)
  const gutterRef = useRef<HTMLPreElement | null>(null)
  const dirty = draft !== content
  const lineNumbers = useMemo(() => {
    const count = draft.split('\n').length
    return Array.from({ length: count }, (_, index) => index + 1)
  }, [draft])

  const save = async () => {
    setSaving(true)
    try { await onSave(path, draft) } finally { setSaving(false) }
  }

  return (
    <div className="work-editor">
      <pre className="work-editor-gutter" ref={gutterRef} aria-hidden="true">
        {lineNumbers.map((line) => <div key={line}>{line}</div>)}
      </pre>
      <textarea
        className="work-editor-area"
        dir="ltr"
        spellCheck={false}
        readOnly={readOnly}
        value={draft}
        onScroll={(event) => { if (gutterRef.current) gutterRef.current.scrollTop = (event.target as HTMLTextAreaElement).scrollTop }}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="work-editor-foot">
        <span>{dirty ? '● تغييرات غير محفوظة' : '✓ محفوظ'}</span>
        <span dir="ltr">{lineNumbers.length} سطر</span>
        <button className="work-button" onClick={() => void save()} disabled={!dirty || readOnly || saving}>
          {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} حفظ فعلي
        </button>
      </div>
    </div>
  )
})

const TreeNode = memo(function TreeNode({ node, modified, activePath, onOpen, onNew, onRename, onDelete, onDownload, depth = 0 }: {
  node: WorkTreeNode
  modified: Set<string>
  activePath: string
  onOpen: (path: string) => void
  onNew: (dir: string, kind: 'file' | 'dir') => void
  onRename: (path: string) => void
  onDelete: (path: string) => void
  onDownload: (path: string) => void
  depth?: number
}) {
  const [open, setOpen] = useState(depth < 2)
  const isDir = node.type === 'dir'
  const isModified = modified.has(node.path)
  return (
    <div className="work-tree-node">
      <div className={`work-tree-row ${activePath === node.path ? 'active' : ''}`} style={{ paddingInlineStart: `${8 + depth * 14}px` }}>
        <button className="work-tree-label" onClick={() => (isDir ? setOpen((value) => !value) : onOpen(node.path))} title={node.path}>
          {isDir ? (open ? <ChevronDown size={13} /> : <ChevronLeft size={13} />) : <span className="work-tree-spacer" />}
          {isDir ? (open ? <FolderOpen size={14} /> : <Folder size={14} />) : (isCode(node.name) ? <FileCode2 size={14} /> : <File size={14} />)}
          <span dir="ltr">{node.name}</span>
          {isModified && <span className="modified-dot" title="معدّل">●</span>}
        </button>
        <span className="work-tree-actions">
          {isDir && <button className="icon-button" title="ملف جديد هنا" onClick={() => onNew(node.path, 'file')}><FilePlus2 size={13} /></button>}
          {isDir && <button className="icon-button" title="مجلد جديد هنا" onClick={() => onNew(node.path, 'dir')}><FolderPlus size={13} /></button>}
          <button className="icon-button" title="إعادة تسمية" onClick={() => onRename(node.path)}><Pencil size={13} /></button>
          {!isDir && <button className="icon-button" title="تنزيل" onClick={() => onDownload(node.path)}><Download size={13} /></button>}
          <button className="icon-button icon-button--danger" title="حذف" onClick={() => onDelete(node.path)}><Trash2 size={13} /></button>
        </span>
      </div>
      {isDir && open && (node.children || []).map((child) => (
        <TreeNode key={child.path} node={child} modified={modified} activePath={activePath} onOpen={onOpen} onNew={onNew} onRename={onRename} onDelete={onDelete} onDownload={onDownload} depth={depth + 1} />
      ))}
    </div>
  )
})

function isCode(name: string) {
  return /\.(js|jsx|ts|tsx|mjs|cjs|json|css|html|py|md|txt|yml|yaml|sql)$/i.test(name)
}
