'use strict';

// AI Day Planner: turns a free-text wish ("rainy Sunday, heritage + misal, budget") into a
// time-slotted, safety-aware itinerary. Fully offline; swap parseWish() for an LLM call if desired.
const { score, DEFAULT_WEIGHTS } = require('./scoring');
const { haversine, isNight } = require('./geo');

const INTERESTS = {
  heritage: ['heritage', 'history', 'fort', 'palace', 'temple', 'museum', 'peshwa', 'old city'],
  food: ['food', 'eat', 'misal', 'cafe', 'coffee', 'breakfast', 'lunch', 'dinner', 'snack', 'foodie', 'khau', 'vada'],
  park: ['park', 'garden', 'nature', 'hill', 'trek', 'sunrise', 'green', 'walk'],
  market: ['market', 'shopping', 'shop', 'bazaar', 'souvenir'],
  attraction: ['attraction', 'sightseeing', 'view', 'tourist', 'popular'],
};

function parseWish(text = '') {
  const t = String(text).toLowerCase();
  const interests = Object.keys(INTERESTS).filter((k) => INTERESTS[k].some((w) => t.includes(w)));
  const budget = /budget|cheap|low cost|student|affordable|free/.test(t) ? 'low' : /luxury|premium|splurge/.test(t) ? 'high' : 'mid';
  const rain = /rain|monsoon|wet|drizzle/.test(t) ? true : /no rain|dry/.test(t) ? false : null;
  const solo = /solo|alone|woman|women|girl|female/.test(t);
  const kids = /kid|child|family|parents|elder|senior/.test(t);
  let start = 9;
  let end = 20;
  const m = t.match(/(?:from|start(?:ing)?(?: at)?)\s*(\d{1,2})\s*(am|pm)?/);
  if (m) { start = Number(m[1]) % 12 + (m[2] === 'pm' ? 12 : 0); if (!m[2] && Number(m[1]) < 6) start += 12; }
  if (/morning/.test(t) && !m) { start = 7; end = 13; }
  if (/evening/.test(t) && !m) { start = 16; end = 22; }
  if (/night/.test(t) && !m) { start = 18; end = 23; }
  const stopsMatch = t.match(/(\d)\s*(?:stops|places|spots)/);
  const stops = stopsMatch ? Math.min(7, Math.max(2, Number(stopsMatch[1]))) : Math.max(3, Math.min(6, Math.round((end - start) / 2.2)));
  return { interests: interests.length ? interests : ['heritage', 'food', 'park'], budget, rain, solo, kids, start, end, stops };
}

const DWELL = { heritage: 1.5, attraction: 1.5, park: 1.25, market: 1.25, food: 1, hotel: 0 };
const MEAL = { food: [[12, 15], [19, 22], [8, 11]] };

function fitsHours(place, hour) {
  const hrs = (place.hours || '').toLowerCase();
  if (/all day|open all/.test(hrs)) return true;
  const m = hrs.match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/);
  if (!m) return true;
  const open = Number(m[1]);
  const close = Number(m[3]) <= open ? Number(m[3]) + 24 : Number(m[3]);
  return hour >= open && hour + 0.5 <= close;
}

function travelMinutes(a, b) {
  const km = haversine(a, b) / 1000 * 1.35; // road factor
  return Math.max(5, Math.round((km / 18) * 60)); // ~18 km/h urban average
}

