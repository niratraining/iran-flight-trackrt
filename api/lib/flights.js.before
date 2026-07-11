// lib/flights.js
// ------------------------------------------------------------------
// پورت مستقیم منطق کسب‌وکار worker.js (Cloudflare). تنها تغییرات واقعی:
//   - env.FLIGHTS_KV  -> kv (از lib/kv.js، بک‌اند MongoDB)
//   - env[NAME]       -> process.env[NAME]
//   - caches.default  -> lib/cache.js (کش داخل‌پردازه‌ای)
// خودِ الگوریتم‌ها (امتیاز اعتمادپذیری، تجمیع روزانه، leaderboard
// accumulator تدریجی و ...) کلمه‌به‌کلمه همون منطق قبلیه.
// ------------------------------------------------------------------

import { kv } from './kv.js';
import { fetchAirportViaFids, IATA_TO_FIDS_ID } from './fids-scraper.js';

export const ALL_AIRPORTS = [
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
  { iata: 'ZBR', name: 'چابهار', group: 'other' },
  // ۷ فرودگاه تازه — پوشش FIDS تأیید شده (داده‌ی زنده دارن):
  { iata: 'GBT', name: 'گرگان', group: 'other' },
  { iata: 'HDM', name: 'همدان', group: 'other' },
  { iata: 'SDG', name: 'سنندج', group: 'other' },
  { iata: 'XBJ', name: 'بیرجند', group: 'other' },
  { iata: 'JWN', name: 'زنجان', group: 'other' },
  { iata: 'LRR', name: 'لارستان', group: 'other' },
  { iata: 'KHD', name: 'خرم‌آباد', group: 'other' },
  // این‌ها توی لیست فرودگاه‌ها هستن، ولی چون آی‌دی دقیق fids.airport.ir
  // براشون هنوز تأیید نشده، فعلاً بدون داده می‌مونن (مثل IKA/KIH/ZBR) —
  // حدس زدن آی‌دی غلط ریسکش نشون‌دادن داده‌ی یه فرودگاه دیگه زیر این
  // اسمه، که بدتر از بدون‌داده بودنه.
  { iata: 'BJB', name: 'بجنورد', group: 'other' },
  { iata: 'IIL', name: 'ایلام', group: 'other' },
  { iata: 'PFQ', name: 'پارس‌آباد مغان', group: 'other' },
  { iata: 'SMN', name: 'سمنان', group: 'other' },
  { iata: 'RUD', name: 'شاهرود', group: 'other' },
  { iata: 'NSH', name: 'نوشهر', group: 'other' },
  { iata: 'YES', name: 'یاسوج', group: 'other' },
  { iata: 'CQD', name: 'شهرکرد', group: 'other' },
  { iata: 'AJK', name: 'اراک', group: 'other' },
  { iata: 'ACZ', name: 'زابل', group: 'other' },
  { iata: 'LFM', name: 'لامرد', group: 'other' }
];

export const MAIN_AIRPORTS = ALL_AIRPORTS.filter(a => a.group === 'main').map(a => a.iata);
export const OTHER_AIRPORTS = ALL_AIRPORTS.filter(a => a.group === 'other').map(a => a.iata);

// فرودگاه‌هایی که از FIDS (اسکرپ رایگان fids.airport.ir) پوشش داده می‌شن.
// بقیه (فعلاً IKA, KIH, ZBR) هیچ منبع داده‌ای ندارن — از وقتی aviationstack
// حذف شد، fetchAllFlightsForAirport براشون یه لیست خالی برمی‌گردونه (بدون
// خطا)، پس توی جدول و آمار «بدون داده» نشون داده می‌شن ولی همچنان توی
// لیست فرودگاه‌ها می‌مونن.
export const FIDS_COVERED_AIRPORTS = ALL_AIRPORTS
  .filter(a => Boolean(IATA_TO_FIDS_ID[a.iata]))
  .map(a => a.iata);

