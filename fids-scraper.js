// ==================================================================
// fids-scraper.js
// ------------------------------------------------------------------
// پورت جاوااسکریپتی fids_scraper.py برای اجرای مستقیم داخل Cloudflare
// Worker — بدون نیاز به pip/npm/ترمینال. فقط از HTMLRewriter داخلی
// Cloudflare استفاده می‌کنه (هیچ پکیج بیرونی لازم نیست).
//
// این فایل رو کنار worker.js توی گیت‌هاب اضافه کن (همون پوشه) و در
// worker.js با: import { fetchFidsAirport, FIDS_AIRPORTS, fidsToAviationstackShape }
// from './fids-scraper.js';  ایمپورتش کن.
// ==================================================================

export const FIDS_BASE_URL = 'https://fids.airport.ir';

// آدرس اپ لیارای شما بعد از دیپلوی (چیزی شبیه https://fids-relay.iran.liara.run).
// این رو بعد از ساخت اپ روی لیارا با آدرس واقعیش جایگزین کن.
export const RELAY_BASE_URL = 'https://fids-relay.liara.run';

// شناسه fids -> (اسلاگ آدرس, نام نمایشی). مستقیم از fids_scraper.py کپی شده.
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

// نگاشت IATA پروژه شما -> شناسه fids. فقط فرودگاه‌هایی که fids.airport.ir
// پوششش می‌ده اینجاست. IKA (امام خمینی)، KIH (کیش) و ZBR (چابهار) روی این
// سایت وجود ندارن — نکته‌ی مهمی که قبلاً گفتم.
export const IATA_TO_FIDS_ID = {
  THR: '2',
  MHD: '102',
  SYZ: '1',
  TBZ: '103',
  IFN: '114',
  AWZ: '401',
  BND: '117',
  BUZ: '104',
  KER: '201',
  SRY: '106',
  AZD: '107',
  KSH: '111',
  OMH: '110',
  RAS: '203',
  ZAH: '109',
  ABD: '301',
  ADU: '113',
};

// نام شهر (متنی که fids توی ستون مبدأ/مقصد می‌ده) -> کد IATA پروژه شما.
// این نگاشت فقط برای فرودگاه‌های داخلیِ لیست ALL_AIRPORTS پر شده. اگر
// پرواز به شهری بره که اینجا نیست (بین‌المللی یا داخلیِ خارج از لیست),
// خود متن فارسی شهر به‌عنوان کد جایگزین استفاده می‌شه (فقط برای گروه‌بندی
// آماری کار می‌کنه، شکل IATA نداره).
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
  return CITY_NAME_TO_IATA[clean] || clean; // fallback: خود نام فارسی
}

// div id روی صفحه -> (کلید دسته‌بندی، نقش ستون شهر)
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

// ------------------------------------------------------------------
// پارس یک بخش (div#input / #output / #internal / #external) با
// HTMLRewriter. چون HTMLRewriter استریمه، ردیف‌ها رو با یک آبجکت
// «سطر جاری» جمع می‌کنیم که با شروع هر <tr> جدید ریست می‌شه.
// ------------------------------------------------------------------
function parseSection(html, divId, category, cityRole) {
  const rows = [];
  let current = null;

  const finishRow = () => {
    if (current && (current.flight_no || current.city)) {
      const [weekday, scheduledTime] = splitDayCell(current.day || null);
      rows.push({
        category,
        day: current.day || null,
        weekday,
        scheduled_time: scheduledTime,
        airline: current.airline || null,
        airline_code: current.airline_code || null,
        flight_no: current.flight_no || null,
        city: current.city || null,
        city_role: cityRole,
        status: current.status || null,
        belt_or_counter: current.belt_or_counter || null,
        actual_time: current.actual_time || null,
        aircraft: current.aircraft || null,
        date: current.date || null,
      });
    }
    current = null;
  };

  const textHandler = (field) => ({
    text(text) {
      if (!current) return;
      current[field] = (current[field] || '') + text.text;
    },
  });

  const rewriter = new HTMLRewriter()
    .on(`#${divId} tbody tr`, {
      element() {
        finishRow();
        current = {};
      },
    })
    .on(`#${divId} tbody tr td.cell-day`, textHandler('day'))
    .on(`#${divId} tbody tr td.cell-airline`, textHandler('airline'))
    .on(`#${divId} tbody tr td.cell-airline img`, {
      element(el) {
        if (!current) return;
        const src = el.getAttribute('src') || '';
        const file = src.split('/').pop() || '';
        current.airline_code = file.replace(/\.[a-zA-Z0-9]+$/, '') || null;
      },
    })
    .on(`#${divId} tbody tr td.cell-fno`, textHandler('flight_no'))
    .on(`#${divId} tbody tr td.cell-orig`, textHandler('city'))
    .on(`#${divId} tbody tr td.cell-dest`, textHandler('city'))
    .on(`#${divId} tbody tr td.cell-status`, textHandler('status'))
    .on(`#${divId} tbody tr td.cell-aircraft2`, textHandler('belt_or_counter'))
    .on(`#${divId} tbody tr td.cell-counter`, textHandler('belt_or_counter'))
    .on(`#${divId} tbody tr td.cell-aircraft3`, textHandler('actual_time'))
    .on(`#${divId} tbody tr td.cell-dateTime2`, textHandler('actual_time'))
    .on(`#${divId} tbody tr td.cell-dateTime3`, textHandler('actual_time'))
    .on(`#${divId} tbody tr td.cell-aircraft`, textHandler('aircraft'))
    .on(`#${divId} tbody tr td.cell-date`, textHandler('date'));

  return { rewriter, finishRow, rows };
}

