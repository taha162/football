# النشر على Vercel

يشرح هذا الدليل نشر التطبيق على **Vercel** مع قاعدة بيانات على **Supabase**. الأوامر والأسماء بالإنجليزية كما تظهر في لوحات التحكم.

> لا تضع أي مفتاح سري في الكود أو في المحادثات. كل القيم السرية تُضاف من لوحة Vercel أو GitHub Secrets فقط.

## ما الذي جُهّز في المستودع

| الملف | الغرض |
| --- | --- |
| `vercel.json` | إطار Next.js، تثبيت بـ `pnpm --frozen-lockfile`، منطقة الدوال `fra1` (فرانكفورت، الأقرب للعراق)، ومهمة Cron يومية لـ `/api/cron` |
| `.github/workflows/scheduled-jobs.yml` | يستدعي `/api/cron` كل 15 دقيقة (تذكيرات المباريات، انتهاء طلبات الحجز…). لا يفعل شيئاً حتى تضيف أسراره |
| `.github/workflows/db-migrate.yml` | تشغيل يدوي فقط لتطبيق ملفات `supabase/migrations` على مشروع Supabase |
| `next.config.ts` | يوقف البناء على Vercel برسالة واضحة إذا نقص `NEXT_PUBLIC_SUPABASE_URL` أو `NEXT_PUBLIC_SUPABASE_ANON_KEY`، أو إذا كان الرابط محلياً (`http`) |
| `src/lib/env.ts` | إن لم تحدد `NEXT_PUBLIC_SITE_URL` يُستخدم رابط Vercel تلقائياً، فتصل روابط البريد في نسخ المعاينة (Preview) إلى رابطها الصحيح |
| `package.json` | `engines.node = 22.x` و `packageManager = pnpm@10.28.0` |

## 1) إنشاء مشروع Supabase

1. أنشئ مشروعاً على supabase.com. اختر منطقة **Central EU (Frankfurt) — eu-central-1** لتكون قريبة من منطقة Vercel `fra1`.
2. احفظ كلمة مرور قاعدة البيانات في مكان آمن.
3. من **Project Settings → API** ستحتاج إلى:
   - `Project URL`، وهو `NEXT_PUBLIC_SUPABASE_URL`.
   - مفتاح `anon` / `publishable`، وهو `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - مفتاح `service_role` / `secret`، وهو `SUPABASE_SERVICE_ROLE_KEY`. **سري** ويُستخدم في الخادم فقط.

### تطبيق الجداول (migrations)

اختر طريقة واحدة:

- **من جهازك:**
  ```bash
  npx supabase login
  npx supabase link --project-ref <PROJECT_REF>
  npx supabase db push --dry-run   # يعرض ما سيُطبّق
  npx supabase db push
  ```
- **من GitHub Actions:**
  1. أضف الأسرار التالية في **Settings → Secrets and variables → Actions**:
     - `SUPABASE_ACCESS_TOKEN`
     - `SUPABASE_PROJECT_REF`
     - `SUPABASE_DB_PASSWORD`
  2. شغّل **Actions → Deploy database migrations** مع `dry_run` مفعّل للمراجعة.
  3. أعد التشغيل مع إلغاء `dry_run`.

`db push` يطبّق الملفات الجديدة فقط ولا يحذف بيانات. تُنشئ الملفات أيضاً حاويات التخزين (الصور) والبيانات المرجعية: الدينار العراقي، الموصل، والمناطق.

### إعداد المصادقة (Authentication)

1. **Authentication → URL Configuration:**
   - **Site URL:** رابط الإنتاج، مثل `https://malaab.example` أو `https://<project>.vercel.app`.
   - **Redirect URLs:**
     - `https://<your-domain>/auth/callback`
     - لنسخ المعاينة: `https://*-<vercel-team-slug>.vercel.app/auth/callback`
2. **Authentication → Providers → Email:** فعّل *Confirm email*. الحد الأدنى لكلمة المرور 8 أحرف (مطابق للإعداد المحلي).
3. **Authentication → SMTP Settings:** أضف مزوّد بريد حقيقياً (Resend، Postmark، SES…). الخادم المدمج في Supabase محدود جداً، ولا يصلح للإنتاج.

### قوالب البريد بهوية الموقع