const MIN_SAMPLE_SIZE = 5;
const BUSY_ROUTE_THRESHOLD = 7;
const BUSY_WINDOW_DAYS = 7;
const QUIET_WINDOW_DAYS = 15;

// ------------------------------------------------------------------
// جمع‌آوری داده — فقط از FIDS (aviationstack کاملاً حذف شده)
// ------------------------------------------------------------------

async function fetchAllFlightsForAirport(airport) {
  if (IATA_TO_FIDS_ID[airport]) {
    const json = await fetchAirportViaFids(airport);
    return { data: json.data, calls_used: 0, key_used: null, source: 'fids' };
  }
  // بدون پوشش FIDS و بدون aviationstack: نه خطا بده نه crash کنه، فقط
  // خالی برگردون تا trackAirports این فرودگاه رو 'ok' با ۰ پرواز ثبت کنه.
  return { data: [], calls_used: 0, key_used: null, source: 'none' };
}

export async function trackAirports(airportCodes) {
  const now = new Date().toISOString();
  const results = [];

  for (const airport of airportCodes) {
    try {
      const { data, calls_used, key_used } = await fetchAllFlightsForAirport(airport);
      const json = { data };

      await kv.put(`${airport}_${now}`, JSON.stringify(json), { expirationTtl: 10 * 86400 });
      await kv.put(`last_run:${airport}`, now);

      const loggedCount = await logCompletedFlights(json, airport);

      results.push({ airport, status: 'ok', key_used, calls_used, logged: loggedCount });
    } catch (err) {
      await kv.put(`error_${airport}_${now}`, String(err));
      results.push({ airport, status: 'error', error: String(err) });
    }
  }

  return results;
}

