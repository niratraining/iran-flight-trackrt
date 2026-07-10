// ==================================================================
// Phase 2 — 20 airports + API key pool + admin panel
// ==================================================================

// Allowed dashboard origins for CORS
const ALLOWED_ORIGINS = [
  'https://iran-flight-trackrt-dashboard.nirahelp.workers.dev',
  'https://flight-track.travellab.ir'
];

// The real value of REFRESH_SECRET must only be set in Cloudflare Secrets
// (Settings > Variables and Secrets > Add > Type: Secret > Name: REFRESH_SECRET)
// Never hardcode it here or commit it to git.
// The same REFRESH_SECRET is also used to log into the admin panel (/admin?token=...).

// ------------------------------------------------------------------
// Airport list (see architecture doc, section 3.2)
// ------------------------------------------------------------------
const ALL_AIRPORTS = [
  { iata: 'THR', name: 'تهران – مهرآباد', group: 'main' },
  { iata: 'IKA', name: 'تهران – امام خمینی', group: 'main' },
  { iata: 'MHD', name: 'مشهد', group: 'other' },
  { iata: 'SYZ', name: 'شیراز', group: 'other' },
  { iata: 'IFN', name: 'اصفهان', group: 'other' },
  { iata: 'TBZ', name: 'تبریز', group: 'other' },
  { iata: 'KIH', name: 'کیش', group: 'other' },
  { iata: 'AWZ', name: 'اهواز', group: 'other' },
  { iata: 'BND', name: 'بندرعباس', group: 'other' },
  { iata: 'KER', name: 'کرمان', group: 'other' },
  { iata: 'AZD', name: 'یزد', group: 'other' },
  { iata: 'OMH', name: 'ارومیه', group: 'other' },
  { iata: 'RAS', name: 'رشت', group: 'other' },
  { iata: 'SRY', name: 'ساری (دشت ناز)', group: 'other' },
  { iata: 'ZAH', name: 'زاهدان', group: 'other' },
  { iata: 'KSH', name: 'کرمانشاه', group: 'other' },
  { iata: 'ABD', name: 'آبادان', group: 'other' },
  { iata: 'BUZ', name: 'بوشهر', group: 'other' },
  { iata: 'ADU', name: 'اردبیل', group: 'other' },
  { iata: 'ZBR', name: 'چابهار', group: 'other' }
];

const MAIN_AIRPORTS = ALL_AIRPORTS.filter(a => a.group === 'main').map(a => a.iata);
const OTHER_AIRPORTS = ALL_AIRPORTS.filter(a => a.group === 'other').map(a => a.iata);

// Total key slots (9 active + 3 reserved empty, see architecture doc section 3.4-e)
const KEY_SLOTS = 12;

// Maps a pool slot index (1..KEY_SLOTS) to the actual Cloudflare Secret name.
// Slot 1 -> AVIATIONSTACK_KEY (no suffix, the original single key)
// Slot 2 -> AVIATIONSTACK_KEY1
// Slot 3 -> AVIATIONSTACK_KEY2
// ...
// Slot n -> AVIATIONSTACK_KEY{n-1}   (for n >= 2)
// This matches the secret names actually configured in the Cloudflare dashboard.
function keyEnvName(n) {
  return n === 1 ? 'AVIATIONSTACK_KEY' : `AVIATIONSTACK_KEY${n - 1}`;
}

