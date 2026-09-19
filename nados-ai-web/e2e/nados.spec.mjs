import { test, expect } from '@playwright/test'

const sseReply = [
  { type: 'status', status: 'connected' },
  { type: 'meta', provider: 'e2e-provider' },
  { type: 'delta', delta: 'NADOS_UI_OK\n\n```html\n<div id="nados-preview">Preview OK</div>\n```' },
  {
    type: 'done',
    reply: {
      answer: ['NADOS_UI_OK\n\n```html\n<div id="nados-preview">Preview OK</div>\n```'],
      bullets: [],
      sources: [],
      provider: 'e2e-provider',
      demo: false,
    },
  },
].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')

async function storedSessions(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('nados-ai-memory', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const read = database.transaction('sessions', 'readonly').objectStore('sessions').get('all-v2')
      read.onerror = () => reject(read.error)
      read.onsuccess = () => {
        database.close()
        resolve(read.result || [])
      }
    }
  }))
}

test('chat, code tools, provider status, and session memory work together', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:5174' })
  await page.route('**/api/models', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ models: [
      { id: 'nados-v1', label: 'Nados v1.0', providerId: 'auto', provider: 'توجيه تلقائي', model: 'أفضل نموذج متاح', webSearch: true, vision: true, files: true },
      { id: 'test-gemini', label: 'gemini-test-model', providerId: 'gemini', provider: 'Gemini API / AI Studio', model: 'gemini-test-model', webSearch: true, vision: true, files: true },
    ] }),
  }))
  await page.route('**/api/chat/stream', (route) => route.fulfill({
    status: 200,
    contentType: 'text/event-stream; charset=utf-8',
    body: sseReply,
  }))

  await page.goto('/')
  await expect(page.getByText('Nados v1.0').first()).toBeVisible()
  await page.getByRole('button', { name: 'الإعدادات' }).click()
  await expect(page.getByText('8 مزود متصل · تشغيل متوازٍ', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'إغلاق' }).click()

  await page.getByRole('button', { name: 'اختيار نموذج Nados' }).click()
  await expect(page.getByRole('listbox', { name: 'نماذج Nados المتاحة' })).toBeVisible()
  await page.getByRole('option', { name: /gemini-test-model/ }).click()
  await expect(page.getByRole('button', { name: 'اختيار نموذج Nados' })).toContainText('gemini-test-model')

  const composer = page.getByRole('textbox', { name: 'اكتب سؤالك' })
  await composer.fill('اختبار واجهة Nados')
  await page.getByRole('button', { name: 'إرسال' }).click()
  await expect(page.getByText('NADOS_UI_OK')).toBeVisible()

  const codeBlock = page.locator('.code-block')
  await expect(codeBlock).toBeVisible()
  await codeBlock.getByRole('button', { name: 'نسخ' }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('nados-preview')
  await codeBlock.getByRole('button', { name: 'معاينة' }).click()
  await expect(codeBlock.locator('iframe.code-preview')).toBeVisible()
  await expect(codeBlock.locator('iframe').contentFrame().locator('#nados-preview')).toHaveText('Preview OK')

  await expect.poll(async () => (await storedSessions(page)).length).toBe(1)
  const beforeReload = await storedSessions(page)
  expect(beforeReload[0].messages).toHaveLength(2)
  expect(beforeReload[0].model).toBe('test-gemini')
  await page.reload()
  await expect(page.getByText('NADOS_UI_OK')).toBeVisible()
  await expect(page.getByRole('button', { name: 'اختيار نموذج Nados' })).toContainText('gemini-test-model')

  await page.getByRole('button', { name: /محادثة جديدة/ }).click()
  await expect(page.getByRole('textbox', { name: 'اكتب سؤالك' })).toHaveValue('')
  await expect.poll(async () => (await storedSessions(page)).length).toBe(2)
})

test('long user messages stay compact and can be expanded', async ({ page }) => {
  await page.route('**/api/chat/stream', (route) => route.fulfill({
    status: 200,
    contentType: 'text/event-stream; charset=utf-8',
    body: sseReply,
  }))

  await page.goto('/')
  const longMessage = 'تفاصيل المشروع '.repeat(80)
  await page.getByRole('textbox').fill(longMessage)
  await page.locator('.send-button').click()

  const message = page.locator('.user-message').last()
  const toggle = page.locator('.user-message-toggle').last()
  await expect(message).toHaveClass(/user-message--collapsed/)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(message).not.toHaveClass(/user-message--collapsed/)
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await toggle.click()
  await expect(message).toHaveClass(/user-message--collapsed/)
})
