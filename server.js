'use strict';

const express = require('express');
const path = require('path');

const places = require('./data/places.json');
const zones = require('./data/zones.json');
const traditions = require('./data/traditions.json');
const reportsLib = require('./lib/reports');
const { analyze, CATEGORIES } = require('./lib/nlp');
const { score, normalizeWeights, DEFAULT_WEIGHTS } = require('./lib/scoring');
const { getWeather } = require('./lib/weather');
const { getTraffic } = require('./lib/traffic');
const { getRoutes } = require('./lib/routing');
const { haversine, istHour, istWeekday, isNight } = require('./lib/geo');
const { zonePenalty } = require('./lib/risk');
const seed = require('./lib/seed');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'data', 'uploads')));

const social = seed.buildSocial();

// ---------- helpers ----------
async function context(req) {
  const weather = await getWeather();
  const hourQ = req.query.hour !== undefined ? Number(req.query.hour) : NaN;
  const hour = Number.isFinite(hourQ) ? ((hourQ % 24) + 24) % 24 : istHour();
  const rainQ = req.query.rain;
  const rainy = rainQ === undefined ? weather.rainy : rainQ === '1' || rainQ === 'true';
  return { ctx: { hour, rainy }, weather };
}

function withScores(list, { zonesArr, reports, ctx, weights }) {
  return list.map((p) => ({ ...p, scores: score(p, { zones: zonesArr, reports, ctx, weights }) }));
}

function socialPulse() {
  const items = social.map((s) => {
    const a = analyze(s.text);
    let nearest = null;
    let best = 600;
    for (const p of places) {
      const d = haversine(s, p);
      if (d < best) { best = d; nearest = p; }
    }
    return { ...s, sentiment: a.sentiment, category: a.category, placeId: nearest ? nearest.id : null, placeName: nearest ? nearest.name : null };
  });
  const byPlace = {};
  items.forEach((i) => {
    if (!i.placeId) return;
    (byPlace[i.placeId] ||= { placeId: i.placeId, name: i.placeName, n: 0, sum: 0 });
    byPlace[i.placeId].n += 1;
    byPlace[i.placeId].sum += i.sentiment;
  });
  const mood = Object.values(byPlace)
    .map((m) => ({ placeId: m.placeId, name: m.name, posts: m.n, sentiment: Number((m.sum / m.n).toFixed(2)) }))
    .sort((a, b) => b.sentiment - a.sentiment);
  const overall = items.length ? Number((items.reduce((s, i) => s + i.sentiment, 0) / items.length).toFixed(2)) : 0;
  return { overall, mood, items: items.sort((a, b) => b.ts - a.ts) };
}

// ---------- API ----------
app.get('/api/meta', (req, res) => {
  res.json({
    city: 'Pune',
    center: { lat: 18.5204, lng: 73.8567 },
    categories: ['food', 'hotel', 'heritage', 'attraction', 'market', 'park'],
    reportCategories: Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label, icon: c.icon })),
    weights: DEFAULT_WEIGHTS,
  });
});

app.get('/api/places', async (req, res) => {
  const { ctx } = await context(req);
  const reports = reportsLib.list({ activeOnly: true });
  const weights = normalizeWeights(req.query.weights ? safeJson(req.query.weights) : null);
  let list = withScores(places, { zonesArr: zones, reports, ctx, weights });

  const { category, q, budget, indoor, sort } = req.query;
  if (category && category !== 'all') list = list.filter((p) => p.category === category);
  if (q) {
    const needle = String(q).toLowerCase();
    list = list.filter((p) => (p.name + ' ' + p.tags.join(' ') + ' ' + p.blurb).toLowerCase().includes(needle));
  }
  if (budget === '1') list = list.filter((p) => p.scores.parts.affordability >= 7);
  if (indoor === '1') list = list.filter((p) => p.indoor);

  const sorters = {
    score: (a, b) => b.scores.composite - a.scores.composite,
    rating: (a, b) => b.rating - a.rating,
    price: (a, b) => a.price - b.price,
    safety: (a, b) => b.scores.parts.safety - a.scores.parts.safety,
  };
  list.sort(sorters[sort] || sorters.score);
  res.json({ context: ctx, count: list.length, places: list });
});

