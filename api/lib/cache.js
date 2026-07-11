// lib/cache.js
// ------------------------------------------------------------------
// جایگزین ساده‌ی caches.default کلودفلر. چون دیتا فقط شب‌ها (یا با
// /api/refresh دستی) عوض می‌شه و purge صریح انجام می‌شه، این فقط یک
// لایه‌ی سرعت‌بخش داخل پردازه است، نه منبع صحتِ داده — دقیقاً همون
// نقشی که edge cache در نسخه‌ی Worker داشت.
//
// نکته: این کش فقط در حافظه‌ی همین پردازه‌ست. اگه اپ روی لیارا با چند
// instance اجرا بشه، هر instance کش جدای خودش رو داره (مشکلی نیست چون
// حداکثر چند ده KB دیتاست و هر instance آخرین نسخه رو از MongoDB
// می‌خونه؛ فقط یعنی purge روی یک instance ممکنه بقیه رو فوری خبردار
// نکنه — تا سقف max-age تعیین‌شده در setCache خودش رفرش می‌شه).
// ------------------------------------------------------------------

const store = new Map();

export function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function cacheSet(key, value, ttlSeconds) {
  store.set(key, {
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null
  });
}

export function cacheDelete(key) {
  store.delete(key);
}
