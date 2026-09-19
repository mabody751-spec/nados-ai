export const MAX_MESSAGE_CHARS = 2_000_000
export const MAX_MESSAGE_WORDS = 200_000
export const MAX_CONVERSATION_CHARS = 12_000_000
export const MAX_CONVERSATION_WORDS = 1_000_000
export const MAX_CONVERSATION_BYTES = MAX_CONVERSATION_CHARS * 8

export function validateConversationText(value) {
  const message = String(value || '').trim()
  const wordCount = message ? message.split(/\s+/u).length : 0

  if (!message || message.length > MAX_CONVERSATION_CHARS || wordCount > MAX_CONVERSATION_WORDS) {
    const error = new Error(`يجب أن تكون المحادثة بين حرف واحد و${MAX_CONVERSATION_CHARS.toLocaleString('en-US')} حرف، وبحد أقصى ${MAX_CONVERSATION_WORDS.toLocaleString('en-US')} كلمة.`)
    error.status = 400
    throw error
  }

  return message
}

export function validateMessageText(value) {
  const message = String(value || '').trim()
  const wordCount = message ? message.split(/\s+/u).length : 0
  if (!message || message.length > MAX_MESSAGE_CHARS || wordCount > MAX_MESSAGE_WORDS) {
    const error = new Error(`يجب أن تكون الرسالة بين حرف واحد و${MAX_MESSAGE_CHARS.toLocaleString('en-US')} حرف، وبحد أقصى ${MAX_MESSAGE_WORDS.toLocaleString('en-US')} كلمة.`)
    error.status = 400
    throw error
  }
  return message
}

export function validateConversationHistory(rawHistory, message) {
  let parsed = []
  if (rawHistory !== undefined && rawHistory !== null && rawHistory !== '') {
    if (Array.isArray(rawHistory)) {
      parsed = rawHistory
    } else {
      try {
        parsed = typeof rawHistory === 'string' ? JSON.parse(rawHistory) : JSON.parse(String(rawHistory))
      } catch {
        const error = new Error('ذاكرة المحادثة غير صالحة.')
        error.status = 400
        throw error
      }
    }
  }

  if (!Array.isArray(parsed)) parsed = []
  const history = parsed.slice(-4000).map((item) => ({
    role: item?.role === 'assistant' ? 'assistant' : 'user',
    content: String(item?.content || '').trim(),
  })).filter((item) => item.content)

  const combined = [...history.map((item) => item.content), message].join('\n')
  validateConversationText(combined)
  return history
}