app.get('/api/places/:id', async (req, res) => {
  const p = places.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Place not found' });
  const { ctx } = await context(req);
  const reports = reportsLib.list({ activeOnly: true });
  const nearbyReports = reports.filter((r) => haversine(r, p) <= 500 && r.category !== 'other').slice(0, 5);
  const nearbyZones = zones
    .map((z) => ({ id: z.id, name: z.name, type: z.type, note: z.note, distance: Math.round(haversine(z, p)), penalty: Number(zonePenalty(p, z, ctx).toFixed(2)) }))
    .filter((z) => z.distance <= 1500)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3);
  const mood = socialPulse().mood.find((m) => m.placeId === p.id) || null;
  res.json({ ...p, scores: score(p, { zones, reports, ctx }), nearbyReports, nearbyZones, socialMood: mood, context: ctx });
});

// Compare 2-3 places side by side
app.get('/api/compare', async (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter(Boolean).slice(0, 3);
  const { ctx } = await context(req);
  const reports = reportsLib.list({ activeOnly: true });
  const weights = normalizeWeights(req.query.weights ? safeJson(req.query.weights) : null);
  const picked = places.filter((p) => ids.includes(p.id));
  const out = withScores(picked, { zonesArr: zones, reports, ctx, weights });
  const winner = [...out].sort((a, b) => b.scores.composite - a.scores.composite)[0];
  res.json({ context: ctx, places: out, winner: winner ? winner.id : null });
});

// Best vs worst leaderboard
app.get('/api/rank', async (req, res) => {
  const { ctx } = await context(req);
  const reports = reportsLib.list({ activeOnly: true });
  const weights = normalizeWeights(req.query.weights ? safeJson(req.query.weights) : null);
  let list = withScores(places, { zonesArr: zones, reports, ctx, weights });
  if (req.query.category && req.query.category !== 'all') list = list.filter((p) => p.category === req.query.category);
  list.sort((a, b) => b.scores.composite - a.scores.composite);
  const n = Math.min(5, Math.floor(list.length / 2) || 1);
  res.json({ context: ctx, weights, best: list.slice(0, n), worst: list.slice(-n).reverse() });
});

app.get('/api/zones', async (req, res) => {
  const { ctx } = await context(req);
  res.json({
    context: ctx,
    zones: zones.map((z) => ({ ...z, activeNow: z.when === 'always' || (z.when === 'night' && isNight(ctx.hour)) || (z.when === 'rain' && ctx.rainy) })),
    hotspots: reportsLib.hotspots(),
  });
});

app.get('/api/reports', (req, res) => {
  res.json({ reports: reportsLib.list({ activeOnly: req.query.all !== '1', category: req.query.category }) });
});

const rate = new Map();
function limited(ip) {
  const now = Date.now();
  const hits = (rate.get(ip) || []).filter((t) => now - t < 60 * 1000);
  hits.push(now);
  rate.set(ip, hits);
  return hits.length > 10;
}

app.post('/api/reports', (req, res) => {
  if (limited(req.ip)) return res.status(429).json({ error: 'Too many reports. Please wait a minute.' });
  const { text, lat, lng, category, photo, audio, transcript } = req.body || {};
  const la = Number(lat);
  const ln = Number(lng);
  if (!text || String(text).trim().length < 5) return res.status(400).json({ error: 'Please describe what you saw (at least 5 characters).' });
  if (!Number.isFinite(la) || !Number.isFinite(ln) || la < -90 || la > 90 || ln < -180 || ln > 180) {
    return res.status(400).json({ error: 'A valid location is required.' });
  }
  const created = reportsLib.add({ text, category, lat: la, lng: ln, photo, audio, transcript });
  res.status(201).json({ report: created });
});

const confirmed = new Set();
app.post('/api/reports/:id/confirm', (req, res) => {
  const key = `${req.ip}:${req.params.id}`;
  if (confirmed.has(key)) return res.status(409).json({ error: 'You already confirmed this report.' });
  const r = reportsLib.confirm(req.params.id);
  if (!r) return res.status(404).json({ error: 'Report not found' });
  confirmed.add(key);
  res.json({ report: r });
});

app.post('/api/nlp', (req, res) => {
  res.json(analyze(req.body && req.body.text));
});

app.get('/api/route', async (req, res) => {
  const parse = (s) => {
    const [lat, lng] = String(s || '').split(',').map(Number);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  };
  const from = parse(req.query.from);
  const to = parse(req.query.to);
  if (!from || !to) return res.status(400).json({ error: 'Use ?from=lat,lng&to=lat,lng' });
  if (haversine(from, to) < 100) return res.status(400).json({ error: 'Start and destination are too close.' });
  const { ctx } = await context(req);
  const reports = reportsLib.list({ activeOnly: true });
  const result = await getRoutes(from, to, { zones, reports, ctx });
  res.json({ context: ctx, ...result });
});

