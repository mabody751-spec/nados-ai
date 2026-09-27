// Real, runnable starter templates. Each template writes actual files into a
// project workspace. No simulated output — the caller writes these to disk.

const memoryBank = (name, stack) => `# ${name}

## نظرة عامة
مشروع ${stack} أُنشئ عبر وضع «العمل» في Nados AI.

## حالة المشروع
- الأنواع (Stack): ${stack}
- آخر تحديث: __UPDATED__

## ملاحظات للوكيل
- اقرأ هذا الملف أولاً قبل أي تعديل.
- لا تكتب أي مفاتيح أو أسرار داخل ملفات المشروع.
- حدّث الملف عند تغيير المعمارية.
`

export const WORK_TEMPLATES = {
  static: {
    id: 'static',
    label: 'صفحة HTML/CSS/JS',
    startCommand: null,
    verifyEntry: 'index.html',
    files: {
      'index.html': `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>مشروع Nados</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main class="wrap">
      <h1>مرحباً من Nados</h1>
      <p>هذه صفحة حقيقية أُنشئت داخل مساحة عمل معزولة.</p>
      <button id="cta">اضغط هنا</button>
      <p id="out" aria-live="polite"></p>
    </main>
    <script src="./script.js"></script>
  </body>
</html>
`,
      'styles.css': `:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, "Segoe UI", Tahoma, sans-serif; background: #0f1713; color: #eaf4ef; }
.wrap { max-width: 720px; margin: 12vh auto; padding: 32px; text-align: center; }
h1 { font-size: clamp(28px, 6vw, 44px); margin: 0 0 12px; color: #35b8a9; }
button { background: #35b8a9; color: #06231e; border: 0; border-radius: 10px; padding: 12px 20px; font-size: 16px; cursor: pointer; }
button:hover { filter: brightness(1.08); }
`,
      'script.js': `const button = document.getElementById('cta')
const out = document.getElementById('out')
let count = 0
button?.addEventListener('click', () => {
  count += 1
  if (out) out.textContent = \`تم الضغط \${count} مرة\`
})
`,
      'README.md': `# مشروع Nados (HTML/CSS/JS)

افتح \`index.html\` مباشرةً أو شغّل خادماً ثابتاً لعرض المعاينة.
`,
    },
  },
  'react-vite': {
    id: 'react-vite',
    label: 'React + Vite',
    startCommand: 'npm run dev',
    buildCommand: 'npm run build',
    verifyEntry: 'package.json',
    files: {
      'package.json': JSON.stringify({
        name: 'nados-react-app',
        private: true,
        version: '1.0.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
        devDependencies: { '@vitejs/plugin-react': '^5.0.0', vite: '^7.0.0' },
      }, null, 2) + '\n',
      'vite.config.js': `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({ plugins: [react()], server: { host: '127.0.0.1' } })
`,
      'index.html': `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>تطبيق Nados</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
      'src/main.jsx': `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`,
      'src/App.jsx': `import { useState } from 'react'

export default function App() {
  const [count, setCount] = useState(0)
  return (
    <main className="wrap">
      <h1>تطبيق Nados</h1>
      <p>مشروع React حقيقي يعمل داخل مساحة عمل معزولة.</p>
      <button onClick={() => setCount((value) => value + 1)}>العدّاد: {count}</button>
    </main>
  )
}
`,
      'src/styles.css': `:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, "Segoe UI", Tahoma, sans-serif; background: #0f1713; color: #eaf4ef; }
.wrap { max-width: 720px; margin: 12vh auto; padding: 32px; text-align: center; }
h1 { color: #35b8a9; }
button { background: #35b8a9; color: #06231e; border: 0; border-radius: 10px; padding: 12px 20px; font-size: 16px; cursor: pointer; }
`,
      'README.md': `# تطبيق React + Vite

\`\`\`
npm install
npm run dev
\`\`\`
`,
    },
  },
  'node-api': {
    id: 'node-api',
    label: 'Node.js API',
    startCommand: 'npm start',
    verifyEntry: 'package.json',
    files: {
      'package.json': JSON.stringify({
        name: 'nados-node-api',
        private: true,
        version: '1.0.0',
        type: 'module',
        scripts: { start: 'node server.mjs', test: 'node --test' },
      }, null, 2) + '\n',
      'server.mjs': `import { createServer } from 'node:http'

const port = Number(process.env.PORT || 4000)

const server = createServer((request, response) => {
  if (request.url === '/api/health') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ ok: true, service: 'nados-node-api' }))
    return
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end('<!doctype html><html lang="ar" dir="rtl"><body><h1>Nados API تعمل</h1></body></html>')
})

server.listen(port, '127.0.0.1', () => {
  console.log(\`nados-node-api listening on http://127.0.0.1:\${port}\`)
})
`,
      'server.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'

test('health payload shape', () => {
  assert.equal(typeof { ok: true, service: 'nados-node-api' }.ok, 'boolean')
})
`,
      'README.md': `# Node.js API

\`\`\`
npm start
npm test
\`\`\`
`,
    },
  },
  python: {
    id: 'python',
    label: 'Python',
    startCommand: 'python -m http.server 4100',
    verifyEntry: 'main.py',
    files: {
      'main.py': `"""مشروع Python أُنشئ عبر Nados Work."""


def greet(name: str) -> str:
    return f"مرحباً {name}"


if __name__ == "__main__":
    print(greet("Nados"))
`,
      'test_main.py': `from main import greet


def test_greet():
    assert greet("Nados") == "مرحباً Nados"
`,
      'README.md': `# مشروع Python

\`\`\`
python main.py
python -m pytest
\`\`\`
`,
    },
  },
}

export function templateById(id) {
  return WORK_TEMPLATES[String(id || '').toLowerCase()] || WORK_TEMPLATES.static
}

export function detectTemplateFromRequest(text) {
  const prompt = String(text || '').toLowerCase()
  if (/\bnext\.?js\b|\bnextjs\b/.test(prompt)) return WORK_TEMPLATES['react-vite']
  if (/\breact\b|\bvite\b|\btodo\b|لوحة|dashboard|تطبيق تفاعلي/.test(prompt)) return WORK_TEMPLATES['react-vite']
  if (/\bexpress\b|\bapi\b|\bnode\b|سيرفر|خادم|واجهة برمجية/.test(prompt)) return WORK_TEMPLATES['node-api']
  if (/\bpython\b|بايثون/.test(prompt)) return WORK_TEMPLATES.python
  return WORK_TEMPLATES.static
}

export function templateFiles(template, name) {
  const files = { ...template.files }
  files['PROJECT.md'] = memoryBank(name || 'مشروع Nados', template.label)
  files['ARCHITECTURE.md'] = `# المعمارية\n\n- ${template.label}\n- نقطة التحقق: ${template.verifyEntry}\n`
  files['TASKS.md'] = `# المهام\n\n- [ ] المهمة الأولى\n`
  return files
}
