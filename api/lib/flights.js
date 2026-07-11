--- proj/iran-flight-trackrt-main/api/lib/flights.js	2026-07-11 10:57:40.000000000 +0000
+++ fixed_proj/api/lib/flights.js	2026-07-11 12:05:13.328454641 +0000
@@ -68,12 +68,30 @@
 export const FIDS_COVERED_AIRPORTS = ALL_AIRPORTS
   .filter(a => Boolean(IATA_TO_FIDS_ID[a.iata]))
   .map(a => a.iata);
+const FIDS_COVERED_SET = new Set(FIDS_COVERED_AIRPORTS);
 
 const MIN_SAMPLE_SIZE = 5;
 const BUSY_ROUTE_THRESHOLD = 7;
 const BUSY_WINDOW_DAYS = 7;
 const QUIET_WINDOW_DAYS = 15;
 
+// آستانه‌ی صنعتی متعارف برای «به‌موقع» (مشابه FAA/DOT و اکثر پلتفرم‌های
+// on-time performance مثل FlightAware): تاخیرهای زیر ۱۵ دقیقه عملیاتاً
+// طبیعی‌ان و «تاخیر» محسوب نمی‌شن.
+const ON_TIME_GRACE_MINUTES = 15;
+
+// برای پروازهایی که مقصدشون هیچ‌وقت پوشش FIDS نداره (بین‌المللی یا
+// فرودگاه‌های بدون داده): تابلوی ورودی مقصد رو هیچ‌وقت نمی‌بینیم، پس
+// «پرواز کرد» (active) رو بعد از این‌قدر دقیقه از ساعت خروج برنامه‌ای
+// به‌عنوان «تکمیل‌شده» قطعی می‌گیریم؛ وگرنه این پروازها هرگز وارد آمار
+// نمی‌شن (به‌جز کنسلی‌ها).
+const DEPARTED_FALLBACK_BUFFER_MIN = 45;
+
+// رتبه‌بندی «کامل‌بودن» وضعیت — برای merge دو دیدِ جزئی از یک پرواز
+// فیزیکی (تابلوی خروجیِ مبدأ + تابلوی ورودیِ مقصد)، وضعیت نهایی باید
+// کامل‌ترینی باشه که تا الان دیدیم، نه صرفاً آخرین باری که آپدیت شد.
+const TERMINAL_RANK = { cancelled: 3, landed: 3, gate_closed: 2, checkin: 2, active: 2, delayed: 1, scheduled: 0, unknown: 0 };
+
 // ------------------------------------------------------------------
 // جمع‌آوری داده — فقط از FIDS (aviationstack کاملاً حذف شده)
 // ------------------------------------------------------------------
@@ -184,20 +202,76 @@
   return tehran.toISOString().slice(0, 10);
 }
 
-function flightDateFromScheduled(scheduled) {
-  if (!scheduled) return null;
-  return scheduled.slice(0, 10);
-}
-
 export { tehranDateStr };
 
