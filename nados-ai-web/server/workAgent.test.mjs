import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempRoot = await mkdtemp(join(tmpdir(), 'nados-work-test-'))
process.env.NADOS_WORKSPACES_ROOT = tempRoot
process.env.NADOS_SANDBOX_ROOT = tempRoot

const work = await import('./workProjects.mjs')
const agent = await import('./workAgent.mjs')
const templates = await import('./workTemplates.mjs')
const sandbox = await import('./sandbox/index.mjs')

test.after(async () => {
  await sandbox.stopAllServers()
  await rm(tempRoot, { recursive: true, force: true }).catch(() => {})
})

test('every template produces a runnable entry file', () => {
  for (const [id, template] of Object.entries(templates.WORK_TEMPLATES)) {
    const files = templates.templateFiles(template, 'test')
    assert.ok(files[template.verifyEntry], `${id} missing ${template.verifyEntry}`)
    assert.ok(files['PROJECT.md'], `${id} missing PROJECT.md`)
    if (files['package.json']) {
      const parsed = JSON.parse(files['package.json'])
      assert.ok(parsed.name)
    }
  }
})

test('detects the right template from a natural-language request', () => {
  assert.equal(templates.detectTemplateFromRequest('اعمللي صفحة بسيطة').id, 'static')
  assert.equal(templates.detectTemplateFromRequest('اعمللي React dashboard').id, 'react-vite')
  assert.equal(templates.detectTemplateFromRequest('اعمللي todo app').id, 'react-vite')
  assert.equal(templates.detectTemplateFromRequest('اعمل Next.js app').id, 'react-vite')
  assert.equal(templates.detectTemplateFromRequest('اعمللي api بالـ node').id, 'node-api')
  assert.equal(templates.detectTemplateFromRequest('مشروع python').id, 'python')
})

test('creates a real project with actual files on disk', async () => {
  const project = await work.createProject({ name: 'متجر تجريبي', stack: 'static', userId: 'user-a' })
  assert.ok(project.id)
  assert.equal(project.stack, 'static')

  const tree = await work.projectTree(project.id)
  assert.ok(tree.tree.length >= 3)
  const names = tree.tree.map((node) => node.name)
  assert.ok(names.includes('index.html'))
  assert.ok(names.includes('PROJECT.md'))

  const file = await work.projectReadFile(project.id, 'index.html')
  assert.match(file.content, /<html/)
})

test('tracks created files as added and edits as a real line diff', async () => {
  const project = await work.createProject({ name: 'diff-test', stack: 'static' })

  // A file that did not exist keeps its "added" semantics even after edits.
  await work.projectWriteFile(project.id, 'note.txt', 'سطر واحد\nسطر اثنان\n')
  await work.projectWriteFile(project.id, 'note.txt', 'سطر واحد\nسطر جديد\nسطر ثالث\n')
  const created = work.listFileChanges(project.id).find((change) => change.path === 'note.txt')
  assert.equal(created.added, true)
  assert.equal(created.removed, false)

  // Editing a pre-existing file produces a genuine add/remove diff.
  const before = await work.projectReadFile(project.id, 'README.md')
  await work.projectWriteFile(project.id, 'README.md', 'line one\nline two\nline three\n')
  await work.projectWriteFile(project.id, 'README.md', 'line one\nline CHANGED\nline three\n')
  assert.ok(before.content.length > 0)

  const diff = work.getFileDiff(project.id, 'README.md')
  assert.ok(diff.diff.added >= 1, `added=${diff.diff.added}`)
  assert.ok(diff.diff.removed >= 1, `removed=${diff.diff.removed}`)
  assert.ok(diff.diff.lines.some((line) => line.type === 'add'))
  assert.ok(diff.diff.lines.some((line) => line.type === 'remove'))
  // The cumulative diff is anchored at the earliest recorded state.
  assert.equal(diff.before, before.content)
  assert.equal(diff.after, 'line one\nline CHANGED\nline three\n')
})