export default {
  async scheduled(event, env, ctx) {
    const cron = event.cron;

    // 08:00 and 16:00 Tehran time -> THR and IKA only
    if (cron === '30 4 * * *' || cron === '30 12 * * *') {
      await trackAirports(env, MAIN_AIRPORTS);
      return;
    }

    // 09:00 Tehran time -> the other 18 airports
    if (cron === '30 5 * * *') {
      await trackAirports(env, OTHER_AIRPORTS);
      return;
    }

    // Safety net: any unrecognized cron trigger only refreshes THR/IKA
    await trackAirports(env, MAIN_AIRPORTS);
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(request) });
    }

    // Public route: read-only from KV, never calls aviationstack directly
    if (url.pathname === '/api/flights') {
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), request);
      let cached = await cache.match(cacheKey);
      if (cached) return cached;

      const data = await getAllFlights(env);
      const response = new Response(JSON.stringify(data), {
        headers: {
          'content-type': 'application/json',
          'Cache-Control': 'public, max-age=300',
          ...corsHeaders(request)
        }
      });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    // Private route: manual refresh — full list or a single airport
    if (url.pathname === '/api/refresh') {
      const secret = env.REFRESH_SECRET;

      if (!secret) {
        return new Response(JSON.stringify({ error: 'refresh disabled: REFRESH_SECRET not configured' }), {
          status: 503,
          headers: { 'content-type': 'application/json', ...corsHeaders(request) }
        });
      }

      const provided = url.searchParams.get('token');
      if (provided !== secret) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json', ...corsHeaders(request) }
        });
      }

      const airportParam = (url.searchParams.get('airport') || '').toUpperCase();

      if (airportParam) {
        const known = ALL_AIRPORTS.some(a => a.iata === airportParam);
        if (!known) {
          return new Response(JSON.stringify({ error: `unknown airport code: ${airportParam}` }), {
            status: 400,
            headers: { 'content-type': 'application/json', ...corsHeaders(request) }
          });
        }
        const results = await trackAirports(env, [airportParam]);
        return new Response(JSON.stringify({ status: 'refreshed', airport: airportParam, results }), {
          headers: { 'content-type': 'application/json', ...corsHeaders(request) }
        });
      }

      // No airport param -> refresh all 20 airports
      const results = await trackAirports(env, ALL_AIRPORTS.map(a => a.iata));
      return new Response(JSON.stringify({ status: 'refreshed', airports: 'all', results }), {
        headers: { 'content-type': 'application/json', ...corsHeaders(request) }
      });
    }

    // Admin panel — protected by the same REFRESH_SECRET
    if (url.pathname === '/admin') {
      return handleAdmin(request, env, url);
    }

    // Any other route: no external API call
    return new Response(JSON.stringify({ status: 'ok', hint: 'use /api/flights' }), {
      headers: { 'content-type': 'application/json', ...corsHeaders(request) }
    });
  }
};

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

// ------------------------------------------------------------------
// API key pool (round-robin)
// ------------------------------------------------------------------

