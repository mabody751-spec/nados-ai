import { useEffect, useRef, useState, type DragEvent, type RefObject } from 'react'
import {
  ArrowLeft,
  BrainCircuit,
  Bot,
  Camera,
  Check,
  ChevronDown,
  Cloud,
  Cpu,
  FileText,
  Globe2,
  GraduationCap,
  Hammer,
  ImageIcon,
  Mic,
  Paperclip,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  Square,
  X,
  Zap,
} from 'lucide-react'
import type { ModelId, NadosModelOption, SearchMode } from './api'
import { formatTokens } from './api'
import { MAX_MESSAGE_CHARS } from './limits'

export const modeData: Record<SearchMode, { label: string; description: string; Icon: typeof Globe2 }> = {
  web: { label: 'الويب', description: 'إجابة سريعة من الإنترنت', Icon: Globe2 },
  research: { label: 'بحث عميق', description: 'تحليل موسّع متعدد المصادر', Icon: SearchCheck },
  academic: { label: 'أكاديمي', description: 'أوراق ومراجع علمية', Icon: GraduationCap },
  files: { label: 'ملفاتي', description: 'ابحث داخل ملفاتك', Icon: FileText },
  create: { label: 'إنشاء', description: 'تقارير ومشاريع جاهزة', Icon: Hammer },
}

export const modelData: Record<string, { label: string; note: string }> = {
  'nados-v1': { label: 'Nados v1.0', note: 'نموذج موحّد يختار المزود والمحرك الأنسب' },
}

interface ComposerProps {
  compact?: boolean
  query: string
  setQuery: (value: string) => void
  onSubmit: () => void
  mode: SearchMode
  setMode: (mode: SearchMode) => void
  model: ModelId
  models: NadosModelOption[]
  setModel: (model: ModelId) => void
  modelOpen: boolean
  setModelOpen: (value: boolean) => void
  modeOpen: boolean
  setModeOpen: (value: boolean) => void
  fileInput: RefObject<HTMLInputElement | null>
  cameraInput: RefObject<HTMLInputElement | null>
  selectedFiles: File[]
  setSelectedFiles: (value: File[] | ((current: File[]) => File[])) => void
  textarea: RefObject<HTMLTextAreaElement | null>
  startVoice: () => void
  listening: boolean
  loading?: boolean
  onStop?: () => void
  acceptFile?: (file: File) => void
}

