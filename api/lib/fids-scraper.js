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
import { kv } from './kv.js';

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
  // ۷ فرودگاه تازه — آی‌دی‌های واقعی fids.airport.ir تأیید شده با وب‌سرچ:
  '202': ['اطلاعات-پرواز-فرودگاه-گرگان', 'فرودگاه گرگان'],
  '112': ['اطلاعات-پرواز-فرودگاه-همدان', 'فرودگاه همدان'],
  '402': ['اطلاعات-پرواز-فرودگاه-سنندج', 'فرودگاه سنندج'],
  '204': ['اطلاعات-پرواز-فرودگاه-بيرجند', 'فرودگاه بیرجند'],
  '501': ['اطلاعات-پرواز-فرودگاه-زنجان', 'فرودگاه زنجان'],
  '601': ['اطلاعات-پرواز-فرودگاه-لارستان', 'فرودگاه لارستان'],
  '701': ['اطلاعات-پرواز-فرودگاه-خرم-آباد', 'فرودگاه خرم‌آباد'],
};

export const IATA_TO_FIDS_ID = {
  THR: '2', MHD: '102', SYZ: '1', TBZ: '103', IFN: '114', AWZ: '401',
  BND: '117', BUZ: '104', KER: '201', SRY: '106', AZD: '107', KSH: '111',
  OMH: '110', RAS: '203', ZAH: '109', ABD: '301', ADU: '113',
  GBT: '202', HDM: '112', SDG: '402', XBJ: '204', JWN: '501', LRR: '601', KHD: '701',
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
  'گرگان': 'GBT',
  'همدان': 'HDM',
  'سنندج': 'SDG',
  'بيرجند': 'XBJ', 'بیرجند': 'XBJ',
  'زنجان': 'JWN',
  'لارستان': 'LRR',
  'خرم آباد': 'KHD', 'خرم‌آباد': 'KHD',

  // مقاصد بین‌المللی پرتردد از فرودگاه‌های ایران (چارتر/برنامه‌ای).
  // ⚠️ نگارش دقیق این اسامی روی fids.airport.ir تایید نشده (بخش ۱۰ گزارش
  // فنی) — چون به HTML زنده‌ی سایت دسترسی مستقیم نداریم. این‌ها بر پایه‌ی
  // رایج‌ترین املای فارسیِ این مقاصدند؛ باید با چند نمونه‌ی واقعی از
  // fids.airport.ir تطبیق داده بشن (رجوع کنید به بخش «نگاشت‌نشده‌ها» زیر).
  'استانبول': 'IST', 'استانبول (صبیحه)': 'SAW',
  'دبی': 'DXB', 'دوبی': 'DXB',
  'شارجه': 'SHJ',
  'ابوظبی': 'AUH',
  'مسقط': 'MCT',
  'کویت': 'KWI',
  'دوحه': 'DOH',
  'بغداد': 'BGW',
  'نجف': 'NJF',
  'کربلا': 'IQA',
  'اربیل': 'EBL',
  'دمشق': 'DAM',
  'بیروت': 'BEY',
  'باکو': 'GYD',
  'ایروان': 'EVN',
  'تفلیس': 'TBS',
  'مسکو': 'SVO', 'مسکو (دوموددوو)': 'DME',
  'استانبول ترکیه': 'IST',
  'آنکارا': 'ESB',
  'آنتالیا': 'AYT',
  'جده': 'JED',
  'مدینه': 'MED',
  'دهلی': 'DEL', 'دهلی نو': 'DEL',
  'بمبئی': 'BOM', 'مومبای': 'BOM',
  'بانکوک': 'BKK',
  'کوالالامپور': 'KUL',
  'گوانگژو': 'CAN',
};

// وقتی نام شهری در CITY_NAME_TO_IATA پیدا نشه، برای این‌که خاموش گم نشه
// (بخش ۶ گزارش فنی: قبلاً متن خام فارسی جای کد سه‌حرفی در `route` می‌نشست
// و مسیر یکسان زیر چند کلید متفاوت پخش می‌شد)، شمارنده‌ش رو در یک کلید
// جدا نگه می‌داریم تا در پنل ادمین یا با یک کوئری دستی مشخص بشه کدوم
// شهرها باید به دیکشنری اضافه بشن. این fire-and-forget (بدون await در
// نقطه‌ی فراخوانی) عمداً برای این‌که لاجیک لاگ‌کردن هیچ‌وقت مسیر اصلی
// پردازش داده رو کند یا بلاک نکنه؛ خطای احتمالی‌ش بی‌صدا بلعیده می‌شه.
async function logUnmappedCity(clean) {
  try {
    const key = `unmapped_city:${clean}`;
    const raw = await kv.get(key);
    const count = raw ? (parseInt(raw, 10) || 0) + 1 : 1;
    await kv.put(key, String(count));
  } catch {
    // لاگ‌کردن نباید هیچ‌وقت پایپ‌لاین اصلی داده رو بشکنه.
  }
}

