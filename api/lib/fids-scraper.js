// lib/fids-scraper.js
// ------------------------------------------------------------------
// پورت Node.js نسخه‌ی fids-scraper.js کلودفلر. تنها تفاوت واقعی: به‌جای
// HTMLRewriter (که فقط داخل Cloudflare Workers وجود داره) از cheerio
// برای پارس HTML استفاده می‌کنیم. منطق نگاشت فیلدها، STATUS_MAP، و
// fidsToAviationstackShape عیناً همونه — worker.js/flights.js نیازی به
// تغییر نداره.
//
// درخواست HTML خام هنوز از طریق fids-relay (روی لیارا، لوکیشن ایران) رد
// می‌شه چون fids.airport.ir احتمالاً از خارج ایران هندشیک SSL تمیزی
// نمی‌ده. آدرس relay از env.FIDS_RELAY_URL خونده می‌شه.
// ------------------------------------------------------------------

import * as cheerio from 'cheerio';

export const FIDS_BASE_URL = 'https://fids.airport.ir';

// از process.env.FIDS_RELAY_URL خونده می‌شه (پیش‌فرض: همون relay فعلی).
export const RELAY_BASE_URL = process.env.FIDS_RELAY_URL || 'https://fids-relay.liara.run';

export const FIDS_AIRPORTS = {
  '2':   ['اطلاعات-پرواز-فرودگاه-مهرآباد', 'فرودگاه مهرآباد'],
  '102': ['اطلاعات-پرواز-فرودگاه-مشهد', 'فرودگاه مشهد'],
  '1':   ['اطلاعات-پرواز-فرودگاه-شيراز', 'فرودگاه شيراز'],
  '103': ['اطلاعات-پرواز-فرودگاه-تبريز', 'فرودگاه تبريز'],
  '114': ['اطلاعات-پرواز-فرودگاه-اصفهان', 'فرودگاه اصفهان'],
  '401': ['اطلاعات-پرواز-فرودگاه-اهواز', 'فرودگاه اهواز'],
  '117': ['اطلاعات-پرواز-فرودگاه-بندرعباس', 'فرودگاه بندرعباس'],
  '104': ['اطلاعات-پرواز-فرودگاه-بوشهر', 'فرودگاه بوشهر'],
  '201': ['اطلاعات-پرواز-فرودگاه-کرمان', 'فرودگاه کرمان'],
  '106': ['اطلاعات-پرواز-فرودگاه-ساري', 'فرودگاه ساري'],
  '107': ['اطلاعات-پرواز-فرودگاه-يزد', 'فرودگاه يزد'],
  '111': ['اطلاعات-پرواز-فرودگاه-کرمانشاه', 'فرودگاه کرمانشاه'],
  '110': ['اطلاعات-پرواز-فرودگاه-اروميه', 'فرودگاه اروميه'],
  '203': ['اطلاعات-پرواز-فرودگاه-رشت', 'فرودگاه رشت'],
  '109': ['اطلاعات-پرواز-فرودگاه-زاهدان', 'فرودگاه زاهدان'],
  '301': ['اطلاعات-پرواز-فرودگاه-آبادان', 'فرودگاه آبادان'],
  '113': ['اطلاعات-پرواز-فرودگاه-اردبيل', 'فرودگاه اردبيل'],
};

export const IATA_TO_FIDS_ID = {
  THR: '2', MHD: '102', SYZ: '1', TBZ: '103', IFN: '114', AWZ: '401',
  BND: '117', BUZ: '104', KER: '201', SRY: '106', AZD: '107', KSH: '111',
  OMH: '110', RAS: '203', ZAH: '109', ABD: '301', ADU: '113',
};