القوالب الجاهزة في `supabase/templates/`. كل قالب ثنائي اللغة (العربية أولًا ثم الإنجليزية)، وكلها مجرّبة على محرك البريد في Supabase محليًا. في **Authentication ← Emails ← Templates** الصق لكل قالب العنوان (Subject) والمحتوى (Body / Source):

| القالب في Supabase | الملف | Subject |
| --- | --- | --- |
| Confirm signup | `confirmation.html` | `رمز تفعيل حسابك في ملعب \| Your Malaab activation code` |
| Reset Password | `recovery.html` | `إعادة تعيين كلمة المرور \| Reset your Malaab password` |
| Change Email Address | `email_change.html` | `تأكيد البريد الجديد \| Confirm your new Malaab e-mail` |

نفس القوالب مفعّلة محليًا عبر `supabase/config.toml`. عند تعديل قالب، عدّل الملف ثم الصقه من جديد في المشروع المستضاف.

قالب **Confirm signup** يعرض **رمزًا** (`{{ .Token }}`) يُدخله المستخدم في صفحة `/verify-email` بعد إنشاء الحساب، ومعه زر احتياطي. الصفحة تقبل رموزًا من 6 إلى 10 أرقام، فيعمل أي طول تضبطه في **Authentication ← Sign In / Providers ← Email ← Email OTP Length**.

## 2) إنشاء مشروع Vercel

1. **Add New → Project** ثم استورد المستودع `taha162/football`.
2. يُكتشف الإطار وأوامر البناء تلقائياً من `vercel.json`. لا تغيّر *Root Directory*.
3. أضف المتغيرات في **Settings → Environment Variables**:

| المتغير | البيئة | ملاحظات |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Production (+ Preview) | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production (+ Preview) | مفتاح anon. عام بطبيعته، والحماية عبر RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Production فقط | **سري.** يُستخدم في `/api/cron` فقط |
| `CRON_SECRET` | Production فقط | نص عشوائي من 32 حرفاً أو أكثر، مثل ناتج `openssl rand -hex 32`. يرسله Vercel Cron تلقائياً في ترويسة `Authorization: Bearer …` |
| `NEXT_PUBLIC_SITE_URL` | **Production فقط** | النطاق النهائي، مثل `https://malaab.example`. لا تضعه في Preview حتى تبقى روابط المعاينة صحيحة |
| `NEXT_PUBLIC_MAP_PROVIDER` | اختياري | `none` (الافتراضي) أو `mapbox` |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | اختياري | مع `mapbox` فقط. استخدم مفتاحاً عاماً مقيّداً بنطاقك |

> **نسخ المعاينة وقاعدة الإنتاج:** إذا أضفت متغيرات Supabase لبيئة Preview بنفس قيم الإنتاج، فستكتب نسخ المعاينة في قاعدة الإنتاج الحقيقية. الأفضل أن تنشئ مشروع Supabase منفصلاً للمعاينة، أو ألّا تضيف المتغيرات لبيئة Preview. بدون المتغيرات سيفشل بناء المعاينة برسالة واضحة.

4. اضغط **Deploy**. بعد النشر افتح `https://<domain>/api/health`، ويجب أن يُرجع:
   `{"status":"ok","checks":{"app":"ok","database":"ok"}}`

## 3) المهام المجدولة

يعمل `/api/cron` على:
- إنهاء طلبات الحجز التي لم يُرد عليها
- إرسال تذكيرات المباريات
- إغلاق الإعلانات المنتهية
- إكمال المباريات المنتهية
- إغلاق التسجيل في البطولات

الاستدعاء آمن للتكرار، ويُفضّل كل 15 دقيقة.

- **خطة Vercel Hobby:** تسمح بـ Cron مرة واحدة يومياً فقط، ولذلك ضُبط `vercel.json` على `0 1 * * *`. لتغطية الـ 15 دقيقة أضف في GitHub Secrets:
  - `APP_URL`: رابط الموقع.
  - `CRON_SECRET`: نفس القيمة الموجودة في Vercel.

  سيعمل workflow **Scheduled jobs** تلقائياً بعد دمج الفرع في `main`.
- **خطة Vercel Pro:** يمكنك تغيير الجدول في `vercel.json` إلى `*/15 * * * *` وتعطيل workflow الـ GitHub.

ملاحظة: Vercel Cron يعمل على نشر الإنتاج فقط، ولا يعيد المحاولة عند الفشل.

## 4) أول مدير (Admin)

لا يستطيع أي مستخدم ترقية نفسه.

