const THINKING_STEPS = {
  ANALYZE: 'analyze',
  PLAN: 'plan',
  SEARCH: 'search',
  EXTRACT: 'extract',
  SYNTHESIZE: 'synthesize',
  VERIFY: 'verify',
  CONCLUDE: 'conclude',
}

const STEP_LABELS = {
  analyze: '🔍 تحليل السؤال',
  plan: '📋 تخطيط البحث',
  search: '🔍 تنفيذ البحث',
  extract: '📥 استخراج المعلومات',
  synthesize: '🧩 التركيب والتحليل',
  verify: '✅ التحقق من المصادر',
  conclude: '🎯 الاستنتاج النهائي',
}

function createThinkingSession() {
  return {
    steps: [],
    currentStep: null,
    startTime: Date.now(),
    tokensUsed: 0,
    addStep(type, content, metadata = {}) {
      const step = {
        type,
        label: STEP_LABELS[type] || type,
        content,
        metadata,
        timestamp: Date.now(),
        duration: 0,
      }
      if (this.currentStep) {
        this.currentStep.duration = Date.now() - this.currentStep.timestamp
      }
      this.currentStep = step
      this.steps.push(step)
      return step
    },
    complete() {
      if (this.currentStep) {
        this.currentStep.duration = Date.now() - this.currentStep.timestamp
      }
      return {
        steps: this.steps,
        totalDuration: Date.now() - this.startTime,
        totalSteps: this.steps.length,
      }
    },
    getSteps() {
      return this.steps.map((s) => ({
        type: s.type,
        label: s.label,
        content: s.content,
        duration: s.duration,
      }))
    },
  }
}

function buildChainOfThoughtPrompt(query, context = {}) {
  const { mode = 'create', sources = [], language = 'ar' } = context
  const langInstructions = language === 'ar'
    ? 'فكِّر بالعربية، وأجب بالعربية الفصحى.'
    : 'Think in English, respond in English.'

  const basePrompt = `أنت باحث خبير ومحلل عميق. مهمتك هي تقديم إجابة شاملة ودقيقة ومنظمة.

${langInstructions}

اتبع عملية التفكير التالية خطوة بخطوة:

1. **تحليل السؤال** (Analyze): افهم المطلوب بدقة، وحدد المصطلحات الأساسية، والقيود، والهدف النهائي.
2. **تخطيط البحث** (Plan): حدد ما المعلومات المطلوبة، وما المصادر الموثوقة، وما خطوات التحقق.
3. **تنفيذ البحث** (Search): صغ استعلامات دقيقة، ابحث في مصادر متعددة وموثوقة.
4. **استخراج المعلومات** (Extract): استخرج النقاط الجوهرية، والأرقام، والتواريخ، والآراء الموثوقة.
5. **التركيب والتحليل** (Synthesize): اربط المعلومات، قارن وجهات النظر، وحدد التناقضات.
6. **التحقق من المصادر** (Verify): تأكد من موثوقية كل مصدر، وتحقق من التواريخ والمصداقية.
7. **الاستنتاج النهائي** (Conclude): صغ الإجابة النهائية منظمة، مدعومة بالأدلة، مع الإشارة للمصادر.

**تنسيق الإخراج المطلوب:**
\`\`\`thinking
خطوة 1 - تحليل: [تحليلك هنا]
خطوة 2 - تخطيط: [خطتك هنا]
خطوة 3 - بحث: [ما بحثته]
خطوة 4 - استخراج: [ما استخرجته]
خطوة 4 - تركيب: [كيف ربطت المعلومات]
خطوة 5 - تحقق: [كيف تحققت]
خطوة 6 - استنتاج: [استنتاجك النهائي]
\`\`\`

**الإجابة النهائية:** [إجابتك النهائية منظمة، مع استشهاد بالمصادر بأرقامها]

---

السؤال: ${query}

${context.sources && context.sources.length > 0 ? `المصادر المتاحة:\n${context.sources.map((s, i) => `[${i + 1}] ${s.title}: ${s.snippet || 'لا يوجد ملخص'} (${s.url})`).join('\n')}` : ''}`

  return basePrompt
}

function parseThinkingOutput(text) {
  const thinkingMatch = text.match(/```thinking\n([\s\S]*?)```/)
  const thinkingBlock = thinkingMatch ? thinkingMatch[1].trim() : null

  const steps = []
  if (thinkingBlock) {
    const stepRegex = /خطوة\s+(\d+)\s*[-–]\s*(\w+)\s*[:：]\s*([\s\S]*?)(?=\n\s*خطوة\s+\d+|$)/g
    let match
    while ((match = stepRegex.exec(thinkingBlock)) !== null) {
      steps.push({
        step: parseInt(match[1]),
        type: match[2].trim(),
        content: match[3].trim(),
      })
    }
  }

  const answerMatch = text.match(/الإجابة النهائية[:：]\s*([\s\S]*?)(?:\n```|$)/)
  const finalAnswer = answerMatch ? answerMatch[1].trim() : text.replace(/```thinking[\s\S]*?```/, '').trim()

  return {
    thinking: thinkingBlock,
    steps,
    finalAnswer,
    raw: text,
  }
}

function formatThinkingForUI(thinkingSession) {
  const result = thinkingSession.complete()
  const steps = result.steps
  const totalDuration = result.totalDuration
  const totalSteps = result.totalSteps
  return {
    steps: steps.map((s) => ({
      type: s.type,
      label: s.label,
      content: s.content,
      duration: s.duration,
    })),
    summary: {
      totalSteps: totalSteps,
      totalDuration: totalDuration,
      completed: true,
    },
  }
}

function buildStructuredPrompt(query, mode, options = {}) {
  const { language = 'ar', depth = 'deep', sources = [] } = options
  const depthInstructions = {
    quick: 'أجب بإيجاز في 2-3 فقرات.',
    standard: 'أجب بتفصيل مع أمثلة وروابط.',
    deep: 'أجب بتحليل عميق متعدد المستويات، مع استشهاد دقيق بالمصادر، وتحليل نقدي، ومقارنة وجهات النظر.',
  }

  const modeInstructions = {
    web: 'استخدم بحث الويب للمعلومات الحديثة.',
    research: 'قم ببحث عميق متعدد الخطوات، قارن مصادر متعددة.',
    academic: 'ركز على المصادر الأكاديمية والورقية، ميز بين الدليل والاستنتاج.',
    create: 'أنشئ محتوى أصلي قابل للاستخدام مباشرة.',
  }

  return `أنت Nados، باحث ذكي ومساعد خبير. ${language === 'ar' ? 'فكِّر بالعربية وأجب بالعربية.' : 'Think in English, respond in English.'}

**نمط التفكير:** ${depthInstructions[depth] || depthInstructions.deep}
**الوضع:** ${modeInstructions[mode] || modeInstructions.create}

**السؤال:** ${query}

${context.sources && context.sources.length > 0 ? `\nالمصادر المتاحة:\n${context.sources.map((s, i) => `[${i + 1}] ${s.title}: ${s.snippet || 'لا يوجد ملخص'} (${s.url})`).join('\n')}` : ''}

اتبع عملية التفكير المنظمة وأخرج تفكيرك في كتلة \`\`\`thinking ثم الإجابة النهائية.`
}

export {
  createThinkingSession,
  buildChainOfThoughtPrompt,
  parseThinkingOutput,
  formatThinkingForUI,
  buildStructuredPrompt,
  THINKING_STEPS,
  STEP_LABELS,
}