export const CITY_NAME_TO_IATA = {
  'تهران': 'THR', 'مهرآباد': 'THR',
  'امام خمینی': 'IKA', 'فرودگاه امام خمینی': 'IKA',
  'مشهد': 'MHD',
  'شيراز': 'SYZ', 'شیراز': 'SYZ',
  'اصفهان': 'IFN',
  'تبريز': 'TBZ', 'تبریز': 'TBZ',
  'کیش': 'KIH', 'کيش': 'KIH',
  'اهواز': 'AWZ',
  'بندرعباس': 'BND',
  'کرمان': 'KER',
  'يزد': 'AZD', 'یزد': 'AZD',
  'اروميه': 'OMH', 'ارومیه': 'OMH',
  'رشت': 'RAS',
  'ساري': 'SRY', 'ساری': 'SRY',
  'زاهدان': 'ZAH',
  'کرمانشاه': 'KSH',
  'آبادان': 'ABD',
  'بوشهر': 'BUZ',
  'اردبيل': 'ADU', 'اردبیل': 'ADU',
  'چابهار': 'ZBR',
};

function cityToCode(cityRaw) {
  if (!cityRaw) return '';
  const clean = cityRaw.trim();
  return CITY_NAME_TO_IATA[clean] || clean;
}

// div id -> [کلید دسته‌بندی، نقش ستون شهر]
const TAB_MAP = {
  input: ['arrivals_domestic', 'origin'],
  output: ['departures_domestic', 'destination'],
  internal: ['arrivals_international', 'origin'],
  external: ['departures_international', 'destination'],
};

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8',
};

function buildFidsUrl(fidsId) {
  const entry = FIDS_AIRPORTS[fidsId];
  if (!entry) throw new Error(`Unknown fids airport id: ${fidsId}`);
  return `${FIDS_BASE_URL}/${fidsId}/${entry[0]}`;
}

function splitDayCell(dayRaw) {
  if (!dayRaw) return [null, null];
  const m = dayRaw.trim().match(/^(\S+)\s+(\d{1,2}:\d{2})$/);
  if (m) return [m[1], m[2]];
  return [dayRaw, null];
}

// چند کلاس ستون ممکنه هرکدوم توی یک نوع جدول (داخلی/بین‌المللی/ورودی/
// خروجی) پر بشن ولی معنای یکسانی داشته باشن (دقیقاً مثل نسخه‌ی
// HTMLRewriter که چند handler روی یک فیلد می‌نوشتن). این تابع متن همه‌ی
// اون کلاس‌ها رو برای یک ردیف به هم می‌چسبونه.
function cellText($tr, classNames) {
  let out = '';
  for (const cls of classNames) {
    const t = $tr.find(`td.${cls}`).first().text();
    if (t) out += t;
  }
  return out;
}

function parseSection($, divId, category, cityRole) {
  const rows = [];

  $(`#${divId} tbody tr`).each((_, trEl) => {
    const $tr = $(trEl);

    const day = cellText($tr, ['cell-day']).trim() || null;
    const airline = cellText($tr, ['cell-airline']).trim() || null;
    const flight_no = cellText($tr, ['cell-fno']).trim() || null;
    const city = (cellText($tr, ['cell-orig', 'cell-dest']) || '').trim() || null;
    const status = cellText($tr, ['cell-status']).trim() || null;
    const belt_or_counter = cellText($tr, ['cell-aircraft2', 'cell-counter']).trim() || null;
    const actual_time = cellText($tr, ['cell-aircraft3', 'cell-dateTime2', 'cell-dateTime3']).trim() || null;
    const aircraft = cellText($tr, ['cell-aircraft']).trim() || null;
    const date = cellText($tr, ['cell-date']).trim() || null;

    const imgSrc = $tr.find('td.cell-airline img').first().attr('src') || '';
    const file = imgSrc.split('/').pop() || '';
    const airline_code = file.replace(/\.[a-zA-Z0-9]+$/, '') || null;

    if (!flight_no && !city) return; // ردیف خالی/هدر، نادیده بگیر

    const [weekday, scheduledTime] = splitDayCell(day);
    rows.push({
      category,
      day,
      weekday,
      scheduled_time: scheduledTime,
      airline,
      airline_code,
      flight_no,
      city,
      city_role: cityRole,
      status,
      belt_or_counter,
      actual_time,
      aircraft,
      date,
    });
  });

  return rows;
}

