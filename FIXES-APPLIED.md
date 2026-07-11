# گزارش تغییرات اعمال‌شده

این فایل خلاصه‌ی تغییراتی‌ست که روی پایه‌ی «بررسی فنی iran-flight-trackrt» اعمال شد.
مرجع شماره‌ی بخش‌ها همان شماره‌گذاری فایل بررسی فنی اصلی است.

---

## قبلاً رفع شده بود (در `api/lib/flights.js.diff`)

| بخش | مشکل | راه‌حل |
|---|---|---|
| ۲ | باگ بحرانی #۱ — `aggregateDailyStats` فقط `dep_delay` را می‌خواند | `resolveDelay()` اول `arr_delay` را می‌خواند؛ `null` به‌جای on-time، در دسته‌ی جدید `noTelemetry` شمرده می‌شود |
| ۳ | باگ بحرانی #۲ — یک پرواز با دو کلید متفاوت دو بار لاگ می‌شد | `canonicalFlightKey` مستقل از ساعت شد؛ `upsertFlightRecord` به‌جای overwrite، merge می‌کند |
| ۷ | تعریف تاخیر بدون آستانه‌ی گریس | `ON_TIME_GRACE_MINUTES = 15` اضافه شد |
| ۹ | نبود بازه‌ی اطمینان آماری | `wilsonLowerBound()` و فیلد `confidence_low_percent` اضافه شد |

## در این مرحله رفع شد

### ۴. مشکل طراحی کلید Mongo — اسکن کامل هر شب
**فایل‌ها:** `api/lib/kv.js`، `api/lib/flights.js`، `api/scripts/migrate-daily-stats-key-order.mjs` (جدید)

- کلید از `daily_stats:{route}:{airline}:{date}` به `daily_stats:{date}:{route}:{airline}` تغییر کرد.
- `kv.list()` یک حالت `{gte, lt}` جدید گرفت برای range query واقعی روی مونگو (نه فقط prefix ثابت).
- `classifyRoutes` و `updateRollingScores` حالا فقط بازه‌ی لازم (۷ یا حداکثر ۱۵ روز) را با یک range query می‌خوانند، نه کل تاریخچه‌ی `daily_stats:*`.
- `buildLeaderboardAccumulatorFromFullHistory` عمداً دست‌نخورده ماند (نیازمند کل تاریخچه است، طبق طراحی).

**⚠️ نیاز به اقدام قبل از دیپلوی:** اسناد قدیمی در Mongo با فرمت قدیمی کلید ذخیره شده‌اند و کدِ جدید آن‌ها را نمی‌بیند (نه حذف می‌شوند، نه دوباره شمرده می‌شوند — فقط نامرئی می‌مانند). قبل از دیپلوی این تغییر، یک‌بار اجرا کنید:
```bash
# مرحله‌ی اول (امن، چیزی نمی‌نویسد):
MONGODB_URI="..." node api/scripts/migrate-daily-stats-key-order.mjs --dry-run
# بعد از بررسی خروجی:
MONGODB_URI="..." node api/scripts/migrate-daily-stats-key-order.mjs
```
اسکریپت idempotent است (اجرای چندباره بی‌ضرر است) و کلید جدید را قبل از حذف کلید قدیمی می‌نویسد (در صورت قطع‌شدن وسط کار، داده گم نمی‌شود).

### ۶. نگاشت نام شهر به IATA — fallback ناامن
**فایل:** `api/lib/fids-scraper.js`

- حدود ۲۵ مقصد بین‌المللی پرتردد (استانبول، دبی، بغداد، نجف، دوحه، مسکو، ...) به `CITY_NAME_TO_IATA` اضافه شد.
- `cityToCode` وقتی شهری را پیدا نکند، دیگر فقط بی‌صدا متن خام فارسی را برنمی‌گرداند؛ شمارنده‌اش را در کلید `unmapped_city:{نام}` در KV ثبت می‌کند (fire-and-forget، بدون کند کردن مسیر اصلی).

**⚠️ محدودیت شناخته‌شده:** نگارش دقیق این نام‌ها روی fids.airport.ir تایید نشده (دسترسی به HTML زنده نداشتم — دقیقاً همان محدودیت بخش ۱۰ گزارش اصلی). باید با چند نمونه‌ی واقعی، یا بعد از چند روز اجرا با یک کوئری روی کلیدهای `unmapped_city:*`، دیکشنری را تصحیح/تکمیل کرد.

### ۱۱. اجرای ترتیبی روی ۳۷ فرودگاه
**فایل:** `api/lib/flights.js`

- `trackAirports` حالا در دسته‌های ۵تایی (`AIRPORT_FETCH_CONCURRENCY`) موازی اجرا می‌شود، نه یکی‌یکی. هر دسته با `Promise.all` اجرا می‌شود و دسته‌ی بعد منتظر تمام‌شدن دسته‌ی فعلی می‌ماند.

### ۱۲. مقایسه‌ی غیر timing-safe توکن ادمین
**فایل جدید:** `api/lib/security.js`، استفاده در `api/server.js` و `api/lib/admin.js`

- تابع `safeTokenEqual()` با `crypto.timingSafeEqual` اضافه شد و جایگزین `provided !== secret` / `token !== secret` شد.

---

## عمداً رفع نشد (نیاز به تصمیم/داده‌ی خارج از این ریپو)

| بخش | چرا الان رفع نشد |
|---|---|
| ۵ — نبود TTL برای `flight_log`/`daily_stats` | تصمیم محصولی/عملیاتی است (آرشیو بعد از چند ماه به کجا؟ چه فرمتی؟)، نه صرفاً یک باگ کد |
| ۱۰ — ریسک‌های پارس HTML (`splitDayCell`, نام فایل لوگو) | بدون HTML زنده‌ی fids.airport.ir قابل تایید/رفع مطمئن نیست؛ رفع کورکورانه ریسک شکستن پارسر فعلی را دارد |

---

## فایل‌های تغییریافته/جدید

- `api/lib/kv.js` — پشتیبانی range query
- `api/lib/flights.js` — کلید `daily_stats`، اجرای موازی `trackAirports`
- `api/lib/fids-scraper.js` — دیکشنری شهرها، لاگ نگاشت‌نشده‌ها
- `api/lib/admin.js`, `api/server.js` — `safeTokenEqual`
- `api/lib/security.js` — **جدید**
- `api/scripts/migrate-daily-stats-key-order.mjs` — **جدید**

همه‌ی فایل‌ها با `node --check` از نظر سینتکسی تایید شدند.
