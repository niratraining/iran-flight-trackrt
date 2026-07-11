// server.js
// ------------------------------------------------------------------
// جایگزین worker.js کلودفلر. همون مسیرها (/api/flights, /api/refresh,
// /api/reliability, /api/leaderboard, /admin) رو با اکسپرس سرو می‌کنه.
// کرون شبانه (قبلاً trigger کلودفلر) حالا با node-cron داخل همین
// پردازه اجرا می‌شه — طبق توصیه‌ی رسمی مستندات لیارا برای NodeJS
// (docs.liara.ir/app-features/cron-jobs). تایم‌زون پیش‌فرض اپ‌های
// لیارا Asia/Tehran هست، برای اطمینان صریح هم ست شده.
// ------------------------------------------------------------------

import express from 'express';
import cron from 'node-cron';
import 'dotenv/config';

import { initKv } from './lib/kv.js';
import { cacheGet, cacheSet, cacheDelete } from './lib/cache.js';
import { handleAdmin } from './lib/admin.js';
import {
  ALL_AIRPORTS,
  getAllFlights,
  getReliabilityForRoute,
  runNightlyJob,
  manualRefresh,
  refreshFlightsOnly
} from './lib/flights.js';
import { kv } from './lib/kv.js';

const app = express();
app.disable('x-powered-by');

// ------------------------------------------------------------------
// CORS — دقیقاً همون allow-list قبلی + دامنه‌ی جدید داشبورد روی لیارا
// (اگه داشبورد رو با آدرس دیگه‌ای دیپلوی کردی، اینجا اضافه‌ش کن یا با
// env var ALLOWED_ORIGINS به‌صورت کاما-جدا بده).
// ------------------------------------------------------------------
const DEFAULT_ORIGINS = [
  'https://iran-flight-trackrt-dashboard.nirahelp.workers.dev',
  'https://flight-track.travellab.ir'
];
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : DEFAULT_ORIGINS;

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.set('Access-Control-Allow-Origin', allowOrigin);
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}
app.use(corsMiddleware);

// این worker این origin رو برای purge کش استفاده می‌کرد؛ اینجا لازم
// نیست چون کش داخل‌پردازه‌ایه و purgeDataCaches فقط با کلید کار می‌کنه
// (بدون نیاز به origin واقعی).
async function purgeDataCaches() {
  cacheDelete('/api/flights');
  cacheDelete('/api/leaderboard');
}

// ------------------------------------------------------------------
// Public: /api/flights
// ------------------------------------------------------------------
app.get('/api/flights', async (req, res) => {
  const cached = cacheGet('/api/flights');
  if (cached) {
    res.set('content-type', 'application/json');
    res.send(cached);
    return;
  }

  try {
    const data = await getAllFlights();
    const body = JSON.stringify(data);
    cacheSet('/api/flights', body, 86400);
    res.set('content-type', 'application/json');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(body);
  } catch (err) {
    res.status(500).json({ error: 'failed to load flights', detail: String(err) });
  }
});

// ------------------------------------------------------------------
// Private: /api/refresh — رفرش دستی، کل لیست یا یک فرودگاه
// ------------------------------------------------------------------
app.get('/api/refresh', async (req, res) => {
  const secret = process.env.REFRESH_SECRET;

  if (!secret) {
    res.status(503).json({ error: 'refresh disabled: REFRESH_SECRET not configured' });
    return;
  }

  const provided = req.query.token;
  if (provided !== secret) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const airportParam = String(req.query.airport || '').toUpperCase();

  if (airportParam) {
    const known = ALL_AIRPORTS.some(a => a.iata === airportParam);
    if (!known) {
      res.status(400).json({ error: `unknown airport code: ${airportParam}` });
      return;
    }
    const results = await manualRefresh([airportParam]);
    await purgeDataCaches();
    res.json({ status: 'refreshed', airport: airportParam, results });
    return;
  }

  const results = await manualRefresh(ALL_AIRPORTS.map(a => a.iata));
  await purgeDataCaches();
  res.json({ status: 'refreshed', airports: 'all', results });
});