1. سجّل حساباً عادياً من الموقع.
2. شغّل من جهاز موثوق:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
   pnpm admin:grant you@example.com admin
   ```

تُسجّل العملية في سجل التدقيق. بعدها تُدار الصلاحيات من `/admin/users`.

## 5) نطاق مخصص (اختياري)

1. **Vercel → Settings → Domains:** أضف النطاق واتبع تعليمات DNS.
2. حدّث `NEXT_PUBLIC_SITE_URL` في Vercel، ثم **Site URL** و **Redirect URLs** في Supabase.
3. أعد النشر (Redeploy)، لأن متغيرات `NEXT_PUBLIC_*` تُضمَّن وقت البناء.

## 6) التحقق عبر واتساب (اختياري)

المستخدم **هو من يرسل** رمزًا من واتساب إلى رقمك، فلا تدفع شيئًا مقابل كل تحقق. تصل الرسالة إلى موقعك عبر **WhatsApp Cloud API** الرسمية من Meta (Webhook موقّع). الموقع يأخذ رقم المرسل من واتساب نفسه، ويفعّل الحساب ويربطه بالرقم، ثم يسجّل المستخدم دخوله. لاحقًا يدخل المستخدم برقمه وكلمة المرور، ويستعيد كلمة المرور بنفس الطريقة.

ما دامت المتغيرات أدناه غير مضافة، يبقى خيار واتساب **مخفيًا** تمامًا.

**ستحتاج إلى:** رقم هاتف مخصص للمنصة، والأفضل شريحة جديدة. الرقم المسجّل في Cloud API لا يمكن استخدامه في تطبيق واتساب العادي في الوقت نفسه. إذا كان مسجلًا في واتساب فاحذف حساب واتساب منه أولًا.

### الإعداد في Meta
1. من developers.facebook.com: **My Apps ← Create App**، واختر حالة الاستخدام الخاصة بـ WhatsApp أو نوع **Business**. اربطه بحساب Meta Business، أو أنشئ واحدًا.
2. **WhatsApp ← API Setup ← Add phone number**: أضف رقم المنصة، واكتب اسم العرض (مثل *Malaab*)، ثم أكّد الرقم بالرمز الذي يصلك.
3. **WhatsApp ← Configuration ← Webhook ← Edit:**
   - **Callback URL:** `https://<your-domain>/api/whatsapp/webhook`
   - **Verify token:** نص عشوائي تختاره، وهو نفس قيمة `WHATSAPP_VERIFY_TOKEN` في Vercel.
   - اضغط **Verify and save**. يجب أن يكون الموقع منشورًا والمتغيرات مضافة قبل هذه الخطوة.
   - ثم في **Webhook fields** فعّل **messages** (Subscribe).
4. **App settings ← Basic ← App secret ← Show:** هذه القيمة هي `WHATSAPP_APP_SECRET`. يستخدمها الموقع ليتأكد أن الرسائل قادمة من Meta فعلًا.
5. حوّل التطبيق إلى **Live**، فهذا مطلوب لاستقبال رسائل المستخدمين الحقيقيين. تطلب Meta رابط سياسة الخصوصية، فاستخدم `https://<your-domain>/ar/legal/privacy`.

### المتغيرات في Vercel (Production)

| المتغير | القيمة |
| --- | --- |
| `WHATSAPP_NUMBER` | رقم المنصة بالصيغة الدولية بدون + ولا مسافات، مثل `9647701234567` |
| `WHATSAPP_VERIFY_TOKEN` | نفس الـ Verify token في Meta |
| `WHATSAPP_APP_SECRET` | App secret من Meta (**سري**) |
| `WHATSAPP_ACCESS_TOKEN` | اختياري: لإرسال رد "تم التحقق ✅" داخل نافذة المحادثة المجانية. يُفضّل System User token دائمًا (**سري**) |
| `WHATSAPP_PHONE_NUMBER_ID` | اختياري، مع الـ token: Phone number ID من صفحة API Setup |

بعد الإضافة اضغط **Redeploy**. ستظهر في صفحة إنشاء الحساب خانتان: **عبر البريد الإلكتروني** و**عبر واتساب**.

> قاعدة البيانات تحتاج migration رقم `0012` (جداول واتساب). شغّل **Deploy database migrations** مرة أخرى بعد دمج التحديث.