function currentYyyyMm(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function getConfiguredKeys(env) {
  const keys = [];
  for (let n = 1; n <= KEY_SLOTS; n++) {
    const envName = keyEnvName(n);
    const val = env[envName];
    if (val) keys.push({ index: n, key: val, envName });
  }
  return keys;
}

async function selectApiKey(env) {
  const keys = getConfiguredKeys(env);
  if (keys.length === 0) return null;

  const month = currentYyyyMm();
  let best = null;

  for (const k of keys) {
    const raw = await env.FLIGHTS_KV.get(`key_usage:${k.index}:${month}`);
    const usage = parseInt(raw || '0', 10);
    if (!best || usage < best.usage) {
      best = { index: k.index, key: k.key, usage };
    }
  }
  return best;
}

async function incrementKeyUsage(env, index) {
  const month = currentYyyyMm();
  const kvKey = `key_usage:${index}:${month}`;
  const raw = await env.FLIGHTS_KV.get(kvKey);
  const current = parseInt(raw || '0', 10);
  await env.FLIGHTS_KV.put(kvKey, String(current + 1));
}

// ------------------------------------------------------------------
// Data collection
// ------------------------------------------------------------------

async function trackAirports(env, airportCodes) {
  const now = new Date().toISOString();
  const results = [];

  for (const airport of airportCodes) {
    const picked = await selectApiKey(env);

    if (!picked) {
      await env.FLIGHTS_KV.put(`error_${airport}_${now}`, 'no API key configured');
      results.push({ airport, status: 'no_key' });
      continue;
    }

    try {
      const apiUrl = `http://api.aviationstack.com/v1/flights?access_key=${picked.key}&dep_iata=${airport}`;
      const res = await fetch(apiUrl);
      const json = await res.json();

      await env.FLIGHTS_KV.put(`${airport}_${now}`, JSON.stringify(json));
      await incrementKeyUsage(env, picked.index);
      await env.FLIGHTS_KV.put(`last_run:${airport}`, now);

      results.push({ airport, status: 'ok', key_used: picked.index });
    } catch (err) {
      await env.FLIGHTS_KV.put(`error_${airport}_${now}`, String(err));
      results.push({ airport, status: 'error', error: String(err) });
    }
  }

  return results;
}

async function getAllFlights(env) {
  const list = await env.FLIGHTS_KV.list();
  const latestByFlight = new Map();
  let updatedAt = null;

  for (const item of list.keys) {
    if (item.name.startsWith('error_')) continue;

    if (item.name.startsWith('last_run:')) {
      const val = await env.FLIGHTS_KV.get(item.name);
      if (val && (!updatedAt || val > updatedAt)) updatedAt = val;
      continue;
    }

    if (item.name.startsWith('key_usage:') || item.name === 'last_run') continue;

    const raw = await env.FLIGHTS_KV.get(item.name);
    if (!raw) continue;

    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      continue;
    }

    const flights = json.data || [];
    for (const f of flights) {
      const dep = f.departure || {};
      const arr = f.arrival || {};
      const airline = f.airline || {};
      const flightInfo = f.flight || {};

      const flightKey = `${flightInfo.iata || flightInfo.icao || 'unknown'}_${dep.scheduled || ''}`;

      const record = {
        checked_at: item.name.split('_').slice(1).join('_'),
        flight_iata: flightInfo.iata || '',
        airline: airline.name || 'Unknown',
        dep_iata: dep.iata || '',
        dep_scheduled: dep.scheduled || '',
        dep_estimated: dep.estimated || '',
        dep_actual: dep.actual || '',
        dep_delay: dep.delay ?? null,
        arr_iata: arr.iata || '',
        arr_scheduled: arr.scheduled || '',
        arr_estimated: arr.estimated || '',
        arr_actual: arr.actual || '',
        arr_delay: arr.delay ?? null,
        status: f.flight_status || 'unknown'
      };

      const existing = latestByFlight.get(flightKey);
      if (!existing || record.checked_at > existing.checked_at) {
        latestByFlight.set(flightKey, record);
      }
    }
  }

  // Backward compatibility: fall back to the old global last_run key
  if (!updatedAt) {
    updatedAt = await env.FLIGHTS_KV.get('last_run');
  }

  return {
    updated_at: updatedAt || new Date().toISOString(),
    count: latestByFlight.size,
    flights: Array.from(latestByFlight.values())
  };
}

// ------------------------------------------------------------------
// Admin panel
// ------------------------------------------------------------------

