export const AGENT_MODES = {
  ask: {
    slug: 'ask',
    name: 'اسأل',
    roleDefinition: 'أنت مساعد تقني داخل Nados. أجب على الأسئلة بوضوح ودقة. لا تعدّل أي ملف إطلاقاً. يمكنك القراءة والبحث فقط.',
    tools: ['read_file', 'list_files', 'search_files', 'execute_command'],
    fileRegex: null,
    canSpawnSubagents: false,
    color: '#5C8CD5',
  },
  architect: {
    slug: 'architect',
    name: 'معماري',
    roleDefinition: 'أنت مهندس معماري. خطط قبل التنفيذ. اكتب خطة تفصيلية في ملفات .md داخل مجلد plans/. لا تكتب كوداً تنفيذياً إطلاقاً — خطط فقط.',
    tools: ['read_file', 'list_files', 'search_files', 'write_file'],
    fileRegex: '\\.md$',
    canSpawnSubagents: true,
    color: '#14B8A6',
  },
  code: {
    slug: 'code',
    name: 'برمجة',
    roleDefinition: 'أنت مهندس برمجيات. نفّذ المهمة كاملة. اكتب كوداً نظيفاً قابلاً للتشغيل، اختبره ذهنياً، وأصلح الأخطاء فور ظهورها.',
    tools: ['read_file', 'write_file', 'list_files', 'search_files', 'execute_command'],
    fileRegex: null,
    canSpawnSubagents: true,
    color: '#35B8A9',
  },
  debug: {
    slug: 'debug',
    name: 'تصحيح',
    roleDefinition: 'أنت مدقق أخطاء. اتبع المنهجية الصارمة: 1) اجمع معلومات الخطأ بقراءة الملفات ذات الصلة 2) ضيّق نطاق المشكلة 3) اقترح إصلاحات مرتبة حسب الاحتمالية 4) طبّق الإصلاح وتحقق منه.',
    tools: ['read_file', 'write_file', 'list_files', 'search_files', 'execute_command'],
    fileRegex: null,
    canSpawnSubagents: true,
    color: '#EB654B',
  },
  orchestrator: {
    slug: 'orchestrator',
    name: 'منسّق',
    roleDefinition: 'أنت منسّق مهام. وزّع المهام على وكلاء فرعيين متخصصين. لا تنفذ بنفسك أبداً — خطط ووزّع واجمع النتائج فقط.',
    tools: ['read_file', 'list_files', 'search_files'],
    fileRegex: null,
    canSpawnSubagents: true,
    color: '#D97706',
  },
  research: {
    slug: 'research',
    name: 'بحث',
    roleDefinition: 'أنت باحث متخصص. نفّذ بحثاً مكثفاً متعدد المصادر بمنهجية: 1) حلّل السؤال وولّد أسئلة فرعية 2) ابحث في مصادر متعددة 3) تحقق من كل معلومة من مصدرين على الأقل 4) ميّز بين الموثق والاستنتاج 5) أنتج تقريراً منسقاً بـ Markdown مع استشهادات كاملة.',
    tools: ['read_file', 'write_file', 'list_files', 'search_files'],
    fileRegex: null,
    canSpawnSubagents: true,
    color: '#14B8A6',
  },
}

export function getMode(slug) {
  return AGENT_MODES[String(slug || '').toLowerCase()] || AGENT_MODES.ask
}

export function modeToolsAllowed(slug) {
  return new Set(getMode(slug).tools)
}

export function modeAllowsFile(slug, filePath) {
  const mode = getMode(slug)
  if (!mode.fileRegex) return true
  return new RegExp(mode.fileRegex, 'i').test(String(filePath || ''))
}
