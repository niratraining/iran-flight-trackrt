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

  // بدون timeout صریح، اگه fids.airport.ir کند/بی‌جواب باشه، این fetch
  // معلق می‌مونه تا لایه‌ی Cloudflare جلوی لیارا خودش بعد از ~۲۵-۳۰ ثانیه
  // قطعش کنه (خطای ۵۲۲ مبهم). با AbortController سریع‌تر (۱۰ ثانیه) و با
  // پیام روشن fail می‌شیم تا worker.js زودتر بفهمه FIDS جواب نداده.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const upstream = await fetch(target, { headers: FETCH_HEADERS, signal: controller.signal });
    const html = await upstream.text();
    res.status(upstream.ok ? 200 : upstream.status);
    res.set('content-type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    const isTimeout = err && err.name === 'AbortError';
    res.status(504).json({ error: isTimeout ? 'timeout fetching fids.airport.ir (>10s)' : String(err) });
  } finally {
    clearTimeout(timeoutId);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('fids-relay listening on port ' + port);
});