app.get('/api/weather', async (req, res) => res.json(await getWeather(req.query.force === '1')));

app.get('/api/traffic', async (req, res) => {
  const { ctx } = await context(req);
  const reports = reportsLib.list({ activeOnly: true });
  res.json({ hour: ctx.hour, weekday: istWeekday(), model: 'typical-profile + live reports', corridors: getTraffic({ reports, hour: ctx.hour, rainy: ctx.rainy }) });
});

app.get('/api/social', (req, res) => res.json(socialPulse()));
app.get('/api/traditions', (req, res) => res.json(traditions));

// Smart picks and alerts for "right now"
app.get('/api/insights', async (req, res) => {
  const { ctx, weather } = await context(req);
  const reports = reportsLib.list({ activeOnly: true });
  const hotspots = reportsLib.hotspots();
  const traffic = getTraffic({ reports, hour: ctx.hour, rainy: ctx.rainy });
  const scored = withScores(places, { zonesArr: zones, reports, ctx, weights: DEFAULT_WEIGHTS });

  const pick = (pred, n = 3) => scored.filter(pred).sort((a, b) => b.scores.composite - a.scores.composite).slice(0, n);
  const recs = [];
  const night = isNight(ctx.hour);
  const hot = weather.apparent >= 36;
  if (ctx.rainy) recs.push({ title: 'Rain plan', why: 'Rain is likely; indoor places score best right now.', places: pick((p) => p.indoor && p.category !== 'hotel') });
  else if (hot && ctx.hour >= 11 && ctx.hour <= 16) recs.push({ title: 'Beat the heat', why: 'Midday heat; choose shaded or indoor spots.', places: pick((p) => p.indoor && p.category !== 'hotel') });
  else if (ctx.hour >= 5 && ctx.hour < 9) recs.push({ title: 'Early-morning outdoors', why: 'Cool, quiet and the best light for hills and forts.', places: pick((p) => ['parvati-hill', 'sinhagad-fort', 'osho-garden'].includes(p.id)) });
  else if (ctx.hour >= 16 && ctx.hour < 20) recs.push({ title: 'Golden-hour heritage', why: 'Good time for old-city heritage and the Shaniwar Wada evening show.', places: pick((p) => ['heritage', 'attraction'].includes(p.category)) });
  if (night) recs.push({ title: 'After dark: stay on main roads', why: 'Several areas have poor lighting or late-night concerns.', places: pick((p) => p.scores.parts.safety >= 8 && p.category !== 'hotel') });
  recs.push({ title: 'Budget eats', why: 'Highest affordability with solid ratings.', places: pick((p) => p.category === 'food' && p.scores.parts.affordability >= 7) });

  const activeZones = zones.filter((z) => z.when === 'always' || (z.when === 'night' && night) || (z.when === 'rain' && ctx.rainy));
  const alerts = [
    ...weather.alerts.map((a) => ({ ...a, source: 'weather' })),
    ...traffic.filter((t) => t.level === 'jammed').map((t) => ({ level: 'warning', type: 'traffic', title: `Heavy congestion: ${t.name}`, text: 'Allow extra time or pick an alternate corridor.', source: 'traffic' })),
    ...hotspots.slice(0, 3).map((h) => ({ level: 'watch', type: h.topCategory, title: `${h.icon} ${h.label} cluster (${h.count} reports)`, text: 'Multiple citizen reports in one spot within the last 72 hours.', source: 'citizens', lat: h.lat, lng: h.lng })),
  ];

  res.json({
    context: ctx,
    weather: { condition: weather.condition, temperature: weather.temperature, apparent: weather.apparent, aqi: weather.aqi, source: weather.source },
    alerts,
    recommendations: recs,
    stats: {
      activeReports: reports.length,
      verified: reports.filter((r) => r.status === 'verified').length,
      hotspots: hotspots.length,
      activeRiskZones: activeZones.length,
      socialMood: socialPulse().overall,
    },
  });
});

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

if (require.main === module) {
  app.listen(PORT, () => console.log(`CityPulse Pune running on http://localhost:${PORT}`));
}

module.exports = app;
