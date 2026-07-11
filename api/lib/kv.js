// lib/kv.js
// ------------------------------------------------------------------
// جایگزین Cloudflare KV با MongoDB (لیارا). همون رابط get/put/delete/list
// رو پیاده می‌کنه که worker.js قبلاً با env.FLIGHTS_KV صداش می‌زد، تا
// منطق کسب‌وکار (trackAirports, aggregateDailyStats, ...) تقریباً بدون
// تغییر پورت بشه.
//
// طراحی: یک کالکشن تخت به اسم "kv" با شکل { _id: key, value: string,
// expiresAt?: Date }. کوئری‌های prefix با رنج روی _id (که ایندکس پیش‌فرض
// مونگو روشه) انجام می‌شن: { _id: { $gte: prefix, $lt: prefix+'\uffff' } }.
// انقضای خودکار (معادل expirationTtl کلودفلر) با TTL index روی expiresAt
// انجام می‌شه؛ سندهایی که expiresAt ندارن هیچ‌وقت منقضی نمی‌شن (دقیقاً
// همون رفتاری که برای کلیدهای دائمی مثل flight_log:* لازم داریم).
// ------------------------------------------------------------------

import { MongoClient } from 'mongodb';

let client = null;
let col = null;

export async function initKv(uri, dbName = 'flighttrack') {
  if (!uri) {
    throw new Error('MONGODB_URI تنظیم نشده — این متغیر محیطی رو در لیارا اضافه کن');
  }
  client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  col = db.collection('kv');

  // TTL index: مونگو هر دقیقه یک بار سندهای منقضی‌شده رو خودکار پاک می‌کنه.
  // expireAfterSeconds: 0 یعنی "دقیقاً در لحظه‌ی مقدار expiresAt پاک کن".
  await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  return kv;
}

export const kv = {
  async get(key) {
    const doc = await col.findOne({ _id: key }, { projection: { value: 1 } });
    return doc ? doc.value : null;
  },

  async put(key, value, opts = {}) {
    const doc = { _id: key, value };
    if (opts.expirationTtl) {
      doc.expiresAt = new Date(Date.now() + opts.expirationTtl * 1000);
    }
    await col.replaceOne({ _id: key }, doc, { upsert: true });
  },

  async delete(key) {
    await col.deleteOne({ _id: key });
  },

  // معادل ساده‌شده‌ی KV.list({prefix, cursor}). چون حجم داده‌ی این پروژه
  // (چند ده هزار سند در بدترین حالت) برای مونگو ناچیزه، برخلاف نسخه‌ی
  // کلودفلر نیازی به صفحه‌بندی واقعی نیست — همیشه list_complete:true و
  // cursor:undefined برمی‌گردونه، و کدهای فراخوان (که با
  // do { ... } while(cursor) نوشته شدن) بدون تغییر کار می‌کنن.
  //
  // gte/lt (اختیاری): برای کلیدهایی که با یک بخش قابل‌مرتب‌سازی (مثل
  // تاریخ ISO) شروع می‌شن، امکان یک range query واقعی روی _id می‌ده —
  // نه فقط تطبیق prefix ثابت. وقتی داده شن، جایگزین prefix می‌شن (نه
  // ترکیب باهاش)، چون خودشون از قبل بازه‌ی کامل رو مشخص می‌کنن.
  // مثال: kv.list({ gte: 'daily_stats:2026-06-26', lt: 'daily_stats:2026-07-11' })
  // فقط اسنادی با تاریخ در این بازه رو می‌گیره، بدون خوندن کل کالکشن.
  async list({ prefix = '', cursor, gte, lt } = {}) {
    let query;
    if (gte !== undefined || lt !== undefined) {
      const range = {};
      if (gte !== undefined) range.$gte = gte;
      if (lt !== undefined) range.$lt = lt;
      query = { _id: range };
    } else {
      query = prefix ? { _id: { $gte: prefix, $lt: prefix + '\uffff' } } : {};
    }
    const docs = await col.find(query).project({ _id: 1 }).toArray();
    return {
      keys: docs.map(d => ({ name: d._id })),
      list_complete: true,
      cursor: undefined
    };
  }
};

export async function closeKv() {
  if (client) await client.close();
}
