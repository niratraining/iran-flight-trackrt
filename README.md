# iran-flight-trackrt — نسخه‌ی لیارا

بازنویسی کامل پروژه از Cloudflare Workers/KV به لیارا. سه اپ جدا:

| پوشه | چیه | پلتفرم لیارا |
|---|---|---|
| `api/` | جایگزین `worker.js` — API + کرون شبانه | Node.js |
| `dashboard/` | همون داشبورد قبلی (فقط ۳ خط آدرس API عوض شده) | Static |
| `fids-relay/` | **بدون تغییر** — همینی که از قبل روی لیارا داری | Node.js |

دیتابیس: **MongoDB** (دیتابیس ابری لیارا). چرا مونگو و نه MySQL/Postgres؟
چون کل داده‌ی قبلی توی Cloudflare KV یک key-value ساده با prefix-scan و
TTL بود (`flight_log:*`, `daily_stats:*`, `reliability_score:*`, ...).
مونگو با یک کالکشن تخت (`kv`) دقیقاً همون رفتار رو با کمترین ریسک بازنویسی
می‌ده — منطق امتیازدهی/تجمیع (`lib/flights.js`) تقریباً کلمه‌به‌کلمه همون
کدیه که قبلاً داشتی، فقط `env.FLIGHTS_KV` شده `kv`.

---

## ۱) ساخت دیتابیس MongoDB روی لیارا

کنسول لیارا → دیتابیس‌ها → راه‌اندازی دیتابیس → MongoDB. بعد از ساخت،
از صفحه‌ی «نحوه اتصال» یک connection string شبیه این می‌گیری:

```
mongodb://root:PASSWORD@HOST:PORT/flighttrack?authSource=admin
```

اگه اپ `api` و دیتابیس رو در یک شبکه‌ی خصوصی لیارا بسازی، از لینک شبکه‌ی
خصوصی استفاده کن (سریع‌تر، بدون ترافیک عمومی). این مقدار می‌ره توی
env var به اسم `MONGODB_URI` روی اپ `api`.

## ۲) دیپلوی `api`

1. یک اپ Node.js جدید در لیارا بساز، مثلاً با شناسه‌ی `iran-flight-trackrt-api`.
2. متغیرهای محیطی رو طبق `api/.env.example` توی پنل لیارا (تنظیمات →
   Environment Variables) وارد کن:
   - `MONGODB_URI` (مرحله‌ی قبل)
   - `REFRESH_SECRET` (یک رشته‌ی تصادفی — همون که در `/admin` و
     `/api/refresh` استفاده می‌شه؛ می‌تونی از مقدار فعلی Cloudflare Secret
     همون REFRESH_SECRET رو کپی کنی، نیازی به تغییرش نیست)
   - `FIDS_RELAY_URL=https://fids-relay.liara.run` (یا آدرس واقعی relay‌ت)
   - `AVIATIONSTACK_KEY`, `AVIATIONSTACK_KEY1`, ... (همون کلیدهایی که در
     Cloudflare Secrets داشتی — فقط برای IKA/KIH/ZBR که fids پوشش نمی‌ده)
   - `ALLOWED_ORIGINS=https://flight-track.travellab.ir` (دامنه‌ی داشبورد)
3. دیپلوی با `liara deploy --path=api --app=iran-flight-trackrt-api` یا با
   GitHub Actions (پایین توضیح داده شده).
4. تست: `https://iran-flight-trackrt-api.liara.run/api/flights` باید
   `{"updated_at":...,"count":0,"flights":[]}` برگردونه (تا قبل از اولین
   رفرش، خالیه — طبیعیه).
5. یک رفرش دستی بزن تا دیتای اول رو بگیره:
   `https://iran-flight-trackrt-api.liara.run/api/refresh?token=REFRESH_SECRET`

## ۳) دیپلوی `dashboard`

1. قبلش `dashboard/index.html` رو باز کن، خط `API_BASE` رو با آدرس واقعی
   اپ `api`ت جایگزین کن (یا دامنه‌ی اختصاصی اگه ست کردی).
2. یک اپ Static جدید در لیارا بساز، مثلاً `iran-flight-trackrt-dashboard`.
3. دیپلوی با `liara deploy --path=dashboard --app=iran-flight-trackrt-dashboard`.
4. دامنه‌ی سفارشی `flight-track.travellab.ir` رو از تنظیمات این اپ به‌جای
   Cloudflare Worker قبلی، به این اپ لیارا وصل کن (DNS: یک رکورد CNAME به
   آدرسی که لیارا در بخش «دامنه‌ها»ی اپ بهت می‌ده).

## ۴) کرون شبانه

