// lib/ikac-scraper.js
// ------------------------------------------------------------------
// اسکرپر فرودگاه امام خمینی (IKA) — بر خلاف بقیه‌ی فرودگاه‌ها که از
// fids.airport.ir می‌خونن، IKA پورتال جدا داره (ikac.ir، پلتفرم دورتال).
// این پورتال یک endpoint AJAX داره که یه رشته‌ی «شبه‌JS» برمی‌گردونه
// (نه JSON خالص): پاسخ یک آبجکت {data, itemsCount} هست که data خودش
// یه تگ <script> رشته‌ایه و وقتی توی مرورگر اجرا بشه window.flightsJSON
// رو می‌سازه. اینجا به‌جای اجرا کردن توی DOM، همون رشته رو با یک
// Function() ایزوله شده parse می‌کنیم — دقیقاً همون کاری که مرورگر
// می‌کرد، ولی بدون بقیه‌ی side effectهای صفحه.
//
// ⚠️ نکته‌ی مهم: ساختار دقیق فیلدهای هر پرواز (arrivals/departures) از
// روی چند اسکرین‌شات جزئی از DevTools موبایل بازسازی شده، نه یک دامپ
// کامل JSON. فیلدهای دیده‌شده: id, terminal, flight_status,
// flight_number, iata_code, airline, airport, scheduled_time,
// actual_date, remark, dispatch_status. فیلد «ساعت واقعی» (actual_time)
// و کد آی‌آتای مستقیم ایرلاین دیده نشدن — این‌ها با حدس محافظه‌کارانه
// (regex روی iata_code) پر می‌شن. بعد از اولین اجرای واقعی، حتماً باید
// چند نمونه‌ی خام رو (مثلاً با یک لاگ موقت) چک کرد و این مپینگ رو
// تصحیح کرد.
// ------------------------------------------------------------------

import { CITY_NAME_TO_IATA } from './fids-scraper.js';

const IKAC_RENDER_URL =
  'https://www.ikac.ir/fa-ir/airport.ikac/5257/16027/Modules/ModuleViewer/Render';

const IKAC_ORIGIN = 'https://www.ikac.ir';
const IKAC_REFERER =
  'https://www.ikac.ir/fa-IR/airport.ikac/5257/page/%D9%84%DB%8C%D8%B3%D8%AA-%D9%BE%D8%B1%D9%88%D8%A7%D8%B2-%D9%87%D8%A7';

// اگه از بیرون ایران هندشیک تمیز نده (مثل fids.airport.ir)، از همون
// relay فعلی (روی لیارا، لوکیشن ایران) عبور می‌کنیم. اگه relay لازم
// نبود، این env ست نشه و مستقیم فچ می‌کنیم.
const IKAC_RELAY_URL = process.env.IKAC_RELAY_URL || process.env.FIDS_RELAY_URL || '';

async function fetchRaw(terminal, date) {
  const qs = new URLSearchParams({ lang: 'fa', terminal: terminal || '', date: date || '' });
  const targetUrl = `${IKAC_RENDER_URL}?${qs.toString()}`;

  const url = IKAC_RELAY_URL
    ? `${IKAC_RELAY_URL.replace(/\/$/, '')}/proxy?url=${encodeURIComponent(targetUrl)}`
    : targetUrl;

  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Referer': IKAC_REFERER,
      'Origin': IKAC_ORIGIN,
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    },
  });

  if (!res.ok) {
    throw new Error(`ikac render fetch failed: HTTP ${res.status}`);
  }

  return res.json(); // { data: "<script>...window.flightsJSON = {...};...</script>", itemsCount }
}

// توی رشته‌ی data، اولین `{` بعد از "window.flightsJSON" رو پیدا می‌کنه
// و با شمارش براکت‌ها (با احترام به رشته‌های تک/دابل‌کوتیشن) تا `}`ی
// متناظرش جلو می‌ره. برخلاف یک رجکس حریصانه/تنبل ساده، با آبجکت‌های
// تودرتو هم درست کار می‌کنه.
function extractBalancedObjectLiteral(src, anchor) {
  const anchorIdx = src.indexOf(anchor);
  if (anchorIdx === -1) return null;

  const braceStart = src.indexOf('{', anchorIdx);
  if (braceStart === -1) return null;

  let depth = 0;
  let inString = null; // "'" یا '"' وقتی داخل یک رشته‌ایم، وگرنه null
  let escaped = false;

  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      inString = ch;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return src.slice(braceStart, i + 1);
      }
    }
  }

  return null; // آبجکت هیچ‌وقت بسته نشد — یعنی فرمت عوض شده
}