+// تاریخ پرواز باید مستقل از این‌که رکورد از کدوم بورد اومده پایدار باشه:
+// اگه ساعت خروج واقعی رو داریم (رکورد از تابلوی خروجیِ مبدأ)، تاریخش
+// معیاره. وگرنه (رکورد از تابلوی ورودیِ مقصد، که فقط ساعت نشست رو می‌ده)
+// از تاریخ نشست استفاده می‌کنیم. برای پروازهای کوتاه‌بردِ داخلی ایران
+// (اکثریت قریب‌به‌اتفاق زیر ۲ ساعت) این دو تاریخ تقریباً همیشه یکی‌ان،
+// پس merge دو دیدِ جزئی درست جفت می‌شه؛ تنها استثنا پروازهای خیلی نزدیک
+// نیمه‌شب است که محدودیت شناخته‌شده‌ست، نه باگ.
+function stableFlightDate(depScheduled, arrScheduled) {
+  if (depScheduled) return depScheduled.slice(0, 10);
+  if (arrScheduled) return arrScheduled.slice(0, 10);
+  return tehranDateStr();
+}
+
+// کلید یکتای «یک پرواز فیزیکی» — عمداً بدون ساعت دقیق در کلید، چون
+// شماره‌پرواز + ایرلاین + تاریخ روی یک مسیر مشخص در عمل تقریباً همیشه
+// یکتاست. مهم‌تر از همه: این کلید مستقل از این‌که رکورد از تابلوی
+// خروجیِ مبدأ اومده یا تابلوی ورودیِ مقصد، برای هر دو یکسانه — پس دو
+// دیدِ جزئی از یک پرواز به یک سند واحد می‌رسن، نه دو سند جدا.
+function canonicalFlightKey(flightDate, route, airlineIata, flightIata) {
+  return `flight_log:${flightDate}:${route}:${airlineIata}:${flightIata}`;
+}
+
+// معیار تاخیر برای مسافر: اولویت با تاخیر نشست (arr_delay) چون تجربه‌ی
+// واقعی مسافره. dep_delay فقط وقتی به‌کار می‌ره که هیچ‌وقت تابلوی ورودیِ
+// مقصد رو نداشته باشیم (پروازهای بین‌المللی/مقصد بدون پوشش FIDS).
+// null یعنی «داده‌ی تاخیر نداریم»، نه صفر — نباید به‌عنوان on-time شمرده
+// بشه (باگ بحرانی #۱ دقیقاً همین اشتباه بود: dep_delay=null در رکوردهای
+// اومده از بورد ورودی به ۰ تبدیل می‌شد و همه چیز on-time به نظر می‌رسید).
+function resolveDelay(rec) {
+  if (typeof rec.arr_delay === 'number') return rec.arr_delay;
+  if (typeof rec.dep_delay === 'number') return rec.dep_delay;
+  return null;
+}
+
+// یک پرواز فیزیکی معمولاً دوبار دیده می‌شه (بورد خروجیِ مبدأ + بورد
+// ورودیِ مقصد). به‌جای overwrite کامل (که یکی از دو دید رو گم می‌کنه)،
+// این تابع رکورد جدید رو با هر رکورد موجودِ همون کلید یکتا merge می‌کنه:
+// فقط فیلدهای واقعاً پرشده رونویسی می‌شن (چیزی که در ورودی جدید خالیه،
+// مقدار موجود قبلی رو پاک نمی‌کنه)، و وضعیت نهایی «کامل‌ترین» وضعیتیه که
+// تا الان دیدیم (بر اساس TERMINAL_RANK)، نه صرفاً آخرین به‌روزرسانی.
+async function upsertFlightRecord(partial) {
+  const key = canonicalFlightKey(partial.flight_date, partial.route, partial.airline_iata, partial.flight_iata);
+
+  let existing = null;
+  const existingRaw = await kv.get(key);
+  if (existingRaw) {
+    try { existing = JSON.parse(existingRaw); } catch { existing = null; }
+  }
+
+  const merged = existing ? { ...existing } : {};
+  for (const [k, v] of Object.entries(partial)) {
+    if (v !== null && v !== undefined && v !== '') merged[k] = v;
+  }
+
+  const existingRank = existing ? (TERMINAL_RANK[existing.status] ?? 0) : -1;
+  const incomingRank = TERMINAL_RANK[partial.status] ?? 0;
+  if (incomingRank >= existingRank) merged.status = partial.status;
+
+  await kv.put(key, JSON.stringify(merged));
+  return key;
+}
+
 async function logCompletedFlights(json, depAirport) {
   const flights = json.data || [];
-  const puts = [];
+  const ops = [];
 
   for (const f of flights) {
     const status = f.flight_status;
-    if (status !== 'landed' && status !== 'cancelled') continue;
 
     const dep = f.departure || {};
     const arr = f.arrival || {};
@@ -210,10 +284,21 @@
     const arrIata = arr.iata || '';
     if (!flightIata || !arrIata) continue;
 
-    const date = flightDateFromScheduled(dep.scheduled) || tehranDateStr();
+    // «تکمیل‌شده» یعنی: نشست/کنسلی (همیشه) یا — برای مقصدهایی که هیچ‌وقت
+    // تابلوی ورودی نخواهیم دید (بین‌المللی/بدون پوشش) — «پرواز کرد» که
+    // به‌اندازه‌ی کافی از ساعت خروج برنامه‌ای گذشته باشه. بدون این حالت
+    // دوم، این پروازها هرگز وارد آمار نمی‌شدن (به‌جز کنسلی‌ها).
+    let effectivelyComplete = status === 'landed' || status === 'cancelled';
+    if (!effectivelyComplete && status === 'active' && !FIDS_COVERED_SET.has(arrIata)) {
+      const depTime = new Date(dep.scheduled || dep.actual || 0).getTime();
+      effectivelyComplete = depTime > 0 && (Date.now() - depTime) > DEPARTED_FALLBACK_BUFFER_MIN * 60000;
+    }
+    if (!effectivelyComplete) continue;
+
+    const date = stableFlightDate(dep.scheduled, arr.scheduled);
     const route = `${depIata}-${arrIata}`;
 
-    const record = {
+    const partial = {
       flight_date: date,
       route,
       dep_iata: depIata,
@@ -223,19 +308,18 @@
       flight_iata: flightIata,
       dep_scheduled: dep.scheduled || '',
       dep_actual: dep.actual || '',
-      dep_delay: dep.delay ?? null,
+      dep_delay: typeof dep.delay === 'number' ? dep.delay : null,
       arr_scheduled: arr.scheduled || '',
       arr_actual: arr.actual || '',
-      arr_delay: arr.delay ?? null,
+      arr_delay: typeof arr.delay === 'number' ? arr.delay : null,
       status
     };
 
-    const key = `flight_log:${date}:${route}:${airlineIata}:${flightIata}:${dep.scheduled}`;
-    puts.push(kv.put(key, JSON.stringify(record)));
+    ops.push(upsertFlightRecord(partial));
   }
 
-  await Promise.all(puts);
-  return puts.length;
+  await Promise.all(ops);
+  return ops.length;
 }
 
 export async function aggregateDailyStats(date) {
@@ -253,7 +337,7 @@
 
       const groupKey = `${rec.route}:${rec.airline_iata}`;
       if (!grouped.has(groupKey)) {
-        grouped.set(groupKey, { total: 0, onTime: 0, delayed: 0, cancelled: 0, delaySum: 0, delaySamples: 0, airlineName: rec.airline_name || null });
+        grouped.set(groupKey, { total: 0, onTime: 0, delayed: 0, cancelled: 0, noTelemetry: 0, delaySum: 0, delaySamples: 0, airlineName: rec.airline_name || null });
       }
       const g = grouped.get(groupKey);
       g.total++;
@@ -264,10 +348,21 @@
         continue;
       }
 
-      const delay = typeof rec.dep_delay === 'number' ? rec.dep_delay : 0;
+      // باگ بحرانی سابق: اینجا فقط rec.dep_delay خونده می‌شد. برای پروازهایی
+      // که از تابلوی ورودیِ مقصد لاگ شدن (اکثر پروازهای داخلی، چون فقط
+      // نشست/فرود لاگ می‌شه)، dep_delay همیشه null بود؛ typeof null==='number'
+      // نتیجه‌ش false می‌شد، delay به ۰ سقوط می‌کرد و همه‌چیز به‌صورت خودکار
+      // on-time شمرده می‌شد. حالا resolveDelay اول arr_delay را می‌خواند
+      // (تجربه‌ی واقعی مسافر) و اگر هیچ داده‌ای نداشتیم null می‌ماند —
+      // نه on-time نه delayed، بلکه noTelemetry.
+      const delay = resolveDelay(rec);
+      if (delay === null) {
+        g.noTelemetry++;
+        continue;
+      }
       g.delaySum += delay;
       g.delaySamples++;
-      if (delay <= 0) g.onTime++;
+      if (delay <= ON_TIME_GRACE_MINUTES) g.onTime++;
       else g.delayed++;
     }
     cursor = list.list_complete ? undefined : list.cursor;
