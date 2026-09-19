import { useMemo, useState, type ReactNode } from 'react'
import { Check, Clipboard, Download, Eye, EyeOff, ExternalLink } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.min.css'

const frameLanguages = new Set(['html', 'htm', 'svg', 'css'])
const textPreviewLanguages = new Set(['prompt', 'text', 'plaintext', 'markdown', 'md'])

function inferredLanguage(language: string, code: string) {
  const normalized = String(language || '').toLowerCase()
  if (frameLanguages.has(normalized) || textPreviewLanguages.has(normalized)) return normalized
  if (/(?:^|\s)<!doctype html|<html[\s>]|<body[\s>]|<div[\s>]|<section[\s>]|<header[\s>]|<main[\s>]/i.test(code)) return 'html'
  if (/<svg[\s>]/i.test(code)) return 'svg'
  if (/<style[\s>]/i.test(code) && !/<html[\s>]/i.test(code)) return 'css'
  return normalized
}

function previewDocument(language: string, code: string) {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' 'self' http://localhost:5176 https:; img-src data: https:; font-src data:; script-src 'unsafe-inline' 'unsafe-eval' 'self' https:; connect-src *;">`
  if (language === 'css') {
    return `<!doctype html><html dir="rtl"><head>${csp}<style>${code}</style></head><body><main><h1>Nados Preview</h1><p>معاينة تنسيق CSS</p><button>زر تجريبي</button></main></body></html>`
  }
  if (language === 'svg') {
    return `<!doctype html><html><head>${csp}</head><body>${code}</body></html>`
  }
  if (/<head[\s>]/i.test(code)) return code.replace(/<head([^>]*)>/i, `<head$1>${csp}`)
  return `<!doctype html><html><head>${csp}</head><body>${code}</body></html>`
}

function CodeBlock({ language, code, highlighted }: { language: string; code: string; highlighted?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const resolvedLanguage = inferredLanguage(language, code)
  const canPreview = frameLanguages.has(resolvedLanguage) || textPreviewLanguages.has(resolvedLanguage)
  const label = resolvedLanguage === 'prompt' ? 'Prompt' : resolvedLanguage || 'Code'
  const source = useMemo(() => previewDocument(resolvedLanguage, code), [resolvedLanguage, code])

  const copy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const download = () => {
    const extension = resolvedLanguage ? (resolvedLanguage === 'javascript' || resolvedLanguage === 'js' ? 'js' : resolvedLanguage === 'typescript' ? 'ts' : resolvedLanguage === 'bash' || resolvedLanguage === 'sh' ? 'sh' : resolvedLanguage) : 'txt'
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `code.${extension}`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const openPreviewTab = () => {
    const blob = new Blob([source], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const popup = window.open(url, '_blank', 'noopener,noreferrer')
    if (popup) popup.opener = null
    window.setTimeout(() => URL.revokeObjectURL(url), 30000)
  }

  return (
    <section className={`code-block ${language === 'prompt' ? 'prompt-block' : ''}`} dir="ltr">
      <header>
        <span>{label}</span>
        <div>
          {canPreview && (
            <>
              <button onClick={() => setPreviewing((value) => !value)} aria-label={previewing ? 'إغلاق المعاينة' : 'معاينة'} title={previewing ? 'إغلاق المعاينة' : 'معاينة'}>
                {previewing ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              <button onClick={openPreviewTab} aria-label="فتح المعاينة في تبويب جديد" title="فتح المعاينة في تبويب جديد">
                <ExternalLink size={16} />
              </button>
            </>
          )}
          <button onClick={copy} aria-label="نسخ" title="نسخ">
            {copied ? <Check size={16} /> : <Clipboard size={16} />}
          </button>
          <button onClick={download} aria-label="تنزيل الكود" title="تنزيل">
            <Download size={16} />
          </button>
        </div>
      </header>
      <pre><code className={language ? `language-${language} hljs` : undefined}>{highlighted ?? code}</code></pre>
      {previewing && frameLanguages.has(resolvedLanguage) && (
        <iframe className="code-preview" title={`معاينة ${label}`} sandbox="allow-scripts allow-same-origin" srcDoc={source} />
      )}
      {previewing && textPreviewLanguages.has(resolvedLanguage) && (
        <div className="prompt-preview" dir="auto">{code}</div>
      )}
    </section>
  )
}

function extractText(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((item) => extractText(item)).join('')
  if (node && typeof node === 'object' && 'props' in (node as { props?: { children?: unknown } })) {
    return extractText((node as { props?: { children?: unknown } }).props?.children)
  }
  return ''
}

export function RichAnswer({ answer, bullets }: { answer: string[]; bullets: string[] }) {
  const markdown = [answer.filter((item) => typeof item === 'string').join('\n\n'), bullets.filter((item) => typeof item === 'string').map((item) => `- ${item}`).join('\n')].filter(Boolean).join('\n\n')

  return (
    <div className="answer-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => {
            const codeElement = Array.isArray(children) ? children[0] : children
            const className = (codeElement as { props?: { className?: string } })?.props?.className || ''
            const match = /language-([\w-]+)/.exec(className || '')
            if (!match) return <pre>{children}</pre>
            const code = extractText((codeElement as { props?: { children?: unknown } })?.props?.children).replace(/\n$/, '')
            return <CodeBlock language={match[1].toLowerCase()} code={code} highlighted={(codeElement as { props?: { children?: ReactNode } })?.props?.children} />
          },
          code: ({ className, children, ...props }) => {
            return <code className={className} {...props}>{children}</code>
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