برخلاف Cloudflare Workers (که cron trigger جدا داشت)، اینجا از پکیج
`node-cron` **داخل همون پردازه‌ی `api`** استفاده شده — دقیقاً طبق توصیه‌ی
رسمی مستندات NodeJS لیارا (`docs.liara.ir/app-features/cron-jobs`). یعنی
تا وقتی اپ `api` روشنه (که باید همیشه روشن باشه، چون یک وب‌سرور هم هست)،
هر شب ساعت ۲۳:۵۹ به‌وقت تهران خودش اجرا می‌شه — نیازی به تنظیم جدا در
`liara.json` یا کنسول نیست.

اگه ترجیح می‌دی کرون رو بیرون از پردازه‌ی وب داشته باشی (مثلاً برای
اطمینان بیشتر از عدم تداخل با ری‌استارت‌های اپ)، جایگزین: به‌جای
node-cron، از یک GitHub Actions scheduled workflow یا هر سرویس cron
بیرونی (مثل cron-job.org) استفاده کن که هر شب فقط همین URL رو GET کنه:

```
https://iran-flight-trackrt-api.liara.run/api/refresh?token=REFRESH_SECRET
```

توجه: این مسیر `classifyRoutes()` (طبقه‌بندی پرتردد/کم‌تردد، فقط دوشنبه‌ها)
رو صدا نمی‌زنه — اون فقط از `runNightlyJob()` (کرون داخلی) صدا زده می‌شه.
اگه کرون داخلی رو غیرفعال کردی و به این روش بیرونی رفتی، باید
`classifyRoutes` رو یک‌جای دیگه (مثلاً یک GitHub Action هفتگی جدا) هم صدا
بزنی، وگرنه مسیرها همیشه با پنجره‌ی ۱۵ روزه (quiet) حساب می‌شن.

## ۵) GitHub Actions (اختیاری، برای CI/CD خودکار)

فایل‌های `github/workflows/*.yaml` رو به `.github/workflows/` توی ریشه‌ی
ریپازیتوری‌ت منتقل کن (این پوشه عمداً بدون نقطه ساخته شده تا موقع آپلود
روی این چت به‌عنوان فایل معمولی دیده بشه — قبل از push کردن به گیت‌هاب
باید تغییرش بدی به `.github/workflows/`). سه فایل جدا:

- `liara-api.yaml` — روی push به `api/**`
- `liara-dashboard.yaml` — روی push به `dashboard/**`
- `liara-fids-relay.yaml` — همون فایل قبلی، بدون تغییر

همه از یک secret به اسم `LIARA_API_TOKEN` در تنظیمات ریپازیتوری استفاده
می‌کنن (همونی که احتمالاً از قبل برای fids-relay ساختی).

## ۶) درباره‌ی دیتای قدیمی (تاریخچه‌ی Cloudflare KV)

این migration کد رو منتقل می‌کنه، نه دیتای موجود توی Cloudflare KV
(چون به اون KV namespace دسترسی مستقیم ندارم). دو گزینه داری:

- **ساده‌ترین:** بذار سیستم جدید از صفر شروع کنه. چون `reliability_score`
  روی یک پنجره‌ی ۷ تا ۱۵ روزه‌ی چرخشیه، حداکثر تا ۱۵ روز بعد از راه‌اندازی
  دوباره کامل می‌شه. `leaderboard_stats` تجمیعیه و کمی بیشتر طول می‌کشه تا
  دوباره معنادار بشه.
- **انتقال کامل تاریخچه:** با `wrangler kv key list`/`get` می‌تونی کل
  namespace `FLIGHTS_KV` رو (حداقل کلیدهای `flight_log:*` و
  `daily_stats:*`) به JSON اکسپورت کنی، بعد یک اسکریپت یک‌بارمصرف بنویسی
  که هر رکورد رو با `kv.put(key, value)` توی مونگوی جدید بریزه (کلیدهای
  `${airport}_${timestamp}` رو نادیده بگیر، چون اونا موقتی‌ان و به‌هرحال
  با اولین رفرش دوباره ساخته می‌شن). اگه بخوای این اسکریپت انتقال رو هم
  برات بنویسم بگو.

## ۷) نکات فنی مهاجرت (برای مرور کد)

- `HTMLRewriter` (فقط Cloudflare) → `cheerio` در `lib/fids-scraper.js`.
- `caches.default` (edge cache) → `lib/cache.js` (کش ساده‌ی داخل‌پردازه‌ای؛
  چون purge صریح بعد از هر رفرش انجام می‌شه، رفتار عملاً یکسانه).
- `ctx.waitUntil(...)` حذف شده — در Express همه‌چیز داخل همون
  `async` handler با `await` انجام می‌شه، نیازی به fire-and-forget نیست.
- منطق `/api/refresh` عمداً هنوز `classifyRoutes()` رو صدا نمی‌زنه (دقیقاً
  مثل نسخه‌ی قبلی) — فقط کرون شبانه‌ی کامل این کار رو می‌کنه.