export async function getAllFlights() {
  const latestByFlight = new Map();
  let updatedAt = null;

  for (const airport of ALL_AIRPORTS) {
    const lastRun = await kv.get(`last_run:${airport.iata}`);
    if (!lastRun) continue;
    if (!updatedAt || lastRun > updatedAt) updatedAt = lastRun;

    const raw = await kv.get(`${airport.iata}_${lastRun}`);
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
        checked_at: lastRun,
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

  if (!updatedAt) {
    updatedAt = await kv.get('last_run');
  }

  return {
    updated_at: updatedAt || new Date().toISOString(),
    count: latestByFlight.size,
    flights: Array.from(latestByFlight.values())
  };
}

// ------------------------------------------------------------------
// امتیاز اعتمادپذیری — ثبت تاریخی + تجمیع
// ------------------------------------------------------------------

function tehranDateStr(d = new Date()) {
  const tehran = new Date(d.getTime() + 3.5 * 3600 * 1000);
  return tehran.toISOString().slice(0, 10);
}

function flightDateFromScheduled(scheduled) {
  if (!scheduled) return null;
  return scheduled.slice(0, 10);
}

export { tehranDateStr };

async function logCompletedFlights(json, depAirport) {
  const flights = json.data || [];
  const puts = [];

  for (const f of flights) {
    const status = f.flight_status;
    if (status !== 'landed' && status !== 'cancelled') continue;

    const dep = f.departure || {};
    const arr = f.arrival || {};
    const airline = f.airline || {};
    const flightInfo = f.flight || {};

    const flightIata = flightInfo.iata || flightInfo.icao;
    const airlineIata = airline.iata || airline.icao || 'UNK';
    const depIata = dep.iata || depAirport;
    const arrIata = arr.iata || '';
    if (!flightIata || !arrIata) continue;

    const date = flightDateFromScheduled(dep.scheduled) || tehranDateStr();
    const route = `${depIata}-${arrIata}`;

    const record = {
      flight_date: date,
      route,
      dep_iata: depIata,
      arr_iata: arrIata,
      airline_iata: airlineIata,
      airline_name: airline.name || 'Unknown',
      flight_iata: flightIata,
      dep_scheduled: dep.scheduled || '',
      dep_actual: dep.actual || '',
      dep_delay: dep.delay ?? null,
      arr_scheduled: arr.scheduled || '',
      arr_actual: arr.actual || '',
      arr_delay: arr.delay ?? null,
      status
    };

    const key = `flight_log:${date}:${route}:${airlineIata}:${flightIata}:${dep.scheduled}`;
    puts.push(kv.put(key, JSON.stringify(record)));
  }

  await Promise.all(puts);
  return puts.length;
}

export async function aggregateDailyStats(date) {
  const prefix = `flight_log:${date}:`;
  const grouped = new Map();

  let cursor;
  do {
    const list = await kv.list({ prefix, cursor });
    for (const item of list.keys) {
      const raw = await kv.get(item.name);
      if (!raw) continue;
      let rec;
      try { rec = JSON.parse(raw); } catch { continue; }

      const groupKey = `${rec.route}:${rec.airline_iata}`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, { total: 0, onTime: 0, delayed: 0, cancelled: 0, delaySum: 0, delaySamples: 0, airlineName: rec.airline_name || null });
      }
      const g = grouped.get(groupKey);
      g.total++;
      if (rec.airline_name) g.airlineName = rec.airline_name;

      if (rec.status === 'cancelled') {
        g.cancelled++;
        continue;
      }

      const delay = typeof rec.dep_delay === 'number' ? rec.dep_delay : 0;
      g.delaySum += delay;
      g.delaySamples++;
      if (delay <= 0) g.onTime++;
      else g.delayed++;
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  const puts = [];
  const byAirlineToday = new Map();
  for (const [groupKey, g] of grouped) {
    const lastColon = groupKey.lastIndexOf(':');
    const route = groupKey.slice(0, lastColon);
    const airline = groupKey.slice(lastColon + 1);

    const value = {
      total_flights: g.total,
      on_time_count: g.onTime,
      delayed_count: g.delayed,
      cancelled_count: g.cancelled,
      sum_delay_minutes: g.delaySum,
      delay_samples: g.delaySamples,
      avg_delay_minutes: g.delaySamples > 0 ? Math.round((g.delaySum / g.delaySamples) * 10) / 10 : 0,
      airline_name: g.airlineName
    };
    puts.push(kv.put(`daily_stats:${route}:${airline}:${date}`, JSON.stringify(value)));

    if (!byAirlineToday.has(airline)) byAirlineToday.set(airline, emptyLeaderboardAcc());
    const a = byAirlineToday.get(airline);
    a.total += g.total;
    a.onTime += g.onTime;
    a.delayed += g.delayed;
    a.cancelled += g.cancelled;
    a.delaySum += g.delaySum;
    a.delaySamples += g.delaySamples;
    if (g.airlineName) a.airlineName = g.airlineName;
    if (!a.routes[route]) a.routes[route] = { total: 0, onTime: 0, cancelled: 0 };
    a.routes[route].total += g.total;
    a.routes[route].onTime += g.onTime;
    a.routes[route].cancelled += g.cancelled;
  }

  await Promise.all(puts);
  return { count: grouped.size, byAirlineToday };
}

export async function classifyRoutes() {
  const dates = new Set();
  for (let i = 0; i < BUSY_WINDOW_DAYS; i++) {
    dates.add(tehranDateStr(new Date(Date.now() - i * 86400000)));
  }

  const routeTotals = new Map();
  let cursor;
  do {
    const list = await kv.list({ prefix: 'daily_stats:', cursor });
    for (const item of list.keys) {
      const parts = item.name.split(':');
      const date = parts[3];
      if (!dates.has(date)) continue;

      const route = parts[1];
      const raw = await kv.get(item.name);
      if (!raw) continue;
      const stats = JSON.parse(raw);
      routeTotals.set(route, (routeTotals.get(route) || 0) + stats.total_flights);
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  const puts = [];
  for (const [route, total] of routeTotals) {
    const classification = total >= BUSY_ROUTE_THRESHOLD ? 'busy' : 'quiet';
    const value = {
      classification,
      flights_last_7_days: total,
      window_days: classification === 'busy' ? BUSY_WINDOW_DAYS : QUIET_WINDOW_DAYS,
      updated_at: new Date().toISOString()
    };
    puts.push(kv.put(`route_class:${route}`, JSON.stringify(value)));
  }
  await Promise.all(puts);
  return routeTotals.size;
}

export async function updateRollingScores() {
  const routeWindowCache = new Map();
  async function getRouteWindowDays(route) {
    if (routeWindowCache.has(route)) return routeWindowCache.get(route);
    const raw = await kv.get(`route_class:${route}`);
    const windowDays = raw ? JSON.parse(raw).window_days : QUIET_WINDOW_DAYS;
    routeWindowCache.set(route, windowDays);
    return windowDays;
  }

  const cutoff = tehranDateStr(new Date(Date.now() - (QUIET_WINDOW_DAYS - 1) * 86400000));
  const pairs = new Map();

  let cursor;
  do {
    const list = await kv.list({ prefix: 'daily_stats:', cursor });
    for (const item of list.keys) {
      const parts = item.name.split(':');
      const route = parts[1], airline = parts[2], date = parts[3];
      if (date < cutoff) continue;
      const pairKey = `${route}:${airline}`;
      if (!pairs.has(pairKey)) pairs.set(pairKey, []);
      pairs.get(pairKey).push(item.name);
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  const puts = [];
  for (const [pairKey, dailyKeys] of pairs) {
    const lastColon = pairKey.lastIndexOf(':');
    const route = pairKey.slice(0, lastColon);
    const airline = pairKey.slice(lastColon + 1);

    const windowDays = await getRouteWindowDays(route);
    const windowCutoff = tehranDateStr(new Date(Date.now() - (windowDays - 1) * 86400000));

    let total = 0, onTime = 0, delayed = 0, cancelled = 0, delaySum = 0, delaySamples = 0, airlineName = null;
    for (const dailyKey of dailyKeys) {
      const date = dailyKey.split(':')[3];
      if (date < windowCutoff) continue;
      const raw = await kv.get(dailyKey);
      if (!raw) continue;
      const s = JSON.parse(raw);
      total += s.total_flights;
      onTime += s.on_time_count;
      delayed += s.delayed_count;
      cancelled += s.cancelled_count;
      delaySum += s.sum_delay_minutes;
      delaySamples += s.delay_samples;
      if (s.airline_name) airlineName = s.airline_name;
    }

    const completed = total - cancelled;

    const value = {
      insufficient_data: total < MIN_SAMPLE_SIZE,
      reason: total < MIN_SAMPLE_SIZE ? `فقط ${total} پرواز در ${windowDays} روز اخیر ثبت شده` : null,
      score_percent: (total >= MIN_SAMPLE_SIZE && completed > 0) ? Math.round((onTime / completed) * 1000) / 10 : null,
      all_cancelled: completed === 0,
      avg_delay_minutes: delaySamples > 0 ? Math.round((delaySum / delaySamples) * 10) / 10 : 0,
      cancellation_rate: total > 0 ? Math.round((cancelled / total) * 1000) / 10 : 0,
      completed_flights: completed,
      sample_size: total,
      on_time_count: onTime,
      delayed_count: delayed,
      cancelled_count: cancelled,
      delay_sum_minutes: delaySum,
      delay_samples: delaySamples,
      window_days: windowDays,
      airline_name: airlineName,
      last_updated: new Date().toISOString()
    };
    puts.push(kv.put(`reliability_score:${route}:${airline}`, JSON.stringify(value)));
  }

  await Promise.all(puts);
  return puts.length;
}

export async function getReliabilityForRoute(route) {
  const prefix = `reliability_score:${route}:`;
  const airlines = [];

  let cursor;
  do {
    const list = await kv.list({ prefix, cursor });
    for (const item of list.keys) {
      const airlineIata = item.name.slice(prefix.length);
      const raw = await kv.get(item.name);
      if (!raw) continue;
      airlines.push({ airline_iata: airlineIata, ...JSON.parse(raw) });
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  airlines.sort((a, b) => {
    if (a.insufficient_data && !b.insufficient_data) return 1;
    if (!a.insufficient_data && b.insufficient_data) return -1;
    return (b.score_percent ?? -1) - (a.score_percent ?? -1);
  });

  const routeClassRaw = await kv.get(`route_class:${route}`);

  return {
    route,
    classification: routeClassRaw ? JSON.parse(routeClassRaw) : null,
    airlines
  };
}

function emptyLeaderboardAcc() {
  return { total: 0, onTime: 0, delayed: 0, cancelled: 0, delaySum: 0, delaySamples: 0, airlineName: null, routes: {} };
}

function addLeaderboardAcc(dst, src) {
  dst.total += src.total;
  dst.onTime += src.onTime;
  dst.delayed += src.delayed;
  dst.cancelled += src.cancelled;
  dst.delaySum += src.delaySum;
  dst.delaySamples += src.delaySamples;
  if (src.airlineName) dst.airlineName = src.airlineName;
  for (const [route, r] of Object.entries(src.routes)) {
    if (!dst.routes[route]) dst.routes[route] = { total: 0, onTime: 0, cancelled: 0 };
    dst.routes[route].total += r.total;
    dst.routes[route].onTime += r.onTime;
    dst.routes[route].cancelled += r.cancelled;
  }
}

const LEADERBOARD_ACC_KEY = 'leaderboard_accumulator';

async function buildLeaderboardAccumulatorFromFullHistory() {
  const baked = {};

  let cursor;
  do {
    const list = await kv.list({ prefix: 'daily_stats:', cursor });
    for (const item of list.keys) {
      const raw = await kv.get(item.name);
      if (!raw) continue;
      let s;
      try { s = JSON.parse(raw); } catch { continue; }

      const parts = item.name.split(':');
      const route = parts[1], airline = parts[2];

      if (!baked[airline]) baked[airline] = emptyLeaderboardAcc();
      const a = baked[airline];
      a.total += s.total_flights;
      a.onTime += s.on_time_count;
      a.delayed += s.delayed_count;
      a.cancelled += s.cancelled_count;
      a.delaySum += s.sum_delay_minutes;
      a.delaySamples += s.delay_samples;
      if (s.airline_name) a.airlineName = s.airline_name;

      if (!a.routes[route]) a.routes[route] = { total: 0, onTime: 0, cancelled: 0 };
      a.routes[route].total += s.total_flights;
      a.routes[route].onTime += s.on_time_count;
      a.routes[route].cancelled += s.cancelled_count;
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  return { baked, pendingDate: null, pending: {} };
}

export async function updateLeaderboardStats(date, todayByAirline) {
  const raw = await kv.get(LEADERBOARD_ACC_KEY);
  let acc;
  if (raw) {
    try { acc = JSON.parse(raw); } catch { acc = null; }
  }
  if (!acc) {
    acc = await buildLeaderboardAccumulatorFromFullHistory();
  }

  if (acc.pendingDate && acc.pendingDate !== date) {
    for (const [airline, a] of Object.entries(acc.pending)) {
      if (!acc.baked[airline]) acc.baked[airline] = emptyLeaderboardAcc();
      addLeaderboardAcc(acc.baked[airline], a);
    }
  }

  acc.pendingDate = date;
  acc.pending = {};
  for (const [airline, a] of todayByAirline) {
    acc.pending[airline] = a;
  }

  const combined = {};
  for (const [airline, a] of Object.entries(acc.baked)) {
    combined[airline] = emptyLeaderboardAcc();
    addLeaderboardAcc(combined[airline], a);
  }
  for (const [airline, a] of Object.entries(acc.pending)) {
    if (!combined[airline]) combined[airline] = emptyLeaderboardAcc();
    addLeaderboardAcc(combined[airline], a);
  }

  const airlines = [];
  for (const [airlineIata, a] of Object.entries(combined)) {
    if (a.total < MIN_SAMPLE_SIZE) continue;

    const completed = a.total - a.cancelled;

    const routes = Object.entries(a.routes)
      .map(([route, r]) => {
        const routeCompleted = r.total - r.cancelled;
        return { route, total: r.total, on_time_rate: routeCompleted ? Math.round((r.onTime / routeCompleted) * 1000) / 10 : 0 };
      })
      .filter(r => r.total >= 2)
      .sort((x, y) => x.on_time_rate - y.on_time_rate)
      .slice(0, 3);

    airlines.push({
      airline_iata: airlineIata,
      airline_name: a.airlineName,
      sample_size: a.total,
      completed_flights: completed,
      on_time_rate: completed > 0 ? Math.round((a.onTime / completed) * 1000) / 10 : 0,
      avg_delay_minutes: a.delaySamples > 0 ? Math.round((a.delaySum / a.delaySamples) * 10) / 10 : 0,
      cancellation_rate: a.total > 0 ? Math.round((a.cancelled / a.total) * 1000) / 10 : 0,
      delayed_count: a.delayed,
      routes
    });
  }

  airlines.sort((x, y) => y.on_time_rate - x.on_time_rate);

  const value = { airlines, last_updated: new Date().toISOString() };
  await kv.put(LEADERBOARD_ACC_KEY, JSON.stringify(acc));
  await kv.put('leaderboard_stats', JSON.stringify(value));
  return airlines.length;
}

// ------------------------------------------------------------------
// اجرای شبانه‌ی کامل (معادل scheduled() در worker.js برای cron
// اصلی 29 20 * * * تهران). صدا زده می‌شه از node-cron در server.js.
// ------------------------------------------------------------------
export async function runNightlyJob() {
  await trackAirports(ALL_AIRPORTS.map(a => a.iata));

  const today = tehranDateStr(new Date());
  const { byAirlineToday } = await aggregateDailyStats(today);

  // طبقه‌بندی مسیرها (پرتردد/کم‌تردد) فقط یک بار در هفته لازمه — دوشنبه‌ی تهران.
  const tehranNow = new Date(Date.now() + 3.5 * 3600 * 1000);
  if (tehranNow.getUTCDay() === 1) {
    await classifyRoutes();
  }

  await updateRollingScores();
  await updateLeaderboardStats(today, byAirlineToday);
}

// فقط فچ خام پرواز‌ها (بدون آمار/اعتمادپذیری) — سبک، برای کرون مکرر
// (هر ۱۵ دقیقه) که فقط می‌خواد جدول/وضعیت زنده رو تازه نگه داره.
export async function refreshFlightsOnly(airportCodes) {
  return await trackAirports(airportCodes);
}

// فقط تجمیع آمار روزانه + امتیاز اعتمادپذیری + کارنامه — این بخش فول‌اسکن
// روی MongoDB می‌زنه (daily_stats:*, flight_log:*)، پس عمداً از فچ خام
// جدا شده تا با بازه‌ی کندتری (۳۰ دقیقه) صدا زده بشه، نه هر ۱۵ دقیقه.
export async function refreshStatsOnly() {
  const today = tehranDateStr(new Date());
  const { byAirlineToday } = await aggregateDailyStats(today);
  await updateRollingScores();
  await updateLeaderboardStats(today, byAirlineToday);
}

// معادل مسیر /api/refresh: یک رفرش دستی کامل (کل لیست یا یک فرودگاه)،
// بدون classifyRoutes (که فقط کرون شبانه صداش می‌زنه — دقیقاً مثل قبل).
export async function manualRefresh(airportCodes) {
  const results = await refreshFlightsOnly(airportCodes);
  await refreshStatsOnly();
  return results;
}