async function parseFidsHtml(html) {
  const $ = cheerio.load(html);
  const result = {
    arrivals_domestic: [],
    departures_domestic: [],
    arrivals_international: [],
    departures_international: [],
  };

  for (const [divId, [category, cityRole]] of Object.entries(TAB_MAP)) {
    result[category] = parseSection($, divId, category, cityRole);
  }

  return result;
}

// درخواست مستقیماً به fids.airport.ir نمی‌ره، از fids-relay (لیارا،
// لوکیشن ایران) رد می‌شه.
export async function fetchFidsAirport(fidsId) {
  const targetUrl = buildFidsUrl(fidsId);
  const relayUrl = `${RELAY_BASE_URL}/proxy?url=${encodeURIComponent(targetUrl)}`;
  const res = await fetch(relayUrl, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`fids relay fetch failed: ${res.status} ${relayUrl}`);
  const html = await res.text();
  const data = await parseFidsHtml(html);
  data.airport_id = fidsId;
  data.url = targetUrl;
  return data;
}

const STATUS_MAP = [
  [/لغو/, 'cancelled'],
  [/نشست|فرود/, 'landed'],
  [/تاخیر|تأخیر/, 'delayed'],
  [/دریافت بار|نقاله/, 'landed'],
  [/دریافت کارت پرواز|پذیرش/, 'checkin'],
  [/پایان پذیرش/, 'gate_closed'],
  [/طبق برنامه|به موقع/, 'scheduled'],
  [/منتظر اعلام|در حال بررسی/, 'scheduled'],
  [/پرواز کرد|اقلاع کرد|برخاست/, 'active'],
];

function mapStatus(raw) {
  if (!raw) return 'unknown';
  const clean = raw.trim();
  for (const [re, mapped] of STATUS_MAP) {
    if (re.test(clean)) return mapped;
  }
  return 'unknown';
}

function toIsoDateTime(dateStr, timeStr) {
  if (!timeStr) return '';
  const today = new Date();
  const [hh, mm] = timeStr.split(':').map(n => parseInt(n, 10));
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), hh, mm));
  return d.toISOString();
}

export function fidsToAviationstackShape(fidsData, myIata) {
  const out = [];
  const categories = [
    'arrivals_domestic',
    'departures_domestic',
    'arrivals_international',
    'departures_international',
  ];

  for (const cat of categories) {
    const isArrival = cat.startsWith('arrivals');
    for (const row of fidsData[cat] || []) {
      const otherIata = cityToCode(row.city);
      const scheduledIso = toIsoDateTime(row.date, row.scheduled_time);
      const actualIso = row.actual_time && /\d{1,2}:\d{2}/.test(row.actual_time)
        ? toIsoDateTime(row.date, row.actual_time.match(/\d{1,2}:\d{2}/)[0])
        : '';

      const dep = isArrival
        ? { iata: otherIata, scheduled: scheduledIso, estimated: '', actual: actualIso, delay: null }
        : { iata: myIata, scheduled: scheduledIso, estimated: '', actual: actualIso, delay: null };
      const arr = isArrival
        ? { iata: myIata, scheduled: scheduledIso, estimated: '', actual: actualIso, delay: null }
        : { iata: otherIata, scheduled: scheduledIso, estimated: '', actual: actualIso, delay: null };

      out.push({
        flight: { iata: row.flight_no || '', icao: '' },
        airline: { name: row.airline || 'Unknown', iata: row.airline_code || '', icao: '' },
        departure: dep,
        arrival: arr,
        flight_status: mapStatus(row.status),
        _fids_raw_status: row.status,
      });
    }
  }

  return { data: out };
}

export async function fetchAirportViaFids(iata) {
  const fidsId = IATA_TO_FIDS_ID[iata];
  if (!fidsId) throw new Error(`No fids coverage for ${iata} (use aviationstack fallback)`);
  const data = await fetchFidsAirport(fidsId);
  return fidsToAviationstackShape(data, iata);
}