// literal رو (که سینتکس آبجکت JS خامه، نه JSON استاندارد: کلیدهای
// بدون کوتیشن، مقادیر تک‌کوتیشن‌دار) با یک Function ایزوله eval می‌کنه.
// این همون رفتاریه که مرورگر با append کردن <script> انجام می‌داد؛
// اینجا فقط بدون DOM انجامش می‌دیم. چون منبع یک پورتال دولتی شناخته‌شده‌ست
// (نه ورودی کاربر)، ریسک پایینه، ولی اگه لازم شد می‌شه بعداً با یک
// پارسر امن‌تر (مثل json5) جایگزینش کرد.
function evalObjectLiteral(literal) {
  // eslint-disable-next-line no-new-func
  const fn = new Function(`"use strict"; return (${literal});`);
  return fn();
}

export function parseFlightsJSON(dataString) {
  if (!dataString || typeof dataString !== 'string') return { arrivals: [], departures: [] };

  const literal = extractBalancedObjectLiteral(dataString, 'flightsJSON');
  if (!literal) return { arrivals: [], departures: [] };

  try {
    const obj = evalObjectLiteral(literal);
    return {
      arrivals: Array.isArray(obj?.arrivals) ? obj.arrivals : [],
      departures: Array.isArray(obj?.departures) ? obj.departures : [],
    };
  } catch (err) {
    // اگه ساختار عوض شده باشه (مثلاً دیگه اسمش flightsJSON نیست)، به‌جای
    // crash کل fetch، خالی برمی‌گردونیم — trackAirports این فرودگاه رو
    // 'ok' با ۰ پرواز ثبت می‌کنه، نه 'error'.
    return { arrivals: [], departures: [] };
  }
}

// -------------------------- نگاشت وضعیت --------------------------
// flight_status انگلیسیه (تا الان فقط 'Closed' دیده شده). dispatch_status
// فارسیه و سیگنال تاخیر رو می‌ده ('تاخیر دارد'). چون بازه‌ی مقادیر
// ممکن این دو فیلد کامل معلوم نیست، اول dispatch_status چک می‌شه
// (سیگنال قوی‌تره)، بعد flight_status به‌عنوان fallback.
const DISPATCH_STATUS_MAP = [
  [/لغو/, 'cancelled'],
  [/نشست|فرود/, 'landed'],
  [/تاخیر|تأخیر/, 'delayed'],
  [/پرواز\s*کرد|برخاست/, 'active'],
  [/طبق برنامه|به موقع|به‌موقع/, 'scheduled'],
];

const FLIGHT_STATUS_MAP = [
  [/closed/i, 'gate_closed'],
  [/cancel/i, 'cancelled'],
  [/land/i, 'landed'],
  [/depart|active|airborne/i, 'active'],
  [/board|checkin|check-in/i, 'checkin'],
  [/delay/i, 'delayed'],
  [/schedul/i, 'scheduled'],
];

function mapStatus(dispatchStatus, flightStatus) {
  const dispatchClean = (dispatchStatus || '').trim();
  for (const [re, mapped] of DISPATCH_STATUS_MAP) {
    if (re.test(dispatchClean)) return mapped;
  }
  const flightClean = (flightStatus || '').trim();
  for (const [re, mapped] of FLIGHT_STATUS_MAP) {
    if (re.test(flightClean)) return mapped;
  }
  return 'unknown';
}

// دو تا فیلد جدا داریم که هر دو «کد+شماره‌ی پرواز» به‌نظر می‌رسن ولی
// قرارداد متفاوتی دارن: iata_code استاندارد IATAه (کد ایرلاین همیشه
// دقیقاً ۲ کاراکتره، مثلاً 'W5' برای ماهان یا 'RV' برای کاسپین)، در
// حالی که flight_number شبیه فرمت ICAOه (کد ایرلاین ۳ حرفیه، مثلاً
// 'IRM' یا 'CPN'). یک regex حریص روی هر دو اشتباه می‌کرد (مثلاً
// 'W5115' رو 'W51' می‌خوند). این‌جا هر کدوم قاعده‌ی خودش رو داره.
// TODO: بعد از دیدن نمونه‌ی واقعی بیشتر، این حدس‌ها رو تأیید/تصحیح کن.
function extractIataAirlineCode(iataCode) {
  if (!iataCode) return '';
  const m = String(iataCode).match(/^([A-Za-z0-9]{2})\d+/);
  return m ? m[1].toUpperCase() : '';
}

