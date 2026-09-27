import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempRoot = await mkdtemp(join(tmpdir(), 'nados-sandbox-test-'))
process.env.NADOS_WORKSPACES_ROOT = tempRoot
process.env.NADOS_SANDBOX_ROOT = tempRoot

const sandbox = await import('./sandbox/index.mjs')
const work = await import('./workProjects.mjs')

test.after(async () => {
  await sandbox.stopAllServers()
  await rm(tempRoot, { recursive: true, force: true }).catch(() => {})
})

test('rejects invalid project ids', () => {
  assert.throws(() => sandbox.projectRoot('../escape'), /INVALID_PROJECT/)
  assert.throws(() => sandbox.projectRoot('a/b'), /INVALID_PROJECT/)
  assert.throws(() => sandbox.projectRoot(''), /INVALID_PROJECT/)
})

test('blocks absolute paths and traversal', () => {
  assert.throws(() => sandbox.safePath('proj1', 'C:/Windows/System32/config.sys'), /SANDBOX_ESCAPE/)
  assert.throws(() => sandbox.safePath('proj1', '../../etc/passwd'), /SANDBOX_ESCAPE/)
  assert.throws(() => sandbox.safePath('proj1', '/etc/passwd'), /SANDBOX_ESCAPE/)
  assert.throws(() => sandbox.safePath('proj1', '..\\..\\windows\\win.ini'), /SANDBOX_ESCAPE/)
  assert.throws(() => sandbox.safePath('proj1', 'src/../../outside.txt'), /SANDBOX_ESCAPE/)
})

test('allows nested relative paths inside the project', () => {
  const resolved = sandbox.safePath('proj1', 'src/components/App.jsx')
  assert.ok(resolved.startsWith(sandbox.WORKSPACES_ROOT))
  assert.ok(resolved.endsWith(join('proj1', 'src', 'components', 'App.jsx')))
})

test('writes, reads, edits, moves, copies and deletes real files', async () => {
  const projectId = 'crud-project'
  const written = await sandbox.writeFileTool(projectId, 'src/app.js', 'const a = 1\n')
  assert.equal(written.created, true)
  assert.ok(written.bytes > 0)

  const read = await sandbox.readFileTool(projectId, 'src/app.js')
  assert.equal(read.content, 'const a = 1\n')

  const edited = await sandbox.editFileTool(projectId, 'src/app.js', { find: '1', replace: '2' })
  assert.equal(edited.replacements, 1)
  assert.equal((await sandbox.readFileTool(projectId, 'src/app.js')).content, 'const a = 2\n')

  await sandbox.createDirectoryTool(projectId, 'lib')
  await sandbox.copyFileTool(projectId, 'src/app.js', 'lib/app.js')
  await sandbox.moveFileTool(projectId, 'lib/app.js', 'lib/app2.js')
  const listing = await sandbox.listFilesTool(projectId, 'lib')
  assert.deepEqual(listing.files.map((file) => file.name), ['app2.js'])

  await sandbox.deleteFileTool(projectId, 'lib')
  await assert.rejects(() => sandbox.readFileTool(projectId, 'lib/app2.js'), /NOT_FOUND/)
})

test('blocks writing executable file types', async () => {
  await assert.rejects(() => sandbox.writeFileTool('crud-project', 'malware.exe', 'x'), /BLOCKED_TYPE/)
})

test('searches inside project files only', async () => {
  await sandbox.writeFileTool('search-project', 'src/hello.js', 'export const greeting = "مرحبا بالعالم"\n')
  await sandbox.writeFileTool('search-project', 'src/other.js', 'export const value = 42\n')
  const result = await sandbox.searchFilesTool('search-project', 'مرحبا')
  assert.equal(result.total, 1)
  assert.equal(result.results[0].file, 'src/hello.js')
})

test('blocks dangerous commands and shell metacharacters', async () => {
  await assert.rejects(() => sandbox.executeCommandTool('cmd-project', 'powershell -Command "Get-Process"'), /COMMAND_BLOCKED/)
  await assert.rejects(() => sandbox.executeCommandTool('cmd-project', 'curl http://example.com'), /COMMAND_BLOCKED/)
  await assert.rejects(() => sandbox.executeCommandTool('cmd-project', 'node -e "console.log(1)"'), /COMMAND_BLOCKED/)
  await assert.rejects(() => sandbox.executeCommandTool('cmd-project', 'npm install lodash | whoami'), /COMMAND_BLOCKED/)
  await assert.rejects(() => sandbox.executeCommandTool('cmd-project', 'git push origin main'), /COMMAND_BLOCKED/)
  await assert.rejects(() => sandbox.executeCommandTool('cmd-project', 'node ../../etc/passwd'), /SANDBOX_ESCAPE|COMMAND_BLOCKED/)
})

test('executes a real allowed command and reports exit code', async () => {
  const ok = await sandbox.executeCommandTool('cmd-project', 'node --version')
  assert.equal(ok.status, 'success')
  assert.equal(ok.exitCode, 0)
  assert.match(ok.stdout, /v\d+\./)

  const bad = await sandbox.executeCommandTool('cmd-project', 'node --definitely-not-a-flag')
  assert.notEqual(bad.exitCode, 0)
  assert.equal(bad.status, 'failed')
  assert.ok(bad.stderr.length > 0)
})

test('redacts secrets from command output', () => {
  const redacted = sandbox.redactSecrets('token=sk-abcdef1234567890 and api_key=SUPERSECRETVALUE')
  assert.ok(!redacted.includes('sk-abcdef1234567890'))
  assert.ok(!redacted.includes('SUPERSECRETVALUE'))
})

test('starts, detects and stops a real background server', async () => {
  const projectId = 'server-project'
  await sandbox.writeFileTool(projectId, 'server.mjs', `import { createServer } from 'node:http'
const port = 4319
createServer((_request, response) => { response.writeHead(200); response.end('nados-ok') }).listen(port, '127.0.0.1', () => console.log('listening on http://127.0.0.1:' + port))
`)
  const started = await sandbox.startServer(projectId, 'node server.mjs')
  assert.equal(started.started, true, JSON.stringify(started.logs))
  assert.equal(started.port, 4319)
  const check = await sandbox.verifyHttp(`http://127.0.0.1:${started.port}/`)
  assert.equal(check.ok, true)
  assert.equal(check.status, 200)
  const stopped = await sandbox.stopServer(projectId)
  assert.equal(stopped.stopped, true)
  assert.equal(sandbox.getServer(projectId), null)
})

test('exports a real ZIP archive with entries', async () => {
  const project = await work.createProject({ name: 'zip-test', stack: 'static', userId: 'tester' })
  const archive = await sandbox.exportZip(project.id)
  assert.ok(archive.bytes > 0)
  assert.ok(archive.entries >= 3, `expected entries, got ${archive.entries}`)
  await rm(archive.path, { force: true }).catch(() => {})
})

test('execution probe confirms a writable workspace', async () => {
  const probe = await sandbox.probeExecution()
  assert.equal(probe.ok, true)
})