function planDay(places, { text, zones, reports, hour, rainy, weights = DEFAULT_WEIGHTS, overrides = {} }) {
  const wish = { ...parseWish(text), ...overrides };
  const rain = wish.rain === null || wish.rain === undefined ? rainy : wish.rain;
  const startHour = wish.start;
  const chosen = [];
  let clock = startHour;
  let pos = null;
  const used = new Set();
  const stopsWanted = wish.stops;

  const enrich = (p, h) => ({ p, s: score(p, { zones, reports, ctx: { hour: Math.floor(h) % 24, rainy: rain }, weights }) });

  while (chosen.length < stopsWanted && clock < wish.end) {
    const h = clock;
    const mealSlot = (h >= 12 && h < 15) || (h >= 19 && h < 22);
    const pool = places.filter((p) => !used.has(p.id) && p.category !== 'hotel');
    let best = null;
    for (const p of pool) {
      if (!fitsHours(p, h)) continue;
      const { s } = enrich(p, h);
      let v = s.composite;
      const reasons = [];
      if (wish.interests.includes(p.category)) { v += 2.2; reasons.push(`matches your ${p.category} interest`); }
      if (p.category === 'food' && mealSlot) { v += 2.5; reasons.push('timed for a meal'); }
      if (p.category === 'food' && !mealSlot && h < 11 && h >= 7) { v += 0.8; reasons.push('good breakfast slot'); }
      if (p.category === 'food' && !mealSlot && !(h < 11)) v -= 1.5;
      if (!mealSlot && p.category !== 'food') v += 0.6;
      if (rain && p.indoor) { v += 1.6; reasons.push('indoors while it rains'); }
      if (rain && !p.indoor) v -= 1.6;
      if (wish.budget === 'low') { const aff = s.parts.affordability; v += (aff - 5) * 0.25; if (aff >= 8) reasons.push('easy on the wallet'); }
      if (wish.solo || isNight(Math.floor(h))) { v += (s.parts.safety - 6) * 0.45; if (s.parts.safety >= 8) reasons.push(`safety ${s.parts.safety}/10 at this hour`); }
      if (wish.kids) { v += (p.accessibility - 6) * 0.3; }
      if (p.id === 'sinhagad-fort' && h > 10) v -= 3; // sunrise-type outdoors penalised later in the day
      if (/sunrise/.test((p.tags || []).join(' ')) && h < 9) { v += 1.2; reasons.push('best at sunrise'); }
      const foodCount = chosen.filter((c) => c.category === 'food').length;
      const foodCap = wish.interests.length === 1 && wish.interests[0] === 'food' ? 4 : 2;
      if (p.category === 'food' && foodCount >= foodCap) continue;
      const last = chosen[chosen.length - 1];
      if (last && last.category === p.category) v -= 2.5; // keep the day varied
      let travel = 0;
      if (pos) {
        travel = travelMinutes(pos, p);
        v -= travel / 22; // prefer a compact route
        if (travel > 45) v -= 2;
      }
      if (!best || v > best.v) best = { p, v, s, reasons, travel };
    }
    if (!best) break;
    const arrive = clock + best.travel / 60;
    const dwell = DWELL[best.p.category] ?? 1;
    chosen.push({
      id: best.p.id, name: best.p.name, category: best.p.category, lat: best.p.lat, lng: best.p.lng,
      arrive: round2(arrive), leave: round2(arrive + dwell), travelMin: best.travel,
      priceLabel: best.p.priceLabel, composite: best.s.composite, safety: best.s.parts.safety,
      why: best.reasons.length ? best.reasons : ['strong all-round score'],
      caution: best.s.livePenalty > 1.5 ? 'Active risk nearby. Stay alert and keep to main roads.' : null,
    });
    used.add(best.p.id);
    pos = best.p;
    clock = arrive + dwell;
  }
  const km = chosen.reduce((sum, s, i) => (i ? sum + haversine(chosen[i - 1], s) / 1000 * 1.35 : 0), 0);
  const avgSafety = chosen.length ? Number((chosen.reduce((a, s) => a + s.safety, 0) / chosen.length).toFixed(1)) : 0;
  return { wish: { ...wish, rain }, stops: chosen, summary: { stops: chosen.length, distanceKm: Number(km.toFixed(1)), avgSafety, ends: chosen.length ? chosen[chosen.length - 1].leave : startHour } };
}

const round2 = (n) => Math.round(n * 100) / 100;

module.exports = { parseWish, planDay };
