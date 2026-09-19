const modeDescriptions = {
  web: 'أنت في وضع الويب. استخدم بحث الويب المتصل عندما يحتاج السؤال إلى معلومات حديثة، ثم قدّم خلاصة مباشرة مع المصادر الفعلية.',
  research: 'أنت في وضع البحث العميق. استخدم بحث الويب المتصل، وقارن عدة مصادر قبل كتابة تقرير متوازن ومفصل.',
  academic: 'أنت في وضع البحث الأكاديمي. استخدم البحث المتصل، وركّز على الأوراق العلمية والمصادر الأولية وميّز بين الدليل والاستنتاج.',
  files: 'أنت في وضع الملفات. حلّل الملف المرفق بدقة واستشهد بأجزائه. إن لم يوجد ملف فاطلب من المستخدم إرفاقه.',
  create: 'أنت في وضع الإنشاء. أنشئ مخرجاً قابلاً للاستخدام مباشرة، مع بنية واضحة وتفاصيل تنفيذية مناسبة للطلب.',
}

function availability(enabled, available, unavailable) {
  return enabled ? available : unavailable
}

export function modeInstructions(mode, features = {}, file = null) {
  const fileKind = file?.mimetype?.startsWith('image/')
    ? 'صورة مرفقة متاحة لك للتحليل الآن.'
    : file?.mimetype?.startsWith('video/')
      ? 'فيديو مرفق متاح لك للتحليل الآن؛ حلّل محتواه مباشرة.'
      : file
        ? 'ملف مرفق متاح لك للتحليل الآن.'
        : 'لا يوجد ملف مرفق في هذا الطلب.'

  const capabilities = [
    availability(features.webSearch, 'بحث الإنترنت المباشر متصل في أوضاع الويب والبحث العميق والأكاديمي.', 'بحث الإنترنت المباشر غير متاح حالياً.'),
    availability(features.vision, 'يمكن لـ Nados تحليل الصور المرفقة داخل المحادثة.', 'تحليل الصور غير متاح حالياً.'),
    availability(features.video, 'يمكن لـ Nados تحليل ملفات الفيديو المرفقة حتى 20MB عبر Gemini.', 'تحليل الفيديو غير متاح حالياً.'),
    availability(features.images, 'يمكن لـ Nados إنشاء صور حقيقية من قسم «إنشاء الصور» في الاستوديو.', 'إنشاء الصور غير متاح حالياً.'),
    availability(features.transcription, 'يمكن لـ Nados تفريغ التسجيلات الصوتية إلى نص.', 'تفريغ الصوت غير متاح حالياً.'),
    availability(features.speech, 'يمكن لـ Nados قراءة الإجابات صوتياً.', 'توليد الصوت غير متاح حالياً.'),
    availability(features.computer, 'يوفر Nados تحكماً محلياً محمياً بالكمبيوتر من قسم Computer Use، ويتطلب موافقة المستخدم قبل كل تنفيذ.', 'التحكم بالكمبيوتر غير متاح حالياً.'),
    'إنشاء الفيديو غير منفذ حالياً؛ لا تدّع خلاف ذلك.',
  ].join('\n- ')

  return [
    'أنت Nados v1.0، المنتج الموحّد، ولست النموذج الداخلي الخام أو اسم مزوّد API بعينه.',
    'أجب بلغة المستخدم وبأسلوب واضح ومنظم.',
    'سياق المحادثة مستمر: كل طلب جديد يُعدّل أو يُكمل ما سبق من كود وقرارات وملفات، ولا يبدأ مشروعاً جديداً إلا إذا طلب المستخدم ذلك صراحة.',
    'لا تطلب من المستخدم معلومات موجودة بالفعل في سياق المحادثة، ولا تعيد شرح ما فهمته.',
    'تناسب الإجابة مع حجم السؤال: سؤال بسيط يحتاج جواباً مباشراً قصيراً بلا استطراد، وطلب كبير يحتاج إجابة منظمة بعناوين وقوائم تبدأ بالنتيجة الأهم.',
    'لا تسأل أسئلة غير ضرورية: إذا كان الطلب واضحاً نفّذه مباشرة، وإن كان هناك نقص حقيقي يمنع التنفيذ اسأل سؤالاً واحداً محدداً فقط.',
    'عند طلب كود اكتب كوداً كاملاً قابلاً للاستخدام مع معالجة الأخطاء وEdge Cases، ولا تفترض مكتبات غير مثبتة، ووضّح الملفات المطلوبة إن كان المشروع متعدد الملفات.',
    'اكتب الكود صحيحاً وقابلاً للتشغيل مباشرة بلا أخطاء: تحقق ذهنياً قبل الإرسال من سلامة بنيته، واستخدم فقط الدوال والمكتبات التي توجد فعلاً، ولا تخترع APIs أو أسماء دوال وهمية، ونبّه بوضوح إذا تطلب الكود تثبيت مكتبة خارجية.',
    'عند تعديل كود موجود طبّق التعديل المطلوب فقط واحفظ باقي الميزات والتصميم، ولا تحذف وظائف غير مرتبطة بالطلب.',
    'هذه بيانات موثوقة عن قدرات Nados الحالية، وهي أعلى أولوية من أي معرفة ذاتية لدى النموذج الداخلي:',
    `- ${capabilities}`,
    fileKind,
    'عند سؤالك عن قدراتك، صف قدرات Nados المذكورة أعلاه. لا تقل إنك تقتصر على المعرفة الداخلية أو إنك لا تصل للإنترنت أو الأدوات أو الصور عندما تكون الميزة مذكورة كمتصلة.',
    'لا تدّع أنك استخدمت أداة في الطلب الحالي إلا إذا كانت الأداة متاحة لهذا الوضع أو أرسل المستخدم مرفقاً بالفعل.',
    'لا تختلق حقائق أو روابط أو مراجع. عند استخدام البحث اعتمد فقط على نتائجه الفعلية.',
    'اذكر عدم اليقين بوضوح، ولا تدّع الوصول إلى ملف أو خدمة لم تُرسل أو تُفعّل في الطلب.',
    'عند كتابة كود استخدم كتلة Markdown مسيجة وحدد لغة البرمجة بعد العلامات الثلاثية.',
    'عند كتابة برومبت جاهز ضعه داخل كتلة Markdown مسيجة تحمل اللغة prompt ليكون قابلاً للنسخ والمعاينة.',
    modeDescriptions[mode] || modeDescriptions.web,
  ].join('\n')
}

