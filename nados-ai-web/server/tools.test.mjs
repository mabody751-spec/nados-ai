import test from 'node:test'
import assert from 'node:assert/strict'
import { listTools, toolRegistry } from './tools.mjs'

test('lists all six core tools', () => {
  const tools = listTools()
  const names = tools.map((tool) => tool.name)
  for (const expected of ['read_file', 'write_file', 'list_files', 'search_files', 'execute_command']) {
    assert.ok(names.includes(expected), `missing tool: ${expected}`)
  }
})

test('blocks sandbox escape attempts', async () => {
  await assert.rejects(() => toolRegistry.read_file.execute({ path: 'C:/Windows/System32/config.sys' }), /SANDBOX_ESCAPE/)
  await assert.rejects(() => toolRegistry.write_file.execute({ path: '../outside.txt', content: 'x' }), /SANDBOX_ESCAPE/)
  await assert.rejects(() => toolRegistry.read_file.execute({ path: '../../etc/passwd' }), /SANDBOX_ESCAPE/)
})

test('reads and writes files inside the sandbox', async () => {
  const written = await toolRegistry.write_file.execute({ path: 'sandbox-test.txt', content: 'محتوى اختبار' })
  assert.equal(written.written, true)
  const read = await toolRegistry.read_file.execute({ path: 'sandbox-test.txt' })
  assert.equal(read.content, 'محتوى اختبار')
})

test('blocks dangerous file types and commands', async () => {
  await assert.rejects(() => toolRegistry.write_file.execute({ path: 'malware.exe', content: 'x' }), /محجوب/)
  const blockedCmd = await toolRegistry.execute_command.execute({ cmd: 'npm install evil-package' })
  assert.match(blockedCmd.output, /غير مسموح/)
})

test('lists files with node_modules excluded', async () => {
  const listing = await toolRegistry.list_files.execute({ dir: '.' })
  assert.ok(listing.files.length > 5)
  assert.equal(listing.files.some((file) => file.name === 'node_modules'), false)
})