// html: متن HTML خام صفحه fids (رشته). چون HTMLRewriter روی یک Response
// کار می‌کنه، اینجا یک Response جعلی از رشته می‌سازیم و transform می‌کنیم.
async function parseFidsHtml(html) {
  const result = {
    arrivals_domestic: [],
    departures_domestic: [],
    arrivals_international: [],
    departures_international: [],
  };

  for (const [divId, [category, cityRole]] of Object.entries(TAB_MAP)) {
    const { rewriter, finishRow, rows } = parseSection(html, divId, category, cityRole);
    const res = new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    const transformed = rewriter.transform(res);
    await transformed.text(); // مصرف استریم تا همه‌ی handler ها اجرا بشن
    finishRow(); // آخرین ردیف رو هم ثبت کن
    result[category] = rows.map((r) => ({ ...r, city: (r.city || '').trim() || null }));
  }

  return result;
}

// دریافت + پارس یک فرودگاه fids با شناسه fidsId (مثلاً '2' برای مهرآباد).
// درخواست مستقیماً به fids.airport.ir نمی‌ره (چون از خارج ایران رد می‌شه)،
// بلکه از واسط لیارا (RELAY_BASE_URL) عبور می‌کنه که خودش از سمت ایران
// به fids.airport.ir وصل می‌شه.
export async function fetchFidsAirport(fidsId) {
  const targetUrl = buildFidsUrl(fidsId);
  const relayUrl = `${RELAY_BASE_URL}/proxy?url=${encodeURIComponent(targetUrl)}`;
  const res = await fetch(relayUrl);
  if (!res.ok) throw new Error(`fids relay fetch failed: ${res.status} ${relayUrl}`);
  const html = await res.text();
  const data = await parseFidsHtml(html);
  data.airport_id = fidsId;
  data.url = targetUrl;
  return data;
}

// ------------------------------------------------------------------
// نگاشت وضعیت فارسی fids -> enum شبیه aviationstack که بقیه‌ی worker.js
// از قبل باهاش کار می‌کنه (scheduled/active/landed/cancelled/delayed).
// این‌ها متن‌های واقعی سایت‌های FIDS ایرانی‌ان؛ اگر متنی جدید دیدی که
// اینجا نیست، به‌صورت 'unknown' برمی‌گرده و می‌تونی اضافه‌ش کنی.
// ------------------------------------------------------------------
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

// یک زمان ساده‌ی "HH:MM" رو با تاریخ امروز (یا date اگر بود) به فرمت
// ایزو ترکیب می‌کنه، چون worker.js فیلدهای scheduled/actual رو به شکل
// تاریخ کامل ذخیره و مقایسه می‌کنه.
function toIsoDateTime(dateStr, timeStr) {
  if (!timeStr) return '';
  const today = new Date();
  const [hh, mm] = timeStr.split(':').map((n) => parseInt(n, 10));
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), hh, mm));
  return d.toISOString();
}

// ------------------------------------------------------------------
// تبدیل خروجی fids (برای یک فرودگاه با کد myIata) به همون شکلی که
// worker.js از aviationstack انتظار داره: { data: [ {departure, arrival,
// airline, flight, flight_status}, ... ] }
// این‌طوری fetchAllFlightsForAirport و trackAirports توی worker.js
// نیازی به تغییر ساختاری ندارن — فقط منبع دیتا عوض می‌شه.
// ------------------------------------------------------------------
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
        _fids_raw_status: row.status, // برای دیباگ؛ در صورت نیاز حذفش کن
      });
    }
  }

  return { data: out };
}

// شورتکات کامل: fids را برای یک IATA بگیر و مستقیم به شکل aviationstack بده
export async function fetchAirportViaFids(iata) {
  const fidsId = IATA_TO_FIDS_ID[iata];
  if (!fidsId) throw new Error(`No fids coverage for ${iata} (use aviationstack fallback)`);
  const data = await fetchFidsAirport(fidsId);
  return fidsToAviationstackShape(data, iata);
}