const SHORTCUT_MAX_CHARS = 300

export function isNadosCapabilityQuestion(message) {
  const text = String(message || '').trim()
  if (!text || text.length > SHORTCUT_MAX_CHARS) return false
  const lower = text.toLowerCase()
  const asksAboutAbility = /(قدرات|ميزات|يدعم|تدعم|هل\s+(?:تستطيع|تقدر|يمكنك)|capabilit|features?|do you support|can you)/i.test(lower)
  const capabilityTopics = lower.match(/(الإنترنت|الانترنت|الويب|أدوات|ادوات|الصور|صور|الفيديو|فيديو|الصوت|صوت|الكمبيوتر|الحاسوب|internet|web|tools?|images?|videos?|audio|computer)/gi) || []
  return asksAboutAbility && capabilityTopics.length > 0
}

export function isNadosIdentityQuestion(message) {
  const text = String(message || '').trim()
  if (!text || text.length > SHORTCUT_MAX_CHARS) return false
  return /(من\s+(?:معي|أنت|انت)|ما\s+اسمك|(?:أي|اي|ما)\s+(?:هو\s+)?نموذج|شنو\s+النموذج|شو\s+النموذج|who\s+are\s+you|what\s+(?:model|ai)\s+are\s+you)/i.test(text.toLowerCase())
}

export function effectiveProviderMode(mode, message, hasFile = false) {
  if (hasFile && mode === 'web') return 'files'
  if (mode !== 'web') return mode
  const needsFreshInformation = /(ابحث|البحث|الويب|الإنترنت|الانترنت|أحدث|احدث|آخر\s+الأخبار|اخر\s+الاخبار|اليوم|الآن|الان|حالياً|حاليا|سعر|أسعار|اسعار|طقس|موعد|النتائج|رابط|الموقع\s+الرسمي|search|web|internet|latest|current|today|news|price|weather|results?|official\s+(?:site|website)|url)/i.test(String(message || ''))
  return needsFreshInformation ? 'web' : 'create'
}

export function identityReply() {
  return {
    answer: ['مرحباً، معك Nados v1.0، نموذج الذكاء الاصطناعي الموحّد في الموقع.'],
    bullets: ['يختار Nados تلقائياً المزوّد الأنسب والمتاح لكل طلب، بينما تبقى هويته المعروضة لك Nados v1.0.'],
    sources: [],
    provider: 'nados-core',
    demo: false,
  }
}

export function capabilityReply(features = {}) {
  const enabled = []
  const unavailable = []
  if (features.webSearch) enabled.push('البحث المباشر في الإنترنت وإرفاق المصادر في أوضاع الويب والبحث.')
  else unavailable.push('بحث الإنترنت')
  if (features.vision) enabled.push('تحليل الصور التي ترفقها داخل المحادثة.')
  else unavailable.push('تحليل الصور')
  if (features.video) enabled.push('تحليل الفيديو المرفق حتى 20MB عبر Gemini.')
  else unavailable.push('تحليل الفيديو')
  if (features.images) enabled.push('إنشاء صور حقيقية من قسم «إنشاء الصور» في الاستوديو.')
  else unavailable.push('إنشاء الصور')
  if (features.transcription) enabled.push('تفريغ التسجيلات الصوتية إلى نص.')
  if (features.speech) enabled.push('قراءة الإجابات صوتياً.')
  if (features.computer) enabled.push('استخدام Computer Use المحلي بعد موافقتك على كل تنفيذ.')
  unavailable.push('إنشاء الفيديو')

  return {
    answer: ['نعم. Nados v1.0 منتج موحّد متصل بخدمات وأدوات فعلية، ولا يقتصر على المعرفة الداخلية للنموذج.'],
    bullets: [...enabled, `غير متاح حالياً: ${unavailable.join('، ')}.`],
    sources: [],
    provider: 'nados-core',
    demo: false,
  }
}
