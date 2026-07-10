// ==================================================================
// تنظیمات امنیتی
// ==================================================================
// آدرس‌های مجاز داشبورد رو اینجا لیست کن تا فقط اینا بتونن به API وصل بشن
const ALLOWED_ORIGINS = [
  'https://iran-flight-trackrt-dashboard.nirahelp.workers.dev',
  'https://flight-track.travellab.ir'
];

// توجه: مقدار واقعی REFRESH_SECRET رو فقط توی Cloudflare Secrets ست کن
// (Settings > Variables and Secrets > Add > نوع: Secret > نام: REFRESH_SECRET)
// هیچوقت این مقدار رو توی کد یا گیت‌هاب ننویس.

export default {
  async scheduled(event, env, ctx) {
    await trackAll(env);
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(request) });
    }

    // مسیر عمومی: فقط خواندن داده از KV، بدون تماس با aviationstack
    if (url.pathname === '/api/flights') {
      // کش ۵ دقیقه‌ای تا فشار روی KV کم بشه
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

    // مسیر خصوصی: فقط با رمز مخفی خودت میشه دستی داده رو رفرش کرد
    if (url.pathname === '/api/refresh') {
      const secret = env.REFRESH_SECRET;

      // اگه secret روی Cloudflare ست نشده باشه، مسیر کاملاً غیرفعال می‌مونه
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
      await trackAll(env);
      return new Response(JSON.stringify({ status: 'refreshed' }), {
        headers: { 'content-type': 'application/json', ...corsHeaders(request) }
      });
    }

    // هر مسیر دیگه‌ای: هیچ تماسی با API خارجی نمی‌زنیم
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

async function trackAll(env) {
  const AIRPORTS = ['THR', 'IKA'];
  const API_KEY = env.AVIATIONSTACK_KEY; // از Secrets بخون، نه هاردکد
  const now = new Date().toISOString();

  for (const airport of AIRPORTS) {
    try {
      const url = `http://api.aviationstack.com/v1/flights?access_key=${API_KEY}&dep_iata=${airport}`;
      const res = await fetch(url);
      const json = await res.json();
      const key = `${airport}_${now}`;
      await env.FLIGHTS_KV.put(key, JSON.stringify(json));
    } catch (err) {
      await env.FLIGHTS_KV.put(`error_${airport}_${now}`, String(err));
    }
  }

  // زمان واقعی آخرین جمع‌آوری رو جدا ذخیره می‌کنیم
  await env.FLIGHTS_KV.put('last_run', now);
}

async function getAllFlights(env) {
  const list = await env.FLIGHTS_KV.list();
  const latestByFlight = new Map();

  for (const item of list.keys) {
    if (item.name.startsWith('error_')) continue;

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

  const lastRun = await env.FLIGHTS_KV.get('last_run');

  return {
    updated_at: lastRun || new Date().toISOString(),
    count: latestByFlight.size,
    flights: Array.from(latestByFlight.values())
  };
}