export function Composer(props: ComposerProps) {
  const { Icon } = modeData[props.mode]
  const [dragOver, setDragOver] = useState(false)
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const imageInput = useRef<HTMLInputElement>(null)
  const docInput = useRef<HTMLInputElement>(null)
  const selectedModel = props.models.find((item) => item.id === props.model) || props.models[0] || {
    id: 'nados-v1', label: 'Nados v1.0', provider: 'توجيه تلقائي', model: 'أفضل نموذج متاح', providerId: 'auto', webSearch: true, vision: true, files: true,
  }
  const SelectedModelIcon = getModelIcon(selectedModel.providerId || 'auto')

  useEffect(() => {
    const el = props.textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [props.query, props.textarea])

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragOver(false)
    if (props.loading) return
    const files = Array.from(event.dataTransfer.files).slice(0, 5)
    if (!files.length) return
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) continue
      if (props.acceptFile) props.acceptFile(file)
      else props.setSelectedFiles((current) => current.length >= 5 ? current : [...current, file])
    }
  }

  function getModelIcon(providerId: string) {
    switch (providerId) {
      case 'gemini': return Sparkles
      case 'groq': return Zap
      case 'openrouter': return Globe2
      case 'cloudflare': return Cloud
      case 'huggingface': return Cpu
      case 'openai': return Bot
      case 'auto': return BrainCircuit
      default: return ShieldCheck
    }
  }
  return (
    <div
      className={`composer ${props.compact ? 'composer--compact' : ''} ${dragOver ? 'composer--dragover' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {props.selectedFiles.length > 0 && (
        <div className="file-chips">
          {props.selectedFiles.map((file, index) => (
            <div className="file-chip" key={`${file.name}-${index}`}>
              <FileText size={15} />
              <span>{file.name}</span>
              <small dir="ltr">{file.size > 1_048_576 ? `${(file.size / 1_048_576).toFixed(1)} MB` : `${Math.ceil(file.size / 1024)} KB`}</small>
              <button onClick={() => props.setSelectedFiles((current) => current.filter((_, position) => position !== index))} aria-label="إزالة الملف"><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={props.textarea}
        value={props.query}
        onChange={(event) => props.setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            props.onSubmit()
          }
        }}
        onPaste={(event) => {
          const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith('image/'))
          if (image && !props.loading) {
            event.preventDefault()
            if (props.acceptFile) props.acceptFile(image)
            else props.setSelectedFiles((current) => current.length >= 5 ? current : [...current, image])
          }
        }}
        rows={2}
        maxLength={MAX_MESSAGE_CHARS}
        placeholder={props.compact ? 'اسأل سؤالاً آخر...' : 'اسأل Nados أي شيء...'}
        aria-label="اكتب سؤالك"
      />
      {props.query.length > MAX_MESSAGE_CHARS * 0.8 && (
        <div className="conversation-counter" dir="ltr">{props.query.length.toLocaleString()} / {MAX_MESSAGE_CHARS.toLocaleString()}</div>
      )}
      <div className="composer-tools">
        <div className="tools-group">
          <input ref={props.fileInput} type="file" multiple accept="image/*,video/*,.pdf,.txt,.md,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx" hidden onChange={(event) => {
            const chosen = Array.from(event.target.files || [])
            if (!chosen.length) return
            for (const file of chosen) {
              if (props.acceptFile) props.acceptFile(file)
              else props.setSelectedFiles((current) => current.length >= 5 ? current : [...current, file])
            }
            event.target.value = ''
          }} />
          <input ref={props.cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(event) => {
            const chosen = event.target.files?.[0]
            if (chosen) {
              if (props.acceptFile) props.acceptFile(chosen)
              else props.setSelectedFiles((current) => current.length >= 5 ? current : [...current, chosen])
            }
            event.target.value = ''
          }} />
          <div className="attach-menu-wrap">
            <button className="icon-button" onClick={() => setAttachMenuOpen((value) => !value)} aria-label="إرفاق" aria-expanded={attachMenuOpen} title="إرفاق"><Paperclip size={19} /></button>
            {attachMenuOpen && (
              <div className="attach-menu" role="menu">
                <button role="menuitem" onClick={() => { props.fileInput.current?.click(); setAttachMenuOpen(false) }}><FileText size={16} /> إرفاق ملف</button>
                <button role="menuitem" onClick={() => { imageInput.current?.click(); setAttachMenuOpen(false) }}><ImageIcon size={16} /> صورة</button>
                <button role="menuitem" onClick={() => { props.cameraInput.current?.click(); setAttachMenuOpen(false) }}><Camera size={16} /> كاميرا</button>
                <button role="menuitem" onClick={() => { docInput.current?.click(); setAttachMenuOpen(false) }}><FileText size={16} /> مستند</button>
              </div>
            )}
          </div>
          <input ref={imageInput} type="file" accept="image/*" hidden multiple onChange={(event) => {
            const chosen = Array.from(event.target.files || [])
            for (const file of chosen) {
              if (props.acceptFile) props.acceptFile(file)
              else props.setSelectedFiles((current) => current.length >= 5 ? current : [...current, file])
            }
            event.target.value = ''
          }} />
          <input ref={docInput} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv" hidden multiple onChange={(event) => {
            const chosen = Array.from(event.target.files || [])
            for (const file of chosen) {
              if (props.acceptFile) props.acceptFile(file)
              else props.setSelectedFiles((current) => current.length >= 5 ? current : [...current, file])
            }
            event.target.value = ''
          }} />
          <div className="mode-select">
            <button onClick={() => { props.setModeOpen(!props.modeOpen); props.setModelOpen(false) }}><Icon size={15} /><span className="control-label">{modeData[props.mode].label}</span><ChevronDown size={13} /></button>
            {props.modeOpen && (
              <div className="mode-menu mode-menu--wide">
                {(Object.entries(modeData) as Array<[SearchMode, (typeof modeData)[SearchMode]]>).map(([key, item]) => (
                  <button key={key} className={props.mode === key ? 'selected' : ''} onClick={() => { props.setMode(key); props.setModeOpen(false) }}>
                    <item.Icon size={17} /><span><strong>{item.label}</strong><small>{item.description}</small></span>{props.mode === key && <Check size={15} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="model-select">
            <button className="unified-model" type="button" aria-label="اختيار نموذج Nados" aria-expanded={props.modelOpen} title={selectedModel.label} onClick={() => { props.setModelOpen(!props.modelOpen); props.setModeOpen(false) }}>
              <SelectedModelIcon size={15} /><span className="control-label">{selectedModel.label}</span><ChevronDown size={12} />
            </button>
            {props.modelOpen && (
              <div className="model-menu" role="listbox" aria-label="نماذج Nados المتاحة">
                <div className="model-menu-heading"><strong>نماذج Nados</strong><small>{props.models.length} نموذج متاح</small></div>
                {Object.entries(props.models.reduce<Record<string, typeof props.models[number][]>>((groups, item) => {
                  const key = item.provider || 'أخرى'
                  groups[key] = groups[key] || []
                  groups[key].push(item)
                  return groups
                }, {}))
                  .sort(([leftProvider], [rightProvider]) => Number(rightProvider === 'Nados') - Number(leftProvider === 'Nados') || leftProvider.localeCompare(rightProvider, 'ar'))
                  .map(([provider, items]) => (

                    <div className={`model-menu-section ${provider === 'Nados' ? 'nados-section' : ''}`} key={provider}>
                      <div className="model-menu-section-header">
                        <strong>{provider === 'Nados' ? 'Nados — نموذجنا المدرَّب' : provider}</strong>
                        <small>{items.length} نموذج</small>
                      </div>
                      {items
                        .slice()
                        .sort((left, right) => left.label.localeCompare(right.label, 'en'))
                        .map((item) => {
                          const ModelIcon = getModelIcon(item.providerId)
                          return (
                            <button key={item.id} type="button" role="option" aria-selected={props.model === item.id} className={props.model === item.id ? 'selected' : ''} onClick={() => { props.setModel(item.id); props.setModelOpen(false) }}>
                              <span className="model-option-icon"><ModelIcon size={10} /></span>
                              <span><strong dir="auto">{item.label}</strong><small>{item.webSearch ? 'ويب' : ''}{item.vision ? item.webSearch ? ' · رؤية' : 'رؤية' : ''}{item.files ? (item.webSearch || item.vision ? ' · ملفات' : 'ملفات') : ''}{item.contextWindow ? ` · سياق ${formatTokens(item.contextWindow)}` : ''}</small></span>
                              {props.model === item.id && <Check size={14} />}
                            </button>
                          )
                        })}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
        <div className="tools-group">
          <button className={`icon-button ${props.listening ? 'is-listening' : ''}`} onClick={props.startVoice} aria-label="إملاء صوتي" title="إملاء صوتي"><Mic size={19} /></button>
          {props.loading
            ? <button className="send-button send-button--stop" onClick={props.onStop} aria-label="إيقاف التوليد" title="إيقاف"><Square size={18} /></button>
            : <button className="send-button" onClick={props.onSubmit} disabled={!props.query.trim()} aria-label="إرسال" title="إرسال"><ArrowLeft size={20} /></button>}
        </div>
      </div>
    </div>
  )
}
