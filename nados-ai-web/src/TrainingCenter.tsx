import { useEffect, useState } from 'react'
import { BrainCircuit, Check, Database, Gauge, Play, RefreshCw, ShieldAlert, X } from 'lucide-react'
import { generateTrainingData, getTrainingCenter, type TrainingCenterData } from './api'

const capabilityLabels: Record<string, string> = {
  coding: 'برمجة',
  reasoning: 'استدلال',
  vision: 'رؤية',
  longContext: 'سياق طويل',
  metered: 'مقيس',
}

function formatNumber(value: number | undefined | null) {
  if (value === undefined || value === null) return 'UNKNOWN'
  return value.toLocaleString('en-US')
}

function formatInterval(ms: number) {
  const minutes = Math.round(ms / 60_000)
  return minutes >= 60 ? `${(minutes / 60).toFixed(1)} ساعة` : `${minutes} دقيقة`
}

export function TrainingCenter() {
  const [data, setData] = useState<TrainingCenterData | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [result, setGeneratingResult] = useState<{ status: string; persisted: number; best: { teacher: string; qualityScore: number } | null; outputs: Array<{ teacher: string; ok: boolean; qualityScore: number | null; accepted: boolean; error: string | null }> } | null>(null)
  const [error, setError] = useState('')

  const refresh = async () => {
    setLoading(true)
    const next = await getTrainingCenter()
    if (!next) setError('الإدارة متاحة من نسخة Nados المحلية فقط — افتح localhost:2000.')
    else setError('')
    setData(next)
    setLoading(false)
  }

  useEffect(() => { void refresh() }, [])

  const runCycle = async () => {
    setGenerating(true)
    setGeneratingResult(null)
    try {
      const response = await generateTrainingData('اشرح الفرق بين useState وuseRef في React بمثال عملي قصير.')
      setGeneratingResult(response)
    } catch (generateError) {
      setError(String((generateError as Error).message || generateError))
    } finally {
      setGenerating(false)
      void refresh()
    }
  }

  if (loading) return <div className="training-center"><p className="training-note">جارٍ تحميل مركز التدريب...</p></div>

  return (
    <section className="training-center">
      <div className="training-hero">
        <BrainCircuit size={26} />
        <div><h2>Nados Training Center</h2><p>محرك التعلم المستمر — كل المعلمين بالتوازي، تقييم جودة، وحفظ تلقائي.</p></div>
        <div className="training-hero-actions">
          <button className="icon-button" onClick={() => void refresh()} aria-label="تحديث" title="تحديث"><RefreshCw size={17} /></button>
          <button className="training-run" onClick={() => void runCycle()} disabled={generating || !data?.providers.length} aria-label="توليد الآن" title="توليد الآن">{generating ? 'جارٍ التوليد...' : <><Play size={15} /> توليد الآن</>}</button>
        </div>
      </div>

      {error && <div className="training-alert"><ShieldAlert size={16} /> {error}</div>}

      {result && (
        <div className="training-result">
          <strong>الدورة الأخيرة: {result.status}</strong>
          <span>{result.persisted} مخرج محفوظ · الأفضل: {result.best ? `${result.best.teacher} (جودة ${result.best.qualityScore})` : 'لا شيء تجاوز العتبة'}</span>
          <div className="training-result-teachers">
            {result.outputs.map((output, index) => (
              <span key={`${output.teacher}-${index}`} className={output.ok ? (output.accepted ? 'accepted' : 'rejected') : 'failed'}>
                {output.ok ? <Check size={12} /> : <X size={12} />} {output.teacher} {output.qualityScore !== null ? `· ${output.qualityScore}` : ''}{output.error ? ` · ${output.error.slice(0, 40)}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {data && (
        <>
          <div className="training-grid">
            <div className="training-card">
              <h3><BrainCircuit size={16} /> المعلمون النشطون ({data.providers.length})</h3>
              <div className="training-teachers">
                {data.providers.map((teacher) => (
                  <div className="training-teacher" key={teacher.id}>
                    <strong>{teacher.name}</strong>
                    <small>{teacher.model}</small>
                    <div className="teacher-caps">
                      {Object.entries(capabilityLabels).filter(([key]) => teacher.capabilities[key as keyof typeof teacher.capabilities]).map(([key, label]) => <span key={key}>{label}</span>)}
                      <span className="ctx">{Math.round(teacher.capabilities.contextWindow / 1000)}K</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="training-card">
              <h3><Gauge size={16} /> الاستخدام</h3>
              <div className="training-usage">
                {data.usage ? Object.entries(data.usage).map(([provider, stats]) => (
                  <div key={provider}>
                    <strong>{provider}</strong>
                    <span>نداءات: {stats.totalCalls} · نجاح: {stats.successCalls} · فشل: {stats.failedCalls}</span>
                    <span>متوسط الزمن: {stats.avgLatencyMs ? `${Math.round(stats.avgLatencyMs)}ms` : 'UNKNOWN'}</span>
                  </div>
                )) : <p className="training-note">لا توجد بيانات استخدام بعد.</p>}
              </div>
            </div>

            <div className="training-card">
              <h3><Database size={16} /> مجموعة البيانات</h3>
              {data.supabase.enabled ? (
                <div className="training-dataset">
                  <div><strong>{formatNumber(data.supabase.outputsTotal)}</strong><span>مخرج معلّم</span></div>
                  <div><strong>{formatNumber(data.supabase.outputsAccepted)}</strong><span>مقبول للجودة</span></div>
                  <div><strong>{formatNumber(data.supabase.examplesTotal)}</strong><span>مثال تدريب</span></div>
                </div>
              ) : <p className="training-note">Supabase غير مهيأ.</p>}
            </div>

            <div className="training-card">
              <h3>التدريب والجدولة</h3>
              <div className="training-status">
                {data.kaggle?.model && (
                  <div>
                    <span>النموذج المتدرب</span>
                    <strong className={data.kaggle.model.done ? 'accepted' : data.kaggle.model.state === 'running' ? 'running' : 'pending'}>
                      {data.kaggle.model.done ? 'Nados v1.1 — اكتمل التدريب ✓' : data.kaggle.model.state === 'running' ? 'Nados v1.1 — يتدرب الآن' : `Nados v1.1 — ${data.kaggle.model.state}`}
                    </strong>
                    <small>{data.kaggle.model.base}</small>
                  </div>
                )}
                {data.kaggle?.params?.trainable && (
                  <div>
                    <span>معاملات النموذج (لايف)</span>
                    <strong className="accepted" dir="ltr">{data.kaggle.params.trainable.toLocaleString('en-US')} / {data.kaggle.params.total?.toLocaleString('en-US')}</strong>
                    <small>قابلة للتدريب: {data.kaggle.params.percent}% من {formatNumber(data.kaggle.params.total)}</small>
                  </div>
                )}
                {data.kaggle?.progress && (
                  <div>
                    <span>التقدم</span>
                    <strong dir="ltr">{data.kaggle.progress.stepsDone !== null ? `${data.kaggle.progress.stepsDone}/${data.kaggle.progress.stepsTotal} steps` : '0/120 steps'}</strong>
                    <small>GPU: {data.kaggle.progress.gpu || 'UNKNOWN'}</small>
                    {data.kaggle.progress.stepsDone !== null && <div className="training-progress-bar"><div style={{ width: `${Math.round((data.kaggle.progress.stepsDone / data.kaggle.progress.stepsTotal) * 100)}%` }} /></div>}
                  </div>
                )}
                <div><span>مزوّد التدريب</span><strong className="accepted">Kaggle — GPU مجاني (Free-First)</strong></div>
                <div><span>المجدول</span><strong>{data.scheduler.enabled ? `يعمل كل ${formatInterval(data.scheduler.intervalMs)}` : 'متوقف'}</strong><small>{data.scheduler.enabled ? `الدورات: ${data.scheduler.runs} · الأخيرة: ${data.scheduler.lastRunAt ? new Date(data.scheduler.lastRunAt).toLocaleTimeString('ar') : '-'}` : 'فعّله بـ NADOS_TRAINING_SCHEDULER=on'}</small></div>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
