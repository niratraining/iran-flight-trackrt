// fids-relay — یک واسط ساده که روی لیارا (لوکیشن ایران) اجرا می‌شه.
// کارش فقط اینه: HTML خام یک صفحه‌ی fids.airport.ir رو بگیره و بدون تغییر
// برگردونه. چون این سرور داخل ایرانه، هندشیک SSL با fids.airport.ir مشکلی
// نداره (بر خلاف Cloudflare Worker که خارج از ایران اجرا می‌شه).

import express from 'express';

const app = express();

const ALLOWED_PREFIX = 'https://fids.airport.ir/';

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8',
};

app.get('/', (req, res) => {
  res.status(200).send('fids-relay ok');
});

// GET /proxy?url=https%3A%2F%2Ffids.airport.ir%2F2%2F...
app.get('/proxy', async (req, res) => {
  const target = req.query.url;
  if (!target || typeof target !== 'string' || !target.startsWith(ALLOWED_PREFIX)) {
    res.status(400).json({ error: 'invalid or missing url (must start with ' + ALLOWED_PREFIX + ')' });
    return;
  }

  try {
    const upstream = await fetch(target, { headers: FETCH_HEADERS });
    const html = await upstream.text();
    res.status(upstream.ok ? 200 : upstream.status);
    res.set('content-type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('fids-relay listening on port ' + port);
});