// ------------------------------------------------------------------
// Public: /api/reliability?route=THR-IST
// ------------------------------------------------------------------
app.get('/api/reliability', async (req, res) => {
  const route = String(req.query.route || '').toUpperCase();
  if (!route) {
    res.status(400).json({ error: 'پارامتر route لازمه، مثلاً ?route=THR-IST' });
    return;
  }

  const cacheKey = `/api/reliability?route=${route}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.set('content-type', 'application/json');
    res.send(cached);
    return;
  }

  const data = await getReliabilityForRoute(route);
  const body = JSON.stringify(data);
  cacheSet(cacheKey, body, 1800);
  res.set('content-type', 'application/json');
  res.set('Cache-Control', 'public, max-age=1800');
  res.send(body);
});

// ------------------------------------------------------------------
// Public: /api/leaderboard
// ------------------------------------------------------------------
app.get('/api/leaderboard', async (req, res) => {
  const cached = cacheGet('/api/leaderboard');
  if (cached) {
    res.set('content-type', 'application/json');
    res.send(cached);
    return;
  }

  const raw = await kv.get('leaderboard_stats');
  const data = raw ? JSON.parse(raw) : { airlines: [], last_updated: null };
  const body = JSON.stringify(data);
  cacheSet('/api/leaderboard', body, 86400);
  res.set('content-type', 'application/json');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(body);
});

// ------------------------------------------------------------------
// Admin panel
// ------------------------------------------------------------------
app.get('/admin', handleAdmin);

// هر مسیر دیگه
app.get('*', (req, res) => {
  res.json({ status: 'ok', hint: 'use /api/flights' });
});

// ------------------------------------------------------------------
// راه‌اندازی: اول اتصال به MongoDB، بعد گوش دادن + ثبت کرون شبانه
// ------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

async function main() {
  await initKv(process.env.MONGODB_URI, process.env.MONGODB_DB || 'flighttrack');
  console.log('Connected to MongoDB');

  app.listen(PORT, () => {
    console.log(`iran-flight-trackrt API listening on port ${PORT}`);
  });

  // معادل [[triggers]] crons = ["29 20 * * *"] در wrangler.toml (که به
  // وقت تهران 23:59 بود، چون اون کرون بر پایه‌ی UTC نوشته شده بود).
  // اینجا چون تایم‌زون رو صریح Asia/Tehran می‌ذاریم، مستقیم می‌تونیم
  // زمان محلی تهران رو بنویسیم: هر شب ساعت 23:59.
  let running = false;
  cron.schedule('59 23 * * *', async () => {
    if (running) return; // جلوگیری از اجرای هم‌پوشان اگه اجرای قبلی هنوز تموم نشده
    running = true;
    console.log('Running nightly job...');
    try {
      await runNightlyJob();
      await purgeDataCaches();
      console.log('Nightly job finished.');
    } catch (err) {
      console.error('Nightly job failed:', err);
    } finally {
      running = false;
    }
  }, { timezone: 'Asia/Tehran' });

  // ------------------------------------------------------------------
  // فچ خام هر ۱۵ دقیقه — فقط trackAirports (بدون aggregateDailyStats/
  // updateRollingScores که فول‌اسکن مونگو می‌زنن). فقط کش /api/flights
  // رو پاک می‌کنه، پس جدول/وضعیت زنده زود به‌روز می‌شه بدون فشار اضافه
  // روی دیتابیس. aviationstack حذف شده، پس محدودیت کوتا نداریم؛
  // فرودگاه‌های بدون پوشش FIDS (فعلاً IKA, KIH, ZBR) فقط با ۰ پرواز
  // 'ok' برمی‌گردن، نه خطا.
  let rawRunning = false;
  cron.schedule('*/15 * * * *', async () => {
    if (rawRunning) return;
    rawRunning = true;
    console.log('Running 15-minute raw flight refresh...');
    try {
      await refreshFlightsOnly(ALL_AIRPORTS.map(a => a.iata));
      cacheDelete('/api/flights');
      console.log('15-minute raw flight refresh finished.');
    } catch (err) {
      console.error('15-minute raw flight refresh failed:', err);
    } finally {
      rawRunning = false;
    }
  }, { timezone: 'Asia/Tehran' });

  // آمار/اعتمادپذیری/کارنامه دیگه هر ۳۰ دقیقه اجرا نمی‌شه — فقط شبی
  // یه‌بار با کرون شبانه‌ی بالا (۲۳:۵۹) که runNightlyJob صداش می‌زنه.
  // منطقیه چون این محاسبات فول‌اسکن مونگو می‌زنن و اعتمادپذیری نیازی به
  // آپدیت لحظه‌ای نداره؛ فقط جدول/وضعیت زنده‌ی پرواز با کرون ۱۵ دقیقه‌ی
  // پایین به‌روز می‌مونه.
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
