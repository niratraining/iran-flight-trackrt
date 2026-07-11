// این کل تابع fetchAllFlightsForAirport رو در worker.js با این جایگزین کن
// (خط 354 تا 387 در فایل فعلی شما).

async function fetchAllFlightsForAirportAviationstack(env, airport) {
  let offset = 0;
  let combined = [];
  let callsUsed = 0;
  let lastKeyIndex = null;

  for (let page = 0; page < MAX_PAGES_PER_AIRPORT; page++) {
    const picked = await selectApiKey(env);
    if (!picked) {
      if (combined.length === 0) throw new Error('no API key configured');
      break; // ran out of keys mid-pagination: return what we have so far
    }

    const apiUrl = `http://api.aviationstack.com/v1/flights?access_key=${picked.key}&dep_iata=${airport}&limit=${AVIATIONSTACK_PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(apiUrl);
    const json = await res.json();
    await incrementKeyUsage(env, picked.index);
    callsUsed++;
    lastKeyIndex = picked.index;

    const pageData = json.data || [];
    combined = combined.concat(pageData);

    const pagination = json.pagination;
    const total = pagination ? pagination.total : pageData.length;
    offset += pageData.length;

    if (pageData.length < AVIATIONSTACK_PAGE_SIZE || offset >= total) break;
  }

  return { data: combined, calls_used: callsUsed, key_used: lastKeyIndex };
}

// نقطه‌ی ورودی جدید: اول FIDS رایگان رو امتحان می‌کنه (برای فرودگاه‌هایی
// که fids.airport.ir پوشش می‌ده — یعنی IATA_TO_FIDS_ID داره)، و فقط برای
// بقیه (فعلاً IKA / KIH / ZBR) یا در صورت خطای FIDS، به aviationstack
// برمی‌گرده. یعنی مصرف کوئوتای پولی aviationstack از ۲۰ فرودگاه به ۳ تا
// (یا کمتر، در صورت خطای موقت) کاهش پیدا می‌کنه.
async function fetchAllFlightsForAirport(env, airport) {
  if (IATA_TO_FIDS_ID[airport]) {
    try {
      const json = await fetchAirportViaFids(airport);
      return { data: json.data, calls_used: 0, key_used: null, source: 'fids' };
    } catch (err) {
      console.log(`FIDS failed for ${airport}, falling back to aviationstack: ${err}`);
      // ادامه می‌ره سراغ aviationstack پایین
    }
  }
  const result = await fetchAllFlightsForAirportAviationstack(env, airport);
  return { ...result, source: 'aviationstack' };
}