@@ -285,6 +380,7 @@
       on_time_count: g.onTime,
       delayed_count: g.delayed,
       cancelled_count: g.cancelled,
+      no_telemetry_count: g.noTelemetry,
       sum_delay_minutes: g.delaySum,
       delay_samples: g.delaySamples,
       avg_delay_minutes: g.delaySamples > 0 ? Math.round((g.delaySum / g.delaySamples) * 10) / 10 : 0,
@@ -298,6 +394,7 @@
     a.onTime += g.onTime;
     a.delayed += g.delayed;
     a.cancelled += g.cancelled;
+    a.noTelemetry += g.noTelemetry;
     a.delaySum += g.delaySum;
     a.delaySamples += g.delaySamples;
     if (g.airlineName) a.airlineName = g.airlineName;
@@ -350,6 +447,19 @@
   return routeTotals.size;
 }
 
+// حد پایین بازه‌ی اطمینان ۹۵٪ (Wilson score interval) برای نسبت on-time.
+// برخلاف بازه‌ی نرمال ساده، با n کوچک هم رفتار درست و غیرمنفی داره —
+// استاندارد رایج برای نمایش «نرخ موفقیت با نمونه‌ی کم» (مثلاً امتیاز
+// فروشنده در پلتفرم‌های ecommerce).
+function wilsonLowerBound(onTime, n, z = 1.96) {
+  if (!n) return null;
+  const p = onTime / n;
+  const denom = 1 + (z * z) / n;
+  const centre = p + (z * z) / (2 * n);
+  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
+  return Math.round(Math.max(0, (centre - margin) / denom) * 1000) / 10;
+}
+
 export async function updateRollingScores() {
   const routeWindowCache = new Map();
   async function getRouteWindowDays(route) {
@@ -386,7 +496,7 @@
     const windowDays = await getRouteWindowDays(route);
     const windowCutoff = tehranDateStr(new Date(Date.now() - (windowDays - 1) * 86400000));
 
-    let total = 0, onTime = 0, delayed = 0, cancelled = 0, delaySum = 0, delaySamples = 0, airlineName = null;
+    let total = 0, onTime = 0, delayed = 0, cancelled = 0, noTelemetry = 0, delaySum = 0, delaySamples = 0, airlineName = null;
     for (const dailyKey of dailyKeys) {
       const date = dailyKey.split(':')[3];
       if (date < windowCutoff) continue;
@@ -397,6 +507,7 @@
       onTime += s.on_time_count;
       delayed += s.delayed_count;
       cancelled += s.cancelled_count;
+      noTelemetry += (s.no_telemetry_count || 0);
       delaySum += s.sum_delay_minutes;
       delaySamples += s.delay_samples;
       if (s.airline_name) airlineName = s.airline_name;
@@ -408,6 +519,12 @@
       insufficient_data: total < MIN_SAMPLE_SIZE,
       reason: total < MIN_SAMPLE_SIZE ? `فقط ${total} پرواز در ${windowDays} روز اخیر ثبت شده` : null,
       score_percent: (total >= MIN_SAMPLE_SIZE && completed > 0) ? Math.round((onTime / completed) * 1000) / 10 : null,
+      // بازه‌ی اطمینان آماری (حد پایین Wilson score): با نمونه‌ی کم، یک عدد
+      // قطعی مثل «۸۰٪» گمراه‌کننده‌ست (می‌تونه از ۴ پرواز از ۵ باشه). این
+      // عدد «حداقل اعتمادپذیری قابل‌دفاع آماری» رو نشون می‌ده و خودش با
+      // نمونه‌ی کم پایین می‌افته، بدون این‌که مجبور باشیم مسیر رو کلاً
+      // بی‌عدد نشون بدیم.
+      confidence_low_percent: completed > 0 ? wilsonLowerBound(onTime, completed) : null,
       all_cancelled: completed === 0,
       avg_delay_minutes: delaySamples > 0 ? Math.round((delaySum / delaySamples) * 10) / 10 : 0,
       cancellation_rate: total > 0 ? Math.round((cancelled / total) * 1000) / 10 : 0,
@@ -416,6 +533,7 @@
       on_time_count: onTime,
       delayed_count: delayed,
       cancelled_count: cancelled,
+      no_telemetry_count: noTelemetry,
       delay_sum_minutes: delaySum,
       delay_samples: delaySamples,
       window_days: windowDays,
@@ -461,7 +579,7 @@
 }
 
 function emptyLeaderboardAcc() {
-  return { total: 0, onTime: 0, delayed: 0, cancelled: 0, delaySum: 0, delaySamples: 0, airlineName: null, routes: {} };
+  return { total: 0, onTime: 0, delayed: 0, cancelled: 0, noTelemetry: 0, delaySum: 0, delaySamples: 0, airlineName: null, routes: {} };
 }
 
 function addLeaderboardAcc(dst, src) {
@@ -469,6 +587,7 @@
   dst.onTime += src.onTime;
   dst.delayed += src.delayed;
   dst.cancelled += src.cancelled;
+  dst.noTelemetry += (src.noTelemetry || 0);
   dst.delaySum += src.delaySum;
   dst.delaySamples += src.delaySamples;
   if (src.airlineName) dst.airlineName = src.airlineName;
@@ -505,6 +624,7 @@
       a.cancelled += s.cancelled_count;
       a.delaySum += s.sum_delay_minutes;
       a.delaySamples += s.delay_samples;
+      a.noTelemetry += (s.no_telemetry_count || 0); // اسناد قدیمی این فیلد را ندارند
       if (s.airline_name) a.airlineName = s.airline_name;
 
       if (!a.routes[route]) a.routes[route] = { total: 0, onTime: 0, cancelled: 0 };
@@ -575,6 +695,7 @@
       avg_delay_minutes: a.delaySamples > 0 ? Math.round((a.delaySum / a.delaySamples) * 10) / 10 : 0,
       cancellation_rate: a.total > 0 ? Math.round((a.cancelled / a.total) * 1000) / 10 : 0,
       delayed_count: a.delayed,
+      no_telemetry_count: a.noTelemetry,
       routes
     });
   }
