# Nados AI Web

موقع عربي متكامل مبني بـ React وVite، مع خادم Node يحافظ على مفاتيح مزودي الذكاء الاصطناعي بعيداً عن المتصفح.

## ميزات الذكاء الاصطناعي

- إجابات حقيقية ببث تدريجي عبر Responses API.
- نموذج واحد ظاهر للمستخدم باسم `Nados v1.0` يختار تلقائياً بين Gemini وGroq وOpenRouter وCloudflare Workers AI وHugging Face وOpenAI.
- بحث ويب حديث، بحث عميق متعدد المصادر، ووضع أكاديمي.
- مصادر فعلية مأخوذة من استشهادات البحث؛ لا توجد روابط وهمية في الوضع التجريبي.
- تحليل PDF وDOCX وXLSX وTXT وغيرها، وفهم الصور المرفقة.
- إدخال صورة من الكاميرا على الهاتف.
- توليد صور بأبعاد مربعة وأفقية وعمودية.
- تسجيل الصوت وتفريغه، وتحويل الإجابات إلى صوت.
- وضع محلي تجريبي تلقائي عند غياب المفتاح أو الخادم.

## التشغيل

يتطلب Node.js 20 أو أحدث.

```bash
npm install
copy .env.example .env
npm run dev
```

يفتح Vite الواجهة عادة على `http://127.0.0.1:5173`، ويعمل خادم API على `http://127.0.0.1:8787`. يمرر Vite كل طلبات `/api` إلى الخادم تلقائياً.

ضع مفتاح مزود واحد على الأقل داخل `.env`:

```env
GEMINI_API_KEY=...
# أو GROQ_API_KEY / OPENROUTER_API_KEY / HUGGINGFACE_TOKEN
# أو CLOUDFLARE_ACCOUNT_ID مع CLOUDFLARE_API_TOKEN
# ويبقى OPENAI_API_KEY اختيارياً للصور والصوت وميزات OpenAI.
```

لا تستخدم اسماً يبدأ بـ `VITE_` للمفتاح، لأن Vite يضمّن هذه القيم في كود المتصفح. ملفات `.env` السرية مستبعدة من Git، بينما يظل `.env.example` قابلاً للمشاركة.

## أوامر المشروع

```bash
npm run dev       # الواجهة والخادم معاً
npm run build     # فحص TypeScript وبناء الإنتاج
npm start         # خدمة API وملفات dist المبنية
```

## API

- `GET /api/health`: حالة الاتصال والميزات المتاحة.
- `POST /api/chat/stream`: محادثة SSE مع ملف اختياري حتى 20MB.
- `POST /api/images`: توليد الصور.
- `POST /api/audio/transcribe`: تحويل التسجيل إلى نص.
- `POST /api/audio/speech`: تحويل النص إلى MP3.

لا تظهر أسماء المزودين في واجهة المحادثة. يحاول `Nados v1.0` المزودين حسب `NADOS_PROVIDER_ORDER` وينتقل تلقائياً إلى التالي عند فشل أحدهم. يمكن مشاهدة حالة الربط فقط من الإعدادات. يدعم Gemini البحث المؤسس على Google والملفات والصور، بينما يوفّر OpenAI البحث والملفات والصور والصوت؛ بقية المزودين تعمل كبدائل سريعة للمحادثة النصية حسب النموذج المضبوط.

ملف Android المرفق لا يحتوي نموذجاً لغوياً قابلاً للنقل؛ التطبيق يستدعي خدمة Perplexity المحمية بتسجيل دخول ومصادقة جهاز. لهذا يستخدم الموقع موفّر API مملوكاً لك بدلاً من نسخ جلسة أو رموز دخول التطبيق.

## ملاحظات الأمان

- المفتاح يُقرأ على الخادم فقط.
- الطلبات النصية محدودة بـ 20000 حرف والملفات بـ 20MB.
- الملفات غير الصورية ترفع مؤقتاً لغرض التحليل ثم تُحذف بعد انتهاء الطلب.
- لا يرسل الخادم نص المحادثة إلى سجل المتصفح، ويستخدم `store: false` في Responses API.

التنفيذ مبني على توثيق OpenAI الرسمي لـ [Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses)، و[بحث الويب](https://developers.openai.com/api/docs/guides/tools-web-search)، و[إدخال الملفات](https://developers.openai.com/api/docs/guides/file-inputs)، و[الصوت](https://developers.openai.com/api/docs/guides/audio)، و[توليد الصور](https://developers.openai.com/api/docs/guides/image-generation).