### كيف تتأكد أنه يعمل
1. أنشئ حسابًا من خيار **عبر واتساب** بهاتف آخر غير رقم المنصة.
2. اضغط **افتح واتساب وأرسل الرمز** ثم أرسل الرسالة كما هي.
3. خلال ثوانٍ تنتقل الصفحة وحدها إلى إكمال الملف الشخصي.

إذا لم يحدث شيء:
- راجع **Vercel ← Logs** وابحث عن `/api/whatsapp/webhook`.
  - ظهور `401` يعني أن `WHATSAPP_APP_SECRET` لا يطابق.
  - عدم ظهور أي طلب يعني أن الـ Webhook غير مفعّل، أو أن حقل **messages** غير مشترك فيه، أو أن التطبيق ليس **Live**.

## 7) الصفحة الرئيسية (الملعب ثلاثي الأبعاد)

الملعب في الصفحة الرئيسية يُرسَم في متصفح الزائر (WebGL). **لا يحتاج أي إعداد**: لا ملفات فيديو، ولا صور، ولا متغيرات.

- **إن كنت أضفت سابقًا متغيرات `NEXT_PUBLIC_HERO_*` في Vercel** (لقطات الفيديو القديمة)، فلم تعد مستخدمة ويمكنك حذفها.
- كل الأرقام في الصفحة حقيقية من قاعدة البيانات: المباريات المفتوحة، والفرق التي تبحث عن لاعبين لكل مركز، والملاعب، والبطولات. إذا كانت قاعدة البيانات فارغة، تعرض الصفحة رسالة "لا يوجد بعد" مع زر لإنشاء أول عنصر.
- إذا كان المتصفح لا يدعم WebGL، تظهر صورة ثابتة للملعب وتبقى الصفحة كاملة الاستعمال.
- المقدّمة السينمائية تُعرض **مرة واحدة في كل جلسة**:
  - يمكن تخطّيها بأي ضغطة.
  - لا تُعرض لمن يفعّل "تقليل الحركة" أو "توفير البيانات".
  - تُلغى تلقائيًا على الأجهزة البطيئة جدًا.
- الصوت مغلق افتراضيًا ويُشغَّل من زر في الزاوية.

## قائمة التحقق قبل الإطلاق

- [ ] الـ migrations مطبّقة، و `/api/health` يُرجع `ok`
- [ ] SMTP مُعد، وتمت تجربة التسجيل واستعادة كلمة المرور
- [ ] Redirect URLs صحيحة للإنتاج (وللمعاينة إن وُجدت)
- [ ] `CRON_SECRET` في Vercel، وأسرار GitHub للمهام كل 15 دقيقة (على خطة Hobby)
- [ ] تم منح أول Admin
- [ ] مراجعة صفحات الشروط والخصوصية والسلامة من محامٍ
- [ ] تحديد وسيلة تواصل للدعم (حذف الحساب، الاعتراضات)
- [ ] التحقق من قائمة مناطق الموصل محلياً

## استكشاف الأخطاء

| العَرَض | السبب المحتمل |
| --- | --- |
| فشل البناء: `Missing environment variables…` | لم تُضف متغيرات Supabase لهذه البيئة (Production أو Preview) |
| فشل البناء: `must be an https URL` | تم وضع رابط Supabase المحلي بدل رابط المشروع |
| `/api/health` يعطي `database: error` | الرابط أو المفتاح خطأ، أو أن الـ migrations لم تُطبّق |
| رابط تأكيد البريد يفتح localhost | `NEXT_PUBLIC_SITE_URL` خطأ، أو أن Site URL في Supabase غير محدث |
| `/api/cron` يعطي 401 | `CRON_SECRET` غير مطابق أو أقصر من 16 حرفاً |
| رسالة واتساب لا تفعّل الحساب | راجع قسم "التحقق عبر واتساب": الـ Webhook، وحقل messages، ووضع Live، و`WHATSAPP_APP_SECRET` |
| "انتظر دقيقة قبل طلب رمز جديد" | Supabase يسمح برسالة رمز واحدة كل 60 ثانية افتراضيًا، فانتظر قليلًا |
| `/api/cron` يعطي 503 | `SUPABASE_SERVICE_ROLE_KEY` غير مضاف لبيئة Production |
| الصور لا تظهر | أعد النشر بعد تعديل `NEXT_PUBLIC_SUPABASE_URL`، لأن نطاق الصور يُقرأ وقت البناء |
