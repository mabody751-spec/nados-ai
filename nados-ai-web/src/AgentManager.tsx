import { useEffect, useRef, useState } from 'react'
import { Bot, CircleDot, Play, RefreshCw, Send } from 'lucide-react'
import { formatTokens } from './api'

const agentColors: Record<string, string> = {
  planner: '#14B8A6',
  retriever: '#5C8CD5',
  validator: '#D97706',
  synthesizer: '#EB654B',
}

export function AgentManager() {
  const [board, setBoard] = useState<Array<{ id: string; agentId: string; message: string; tags: string[]; at: string }>>([])
  const [running, setRunning] = useState(0)
  const [taskInput, setTaskInput] = useState('')
  const [agentMode, setAgentMode] = useState('ask')
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)

  const refresh = async () => {
    try {
      const response = await fetch('/api/agent/board', { signal: AbortSignal.timeout(8000) })
      if (!response.ok) return
      const body = await response.json()
      setBoard(body.board || [])
      setRunning(body.running || 0)
    } catch {}
  }

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { void refresh() }, 10_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    boardRef.current?.scrollTo({ top: boardRef.current.scrollHeight, behavior: 'smooth' })
  }, [board])

  const runTask = async () => {
    if (!taskInput.trim() || busy) return
    setBusy(true)
    setLastResult(null)
    try {
      const response = await fetch('/api/agent/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: agentMode, instructions: taskInput.trim(), background: true }) })
      const body = await response.json()
      if (body.error) setLastResult(`⚠ ${body.error}`)
      else setLastResult(`✓ انطلق الوكيل ${body.taskId} (${body.status}) — راقب اللوح أدناه`)
      setTaskInput('')
      void refresh()
    } catch (error) {
      setLastResult(`⚠ ${String((error as Error).message)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="agent-manager">
      <div className="agent-manager-hero">
        <Bot size={26} />
        <div><h2>مركز الوكلاء (Agent Manager)</h2><p>وكلاء متخصصون يعملون بالتوازي — لوح سرب مشترك</p></div>
        <div className="agent-status-pill"><CircleDot size={13} /> {running} وكلاء نشطون</div>
        <button className="icon-button" onClick={() => void refresh()} aria-label="تحديث" title="تحديث"><RefreshCw size={17} /></button>
      </div>

      <div className="agent-task-bar">
        <select value={agentMode} onChange={(event) => setAgentMode(event.target.value)} aria-label="وضع الوكيل">
          <option value="ask">اسأل</option>
          <option value="code">برمجة</option>
          <option value="debug">تصحيح</option>
          <option value="architect">معماري</option>
          <option value="research">بحث</option>
          <option value="orchestrator">منسّق</option>
        </select>
        <input
          value={taskInput}
          onChange={(event) => setTaskInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void runTask() }}
          placeholder="مهمة للوكيل... مثال: أنشئ ملف ملاحظات باسم الفريق"
          aria-label="مهمة الوكيل"
          dir="auto"
        />
        <button onClick={() => void runTask()} disabled={busy || !taskInput.trim()} aria-label="تشغيل المهمة" title="تشغيل">{busy ? '...' : <Play size={16} />}</button>
      </div>
      {lastResult && <div className="agent-task-result">{lastResult}</div>}

      <div className="swarm-board" ref={boardRef}>
        <h3>لوح السرب (Swarm Board)</h3>
        {board.length === 0 && <p className="training-note">لا توجد رسائل بعد — شغّل مهمة للوكيل.</p>}
        {board.map((post) => (
          <div className="swarm-post" key={post.id}>
            <span className="swarm-dot" style={{ background: agentColors[post.agentId] || '#14B8A6' }} />
            <div>
              <strong dir="auto">{post.agentId}</strong>
              <small>{new Date(post.at).toLocaleTimeString('ar')}</small>
              <p dir="auto">{post.message}</p>
              {post.tags?.length ? <div className="swarm-tags">{post.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