test('agent tool registry returns structured success envelopes', async () => {
  const project = await work.createProject({ name: 'tools-test', stack: 'static' })
  const tools = agent.workToolRegistry(project.id)

  const write = await tools.write_file.execute({ path: 'src/hello.js', content: 'export const value = 1\n' })
  assert.equal(write.tool, 'write_file')
  assert.equal(write.status, 'success')
  assert.equal(write.path, 'src/hello.js')
  assert.ok(write.bytes > 0)

  const read = await tools.read_file.execute({ path: 'src/hello.js' })
  assert.equal(read.status, 'success')
  assert.match(read.content, /value = 1/)

  const edit = await tools.edit_file.execute({ path: 'src/hello.js', find: '1', replace: '2' })
  assert.equal(edit.status, 'success')
  assert.equal(edit.replacements, 1)

  const missing = await tools.read_file.execute({ path: 'src/nope.js' })
  assert.equal(missing.status, 'error')
  assert.match(missing.error, /NOT_FOUND/)
})

test('agent tool registry returns error envelopes instead of escaping the sandbox', async () => {
  const project = await work.createProject({ name: 'escape-test', stack: 'static' })
  const tools = agent.workToolRegistry(project.id)

  const traversal = await tools.read_file.execute({ path: '../../etc/passwd' })
  assert.equal(traversal.status, 'error')
  assert.match(traversal.error, /SANDBOX_ESCAPE/)

  const absolute = await tools.write_file.execute({ path: 'C:/Windows/evil.txt', content: 'x' })
  assert.equal(absolute.status, 'error')
  assert.match(absolute.error, /SANDBOX_ESCAPE/)

  const blockedCmd = await tools.execute_command.execute({ cmd: 'powershell -Command "Get-Process"' })
  assert.equal(blockedCmd.status, 'error')
  assert.match(blockedCmd.error, /COMMAND_BLOCKED/)
})

test('agent executes a real command through the registry', async () => {
  const project = await work.createProject({ name: 'cmd-test', stack: 'static' })
  const tools = agent.workToolRegistry(project.id)
  const result = await tools.execute_command.execute({ cmd: 'node --version' })
  assert.equal(result.status, 'success')
  assert.equal(result.exitCode, 0)
  assert.match(result.stdout, /v\d+\./)
})

test('verification passes for a valid static project and fails when the entry file is missing', async () => {
  const project = await work.createProject({ name: 'verify-ok', stack: 'static' })
  const passed = await agent.verifyProjectWorkspace(project.id)
  assert.equal(passed.allPassed, true)
  assert.ok(passed.results.some((item) => item.label.includes('index.html') && item.passed))

  const broken = await work.createProject({ name: 'verify-broken', stack: 'static' })
  await work.projectDeleteFile(broken.id, 'index.html', { source: 'user' })
  const failed = await agent.verifyProjectWorkspace(broken.id)
  assert.equal(failed.allPassed, false)
  assert.ok(failed.results.some((item) => !item.passed))
})

test('detects the start command from package.json scripts', async () => {
  const project = await work.createProject({ name: 'start-cmd', stack: 'react-vite' })
  const command = await agent.detectStartCommand(project.id)
  assert.equal(command, 'npm run dev')
})

test('parses tool calls and final text from model output', () => {
  const call = agent.parseWorkResponse('{"tool":"write_file","params":{"path":"a.js","content":"x"}}')
  assert.equal(call.toolCall.tool, 'write_file')
  assert.equal(call.toolCall.params.path, 'a.js')

  const final = agent.parseWorkResponse('اكتملت المهمة بنجاح.')
  assert.equal(final.toolCall, undefined)
  assert.match(final.content, /اكتملت/)
})

test('lists and deletes projects without touching other workspaces', async () => {
  const project = await work.createProject({ name: 'to-delete', stack: 'static' })
  const projects = work.listProjects()
  assert.ok(projects.some((item) => item.id === project.id))
  await work.deleteProject(project.id)
  assert.equal(work.getProject(project.id), null)
  const tree = await sandbox.treeTool(project.id).catch((error) => ({ error: String(error.message) }))
  assert.ok(tree.error || tree.tree.length === 0)
})