function extractIcaoAirlineCode(flightNumber) {
  if (!flightNumber) return '';
  const m = String(flightNumber).match(/^([A-Za-z]{3})\d+/);
  return m ? m[1].toUpperCase() : '';
}

const TEHRAN_OFFSET_MS = 3.5 * 3600 * 1000;

// scheduled_time فقط ساعته ('23:00:00')؛ actual_date تاریخ میلادیه
// ('2026-07-12'). این دو رو با هم ترکیب می‌کنیم تا ISO بسازیم.
function isoFromDateAndTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return '';
  const dateMatch = String(dateStr).match(/(\d{4})-(\d{2})-(\d{2})/);
  const timeMatch = String(timeStr).match(/(\d{1,2}):(\d{2})/);
  if (!dateMatch || !timeMatch) return '';
  const [, y, mo, d] = dateMatch;
  const [, hh, mm] = timeMatch;
  const utcMillis = Date.UTC(+y, +mo - 1, +d, +hh, +mm) - TEHRAN_OFFSET_MS;
  return new Date(utcMillis).toISOString();
}

// خروجی رو دقیقاً هم‌شکل با fidsToAviationstackShape می‌سازیم تا
// logCompletedFlights توی flights.js بدون تغییر کار کنه.
export function ikacToAviationstackShape(flightsJSON) {
  const out = [];

  for (const isArrival of [true, false]) {
    const rows = isArrival ? flightsJSON.arrivals : flightsJSON.departures;
    for (const row of rows || []) {
      const scheduledIso = isoFromDateAndTime(row.actual_date, row.scheduled_time);
      // actual_time هنوز تأیید نشده — اگه فیلدش وجود داشته باشه با یکی
      // از این اسم‌های محتمل امتحان می‌کنیم، وگرنه actual خالی می‌مونه
      // (یعنی این پرواز فقط با کنسلی/status وارد آمار می‌شه، نه تاخیر دقیقه‌ای).
      const actualTimeRaw = row.actual_time || row.real_time || row.actualTime || '';
      const actualIso = actualTimeRaw ? isoFromDateAndTime(row.actual_date, actualTimeRaw) : '';
      const delayMinutes = scheduledIso && actualIso
        ? Math.round((new Date(actualIso) - new Date(scheduledIso)) / 60000)
        : null;

      const status = mapStatus(row.dispatch_status, row.flight_status);
      const flightIata = row.iata_code || row.flight_number || '';
      const airlineIataCode = extractIataAirlineCode(row.iata_code);
      const airlineIcaoCode = extractIcaoAirlineCode(row.flight_number);

      const known = { iata: 'IKA', scheduled: scheduledIso, estimated: '', actual: actualIso, delay: delayMinutes };
      // مقصد/مبدأ طرف دیگه فقط اسم شهر فارسیه (row.airport). از همون
      // نگاشت مشترک CITY_NAME_TO_IATA (fids-scraper.js) استفاده می‌کنیم؛
      // اگه شهر توی نگاشت نبود، به‌جای خالی گذاشتن (که باعث حذف کامل
      // پرواز توی logCompletedFlights می‌شه چون arr_iata لازمه)، خودِ
      // اسم فارسی رو به‌عنوان کد موقت می‌ذاریم — دقیقاً رفتار fallback
      // فعلی پروژه برای شهرهای نگاشت‌نشده.
      const otherAirportName = (row.airport || '').trim();
      const otherIata = CITY_NAME_TO_IATA[otherAirportName] || otherAirportName;
      const unknown = { iata: otherIata, scheduled: '', estimated: '', actual: '', delay: null };

      out.push({
        flight: { iata: flightIata, icao: '' },
        airline: { name: row.airline || 'Unknown', iata: airlineIataCode, icao: airlineIcaoCode },
        departure: isArrival ? unknown : known,
        arrival: isArrival ? known : unknown,
        flight_status: status,
        _ikac_raw_status: { flight_status: row.flight_status, dispatch_status: row.dispatch_status },
        _ikac_other_airport_name: otherAirportName,
        _ikac_terminal: row.terminal || '',
      });
    }
  }

  return { data: out };
}

export async function fetchAirportViaIkac(terminal = '', date = '') {
  const raw = await fetchRaw(terminal, date);
  const flightsJSON = parseFlightsJSON(raw.data);
  return ikacToAviationstackShape(flightsJSON);
}