async function handleAdmin(request, env, url) {
  const secret = env.REFRESH_SECRET;

  if (!secret) {
    return new Response('Admin panel disabled: REFRESH_SECRET is not configured.', { status: 503 });
  }

  const token = url.searchParams.get('token') || '';

  if (token !== secret) {
    return new Response(renderLoginPage(), {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  }

  const data = await buildAdminData(env);
  return new Response(renderAdminPage(data, token), {
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
}

async function buildAdminData(env) {
  const month = currentYyyyMm();
  const now = new Date();
  const dayOfMonth = now.getUTCDate();

  const keys = getConfiguredKeys(env);
  const keyStats = [];

  for (const k of keys) {
    const raw = await env.FLIGHTS_KV.get(`key_usage:${k.index}:${month}`);
    const usage = parseInt(raw || '0', 10);
    const remaining = Math.max(0, 100 - usage);
    const dailyAvg = usage / Math.max(1, dayOfMonth);

    let eta = null; // null means unknown
    let etaLabel = 'نامشخص';
    if (usage >= 100) {
      etaLabel = 'تمام شده';
    } else if (dailyAvg > 0) {
      const daysLeft = remaining / dailyAvg;
      const etaDate = new Date(now.getTime() + daysLeft * 86400000);
      eta = etaDate.toISOString().slice(0, 10);
      etaLabel = eta;
    }

    keyStats.push({
      index: k.index,
      envName: k.envName,
      usage,
      remaining,
      pct: Math.min(100, usage),
      dailyAvg: dailyAvg.toFixed(2),
      eta,
      etaLabel
    });
  }

  const airportStats = [];
  for (const a of ALL_AIRPORTS) {
    const lastRun = await env.FLIGHTS_KV.get(`last_run:${a.iata}`);
    airportStats.push({ iata: a.iata, name: a.name, group: a.group, lastRun: lastRun || '—' });
  }

  const totalRemaining = keyStats.reduce((sum, k) => sum + k.remaining, 0);
  const warnCount = keyStats.filter(k => k.usage >= 90).length;

  let nearestEta = null;
  for (const k of keyStats) {
    if (k.eta && (!nearestEta || k.eta < nearestEta)) nearestEta = k.eta;
  }

  return {
    keyStats,
    airportStats,
    totalRemaining,
    warnCount,
    nearestEta: nearestEta || '—',
    month,
    keySlotsFree: KEY_SLOTS - keys.length
  };
}

function renderLoginPage() {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ورود به پنل مدیریت</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body {
    font-family: 'Vazirmatn', sans-serif;
    background: #fdfdfb;
    color: #1a1a1a;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    margin: 0;
    padding: 24px;
  }
  form {
    background: #fff;
    border: 1px solid #e8e2d0;
    border-radius: 16px;
    padding: 32px 24px;
    max-width: 360px;
    width: 100%;
    box-shadow: 0 4px 24px rgba(0,0,0,0.05);
    text-align: center;
  }
  h1 { font-size: 18px; font-weight: 700; margin: 0 0 8px; }
  p { color: #777; font-size: 13px; margin: 0 0 20px; }
  input {
    width: 100%;
    padding: 12px 14px;
    border: 1px solid #ddd;
    border-radius: 10px;
    font-family: inherit;
    font-size: 15px;
    margin-bottom: 14px;
  }
  button {
    width: 100%;
    padding: 12px;
    border: none;
    border-radius: 10px;
    background: #C9A227;
    color: #fff;
    font-family: inherit;
    font-weight: 700;
    font-size: 15px;
    cursor: pointer;
  }
</style>
</head>
<body>
  <form method="GET" action="/admin">
    <h1>پنل مدیریت — ردیابی پروازها</h1>
    <p>برای ورود، توکن دسترسی رو وارد کن</p>
    <input type="password" name="token" placeholder="توکن دسترسی" autofocus required>
    <button type="submit">ورود</button>
  </form>
</body>
</html>`;
}

function renderAdminPage(data, token) {
  const keyRows = data.keyStats.map(k => {
    const color = k.pct >= 90 ? '#d64545' : (k.pct >= 70 ? '#e0a52c' : '#3f9d5c');
    return `
      <tr>
        <td>${k.envName}</td>
        <td>${k.usage} / 100</td>
        <td>
          <div class="bar"><div class="bar-fill" style="width:${k.pct}%;background:${color}"></div></div>
        </td>
        <td>${k.remaining}</td>
        <td>${k.dailyAvg}</td>
        <td>${k.etaLabel}</td>
      </tr>`;
  }).join('');

  const airportRows = data.airportStats.map(a => `
      <tr>
        <td>${a.name}</td>
        <td>${a.iata}</td>
        <td>${a.lastRun}</td>
        <td><button class="refresh-btn" data-airport="${a.iata}">بروزرسانی الان</button></td>
      </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>پنل مدیریت — ردیابی پروازها</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body {
    font-family: 'Vazirmatn', sans-serif;
    background: #fdfdfb;
    color: #1a1a1a;
    margin: 0;
    padding: 20px 16px 60px;
  }
  h1 { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
  h2 { font-size: 16px; font-weight: 700; margin: 32px 0 12px; border-right: 4px solid #C9A227; padding-right: 10px; }
  .subtitle { color: #888; font-size: 13px; margin-bottom: 20px; }

  .summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
    margin-bottom: 8px;
  }
  .summary-card {
    background: #fff;
    border: 1px solid #eee2c8;
    border-radius: 14px;
    padding: 14px;
    text-align: center;
  }
  .summary-card .num { font-size: 22px; font-weight: 700; color: #C9A227; }
  .summary-card .label { font-size: 12px; color: #777; margin-top: 4px; }

  table {
    width: 100%;
    border-collapse: collapse;
    background: #fff;
    border-radius: 12px;
    overflow: hidden;
    font-size: 13px;
  }
  th, td {
    padding: 10px 8px;
    text-align: right;
    border-bottom: 1px solid #f0ece0;
    white-space: nowrap;
  }
  th { background: #faf6ea; font-weight: 700; color: #555; }

  .bar {
    width: 80px;
    height: 8px;
    background: #f0ece0;
    border-radius: 6px;
    overflow: hidden;
  }
  .bar-fill { height: 100%; border-radius: 6px; }

  .refresh-btn {
    background: #1a1a1a;
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 6px 12px;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .refresh-btn:disabled { opacity: 0.5; }

  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }

  @media (max-width: 480px) {
    .summary { grid-template-columns: repeat(2, 1fr); }
  }
</style>
</head>
<body>
  <h1>پنل مدیریت — ردیابی پروازها</h1>
  <div class="subtitle">ماه جاری: ${data.month}</div>

  <div class="summary">
    <div class="summary-card">
      <div class="num">${data.totalRemaining}</div>
      <div class="label">جمع درخواست باقی‌مانده</div>
    </div>
    <div class="summary-card">
      <div class="num">${data.nearestEta}</div>
      <div class="label">نزدیک‌ترین تاریخ اتمام سهمیه</div>
    </div>
    <div class="summary-card">
      <div class="num">${data.warnCount}</div>
      <div class="label">کلید بالای ۹۰٪ مصرف</div>
    </div>
    <div class="summary-card">
      <div class="num">${data.keySlotsFree}</div>
      <div class="label">اسلات خالی رزرو</div>
    </div>
  </div>

  <h2>وضعیت کلیدهای API</h2>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>نام کلید</th>
          <th>مصرف/سقف</th>
          <th>درصد مصرف</th>
          <th>باقی‌مانده</th>
          <th>میانگین روزانه</th>
          <th>تاریخ تخمینی اتمام</th>
        </tr>
      </thead>
      <tbody>${keyRows || '<tr><td colspan="6">هیچ کلیدی تنظیم نشده</td></tr>'}</tbody>
    </table>
  </div>

  <h2>فرودگاه‌ها</h2>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>فرودگاه</th>
          <th>کد</th>
          <th>آخرین بروزرسانی</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${airportRows}</tbody>
    </table>
  </div>

  <script>
    const TOKEN = ${JSON.stringify(token)};
    document.querySelectorAll('.refresh-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const airport = btn.dataset.airport;
        btn.disabled = true;
        btn.textContent = 'در حال بروزرسانی...';
        try {
          const res = await fetch('/api/refresh?token=' + encodeURIComponent(TOKEN) + '&airport=' + airport);
          if (!res.ok) throw new Error('failed');
          location.reload();
        } catch (e) {
          btn.disabled = false;
          btn.textContent = 'خطا — دوباره امتحان کن';
        }
      });
    });
  </script>
</body>
</html>`;
}
