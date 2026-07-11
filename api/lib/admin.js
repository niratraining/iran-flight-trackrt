// lib/admin.js
// ------------------------------------------------------------------
// پنل مدیریت — عیناً همون HTML/منطق worker.js، فقط env.FLIGHTS_KV -> kv
// و Response(...) کلودفلر -> res.status().send() اکسپرس.
// ------------------------------------------------------------------

import { kv } from './kv.js';
import { ALL_AIRPORTS } from './flights.js';
import { safeTokenEqual } from './security.js';

export async function handleAdmin(req, res) {
  const secret = process.env.REFRESH_SECRET;

  if (!secret) {
    res.status(503).send('Admin panel disabled: REFRESH_SECRET is not configured.');
    return;
  }

  const token = req.query.token || '';

  if (!safeTokenEqual(token, secret)) {
    res.set('content-type', 'text/html; charset=utf-8');
    res.send(renderLoginPage());
    return;
  }

  const data = await buildAdminData();
  res.set('content-type', 'text/html; charset=utf-8');
  res.send(renderAdminPage(data, token));
}

async function buildAdminData() {
  const airportStats = [];
  for (const a of ALL_AIRPORTS) {
    const lastRun = await kv.get(`last_run:${a.iata}`);
    airportStats.push({ iata: a.iata, name: a.name, group: a.group, lastRun: lastRun || '—' });
  }

  return { airportStats };
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
