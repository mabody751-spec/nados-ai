# نشر Nados API على خادم دائم (Phase 0)

الهدف: إزالة النفق (Quick Tunnel) والاعتماد على جهاز المستخدم، وربط Cloudflare Worker بـ**نطاق ثابت**. لا تُرفع أي أسرار إلى المستودع.

## 1) ابنِ حزمة الويب (مطلوبة قبل بناء الصورة)
```bash
cd nados-ai-web
npm ci
npm run build
```

## 2) شغّل الصورة محلياً للتحقق (اختياري)
```bash
docker build -t nados-api .
docker run --rm -p 8787:8787 --env-file .env nados-api
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/readyz
```

## 3) النشر — اختر مضيفاً

### Render (الأسهل)
1. اربط المستودع على render.com → **New → Blueprint** → اختر `nados-ai-web/render.yaml`.
2. أضف المتغيرات السرية من لوحة Render (لا تُكتب في Git):
   `NADOS_PROXY_TOKEN, GEMINI_API_KEY, GROQ_API_KEY, NVIDIA_API_KEY, OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY`.
3. انسخ رابط الخدمة الثابت (مثل `https://nados-api.onrender.com`).

### Fly.io
```bash
cd nados-ai-web
fly launch --no-deploy --copy-config
fly volumes create nados_data -s 1
fly secrets set NADOS_PROXY_TOKEN=... GEMINI_API_KEY=... GROQ_API_KEY=... NVIDIA_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
fly deploy
```

## 4) اربط Cloudflare Worker بالنطاق الثابت
عدّل `nados-ai-web/wrangler.jsonc`:
```jsonc
"vars": { "API_TARGET": "https://<your-backend-domain>" }
```
ثم:
```bash
npx wrangler deploy
```
> بعد هذا، لم يعد النفق مطلوباً، ولن يظهر «خادم Nados غير متصل» عند إطفاء جهازك.

## 5) تحقق E2E
```bash
node scripts/smoke.mjs https://<your-backend-domain> <NADOS_PROXY_TOKEN>
```

## 6) CI (GitHub Actions)
- `.github/workflows/backend.yml` يبني صورة ويرفعها إلى GHCR، وينشر تلقائياً إذا وُجد:
  `RENDER_DEPLOY_HOOK` أو `FLY_API_TOKEN` في أسرار المستودع.
- `.github/workflows/android.yml` يبني APK/AAB.

## ملاحظات
- الأسرار تبقى على الخادم فقط؛ لا شيء منها داخل APK أو الويب.
- في المتصفح/التطبيق، طلبات `/api` تمر عبر Worker إلى نطاقك الثابت (مع رمز النفق عند تفعيله).
- مسارات التدريب/Work محليّة فقط (requireLocalOrigin) ولا تُفعّل عن بُعد.
