// scripts/migrate-daily-stats-key-order.mjs
// ------------------------------------------------------------------
// مهاجرت یک‌باره: کلیدهای قدیمی `daily_stats:{route}:{airline}:{date}`
// را به فرمت جدید `daily_stats:{date}:{route}:{airline}` بازنویسی می‌کند
// (بخش ۴ گزارش فنی — جلوگیری از اسکن کامل کالکشن در هر اجرای شبانه).
//
// امن برای اجرای چندباره (idempotent): اسنادی که از قبل فرمت جدید دارند
// (یعنی بخش دوم کلید تاریخ ISO است) نادیده گرفته می‌شوند.
//
// اجرا:
//   MONGODB_URI="..." node api/scripts/migrate-daily-stats-key-order.mjs
//   MONGODB_URI="..." node api/scripts/migrate-daily-stats-key-order.mjs --dry-run
//
// --dry-run فقط تعداد اسناد قابل‌مهاجرت را گزارش می‌کند، چیزی نمی‌نویسد.
// ------------------------------------------------------------------

import 'dotenv/config';
import { MongoClient } from 'mongodb';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 500;

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI تنظیم نشده.');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db('flighttrack').collection('kv');

  const cursor = col.find({ _id: { $gte: 'daily_stats:', $lt: 'daily_stats:\uffff' } });

  let scanned = 0, migrated = 0, alreadyNew = 0, malformed = 0;
  let batch = [];

  async function flushBatch() {
    if (!batch.length) return;
    if (!DRY_RUN) {
      // برای هر جفت (کلید جدید، کلید قدیمی): اول سند جدید را می‌نویسیم،
      // بعد قدیمی را حذف می‌کنیم — نه برعکس. اگر اسکریپت وسط کار قطع
      // شود، بدترین حالت این است که هر دو کلید موقتاً هم‌زمان وجود
      // داشته باشند (بی‌ضرر، چون کدِ برنامه دیگر کلید قدیمی را نمی‌خواند)
      // نه این‌که داده‌ای گم شود.
      const writes = batch.map(({ newId, doc }) => ({
        replaceOne: { filter: { _id: newId }, replacement: { ...doc, _id: newId }, upsert: true }
      }));
      await col.bulkWrite(writes, { ordered: false });
      await col.deleteMany({ _id: { $in: batch.map(b => b.oldId) } });
    }
    migrated += batch.length;
    batch = [];
  }

  for await (const doc of cursor) {
    scanned++;
    const parts = doc._id.split(':');
    if (parts.length !== 4) {
      malformed++;
      continue;
    }
    const [, p1, p2, p3] = parts;

    if (DATE_RE.test(p1)) {
      alreadyNew++;
      continue; // از قبل فرمت جدید: daily_stats:{date}:{route}:{airline}
    }
    if (!DATE_RE.test(p3)) {
      malformed++; // نه فرمت قدیمی نه جدید — دستی بررسی شود
      continue;
    }

    const [route, airline, date] = [p1, p2, p3];
    const newId = `daily_stats:${date}:${route}:${airline}`;
    batch.push({ newId, oldId: doc._id, doc: { value: doc.value, ...(doc.expiresAt ? { expiresAt: doc.expiresAt } : {}) } });

    if (batch.length >= BATCH_SIZE) await flushBatch();
  }
  await flushBatch();

  console.log(`${DRY_RUN ? '[dry-run] ' : ''}اسکن‌شده: ${scanned}`);
  console.log(`از قبل فرمت جدید: ${alreadyNew}`);
  console.log(`مهاجرت‌شده: ${migrated}`);
  if (malformed) console.log(`⚠️  فرمت ناشناخته (دستی بررسی شود): ${malformed}`);

  await client.close();
}

main().catch(err => {
  console.error('مهاجرت با خطا متوقف شد:', err);
  process.exit(1);
});
