// A large single-message budget comparable to modern long-context chat UIs.
export const MAX_MESSAGE_CHARS = 1_000_000
export const MAX_MESSAGE_WORDS = 150_000
export const MAX_CONVERSATION_CHARS = 8_000_000
export const MAX_CONVERSATION_WORDS = 1_000_000

export function countWords(value: string) {
  return value.trim() ? value.trim().split(/\s+/u).length : 0
}
