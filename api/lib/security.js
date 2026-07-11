// lib/security.js
// ------------------------------------------------------------------
// کمک‌تابع‌های امنیتی مشترک بین server.js و admin.js.
// ------------------------------------------------------------------

import { timingSafeEqual } from 'crypto';

// مقایسه‌ی توکن ادمین/رفرش با secret، به‌صورت timing-safe (بخش ۱۲ گزارش
// فنی). مقایسه‌ی معمولی با `!==` رشته‌به‌رشته و به‌محض اولین کاراکترِ
// نامنطبق متوقف می‌شه؛ یعنی زمان اجرا به تعداد کاراکترهای درستِ حدس‌زده‌شده
// از ابتدا بستگی داره و نظری (هرچند در عمل با این ریسک پایین) می‌تونه
// یک secret رو کاراکتر به کاراکتر با اندازه‌گیری زمان پاسخ حدس زد.
// timingSafeEqual همیشه کل بافر رو مقایسه می‌کنه، صرف‌نظر از این‌که کجا
// اولین تفاوت پیدا می‌شه.
//
// timingSafeEqual اگه طول دو بافر برابر نباشه throw می‌کنه (نه false)،
// پس اول طول رو چک می‌کنیم — این چک خودش timing-safe نیست، ولی طول یک
// توکن که از URL query گرفته شده اطلاعات حساسی لو نمی‌ده (برخلاف محتوای
// خودش).
export function safeTokenEqual(provided, secret) {
  if (typeof provided !== 'string' || typeof secret !== 'string') return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
