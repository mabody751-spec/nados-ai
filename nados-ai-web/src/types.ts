import type { ModelId, SearchMode } from './api'

export type View = 'home' | 'chat' | 'discover' | 'library' | 'spaces' | 'studio' | 'computer' | 'connectors'

export interface HistoryItem {
  id: string
  title: string
  mode: SearchMode
  model: ModelId
  createdAt: string
  saved: boolean
}

export interface Space {
  id: string
  title: string
  description: string
  emoji: string
  files: number
  threads: number
  visibility: 'private' | 'shared'
}

export interface AppSettings {
  dark: boolean
  incognito: boolean
  memory: boolean
  citations: boolean
  language: 'ar' | 'en'
}

export const initialHistory: HistoryItem[] = [
  { id: 'h1', title: 'مستقبل الذكاء الاصطناعي في التعليم', mode: 'research', model: 'nados-v1', createdAt: 'اليوم', saved: true },
  { id: 'h2', title: 'خطة إطلاق منتج رقمي', mode: 'web', model: 'nados-v1', createdAt: 'أمس', saved: false },
  { id: 'h3', title: 'تلخيص أفكار كتاب العادات الذرية', mode: 'files', model: 'nados-v1', createdAt: 'منذ يومين', saved: true },
  { id: 'h4', title: 'أفضل أدوات تنظيم الوقت', mode: 'web', model: 'nados-v1', createdAt: 'هذا الأسبوع', saved: false },
]

export const initialSpaces: Space[] = [
  { id: 's1', title: 'أبحاث المنتج', description: 'دراسة السوق والمنافسين وملاحظات العملاء.', emoji: 'P', files: 8, threads: 14, visibility: 'private' },
  { id: 's2', title: 'مساعد الدراسة', description: 'المراجع والمحاضرات وخطط المراجعة.', emoji: 'D', files: 12, threads: 9, visibility: 'shared' },
  { id: 's3', title: 'أفكار المحتوى', description: 'مسودات وأبحاث وجدول النشر الأسبوعي.', emoji: 'C', files: 4, threads: 21, visibility: 'private' },
]