function cityToCode(cityRaw) {
  if (!cityRaw) return '';
  const clean = cityRaw.trim();
  const mapped = CITY_NAME_TO_IATA[clean];
  if (mapped) return mapped;
  logUnmappedCity(clean); // fire-and-forget — نتیجه‌ش الان لازم نیست
  return clean;
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
  [/طبق برنامه|به موقع|به‌موقع/, 'scheduled'],
  [/منتظر اعلام|در حال بررسی/, 'scheduled'],
  // «پرواز کرد» ممکنه با یا بدون فاصله بیاد (روی fids.airport.ir معمولاً
  // بدون فاصله چسبیده‌ست: «پروازکرد»). قبلاً \s الزامی نبود پس این حالت
  // اصلاً match نمی‌شد و همه‌ی پروازهای پرواز‌کرده 'unknown' می‌موندن.
  [/پرواز\s*کرد|اقلاع\s*کرد|برخاست/, 'active'],
];

function mapStatus(raw) {
  if (!raw) return 'unknown';
  const clean = raw.trim();
  for (const [re, mapped] of STATUS_MAP) {
    if (re.test(clean)) return mapped;
  }
  return 'unknown';
}

const TEHRAN_OFFSET_MS = 3.5 * 3600 * 1000; // UTC+3:30 — ایران DST نداره، این آفست ثابته

// نگاشت اسم فارسی روز هفته -> Date.getUTCDay() (۰=یکشنبه ... ۶=شنبه)
const FA_WEEKDAY_TO_JS_DAY = {
  'یکشنبه': 0, 'دوشنبه': 1, 'سه‌شنبه': 2, 'سه شنبه': 2,
  'چهارشنبه': 3, 'پنجشنبه': 4, 'جمعه': 5, 'شنبه': 6,
};

// fids.airport.ir یک پنجره‌ی چندروزه (دیروز/امروز/فردا/...) رو با هم
// نشون می‌ده، نه فقط امروز. قبلاً روز هفته‌ی اسکرپ‌شده (weekday) کلاً
// دور ریخته می‌شد و همه‌ی ردیف‌ها با تاریخ «امروزِ سرور» ثبت می‌شدن —
// همین باعث می‌شد پروازهای یکشنبه/دوشنبه و... هم زیر تاریخ شنبه بیفتن
// و برای یک شماره پرواز چند ساعت متفاوت و متناقض ثبت بشه.
// اینجا نزدیک‌ترین روز تقویمی (بین ۳ روز قبل تا ۳ روز بعد از امروزِ
// تهران) که با weekdayFa می‌خونه رو پیدا می‌کنیم.
function resolveTehranDateParts(weekdayFa) {
  const nowTehran = new Date(Date.now() + TEHRAN_OFFSET_MS);
  const todayMidnight = Date.UTC(nowTehran.getUTCFullYear(), nowTehran.getUTCMonth(), nowTehran.getUTCDate());

  const targetJsDay = weekdayFa ? FA_WEEKDAY_TO_JS_DAY[weekdayFa.trim()] : undefined;
  if (targetJsDay === undefined) {
    const t = new Date(todayMidnight);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
  }

  let bestOffset = 0;
  let bestDiff = Infinity;
  for (let offset = -3; offset <= 3; offset++) {
    const candidate = new Date(todayMidnight + offset * 86400000);
    if (candidate.getUTCDay() === targetJsDay && Math.abs(offset) < bestDiff) {
      bestDiff = Math.abs(offset);
      bestOffset = offset;
    }
  }
  const chosen = new Date(todayMidnight + bestOffset * 86400000);
  return { y: chosen.getUTCFullYear(), m: chosen.getUTCMonth(), d: chosen.getUTCDate() };
}

function isoFromDateParts(y, m, d, timeStr) {
  if (!timeStr) return '';
  const [hh, mm] = timeStr.split(':').map(n => parseInt(n, 10));
  // hh:mm روی fids.airport.ir ساعتِ محلیِ تهران‌ه، نه UTC؛ برای UTC واقعی
  // باید ۳:۳۰ ساعت کم بشه.
  const utcMillis = Date.UTC(y, m, d, hh, mm) - TEHRAN_OFFSET_MS;
  return new Date(utcMillis).toISOString();
}

// تاخیر واقعی رو از فاصله‌ی «ساعت واقعی» تا «ساعت برنامه‌ای» حساب می‌کنیم.
// قبلاً این مقدار همیشه null بود، پس دیگه هیچ پروازی توی داشبورد
// 'delayed' حساب نمی‌شد و همه (جز لغوشده‌ها) پیش‌فرض «به‌موقع» می‌افتادن.
function computeDelayMinutes(scheduledIso, actualIso) {
  if (!scheduledIso || !actualIso) return null;
  const sched = new Date(scheduledIso).getTime();
  const act = new Date(actualIso).getTime();
  if (isNaN(sched) || isNaN(act)) return null;
  return Math.round((act - sched) / 60000);
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
      const { y, m, d } = resolveTehranDateParts(row.weekday);
      const scheduledIso = isoFromDateParts(y, m, d, row.scheduled_time);
      const actualIso = row.actual_time && /\d{1,2}:\d{2}/.test(row.actual_time)
        ? isoFromDateParts(y, m, d, row.actual_time.match(/\d{1,2}:\d{2}/)[0])
        : '';
      const delayMinutes = computeDelayMinutes(scheduledIso, actualIso);

      const dep = isArrival
        ? { iata: otherIata, scheduled: scheduledIso, estimated: '', actual: actualIso, delay: null }
        : { iata: myIata, scheduled: scheduledIso, estimated: '', actual: actualIso, delay: delayMinutes };
      const arr = isArrival
        ? { iata: myIata, scheduled: scheduledIso, estimated: '', actual: actualIso, delay: delayMinutes }
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
