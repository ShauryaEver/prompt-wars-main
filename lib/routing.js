'use strict';

const { haversine, polylineLength, samplePolyline } = require('./geo');
const { zonePenalty, reportPenalty } = require('./risk');

const OSRM = 'https://router.project-osrm.org/route/v1/driving';

async function fetchOsrm(from, to) {
  const url = `${OSRM}/${from.lng},${from.lat};${to.lng},${to.lat}?alternatives=true&overview=full&geometries=geojson`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'citypulse-pune/1.0' } });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const j = await res.json();
    if (j.code !== 'Ok' || !j.routes || !j.routes.length) throw new Error('OSRM no route');
    return j.routes.map((r) => ({
      coords: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      distance: r.distance,
      duration: r.duration,
    }));
  } finally {
    clearTimeout(t);
  }
}

/** Offline fallback: a direct line plus two bowed detours (clearly flagged as synthetic). */
function syntheticRoutes(from, to) {
  const make = (bow) => {
    const pts = [];
    const n = 24;
    const dx = to.lng - from.lng;
    const dy = to.lat - from.lat;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const off = bow * Math.sin(Math.PI * t);
      pts.push([from.lat + dy * t + ny * off, from.lng + dx * t + nx * off]);
    }
    const distance = polylineLength(pts) * 1.25;
    return { coords: pts, distance, duration: distance / 6.5 };
  };
  const base = Math.max(0.004, haversine(from, to) / 111000 / 4);
  return [make(0), make(base), make(-base)];
}

function scoreRoute(route, zones, reports, ctx) {
  const pts = samplePolyline(route.coords, 100);
  let risk = 0;
  const hit = new Map();
  for (const p of pts) {
    let worst = 0;
    for (const z of zones) {
      const pen = zonePenalty(p, z, ctx);
      if (pen > 0) {
        worst = Math.max(worst, pen);
        // only list zones that genuinely matter in this context (not dormant night/rain-only zones)
        if (pen >= 0.4) {
          const prev = hit.get(z.id);
          if (!prev || pen > prev.penalty) hit.set(z.id, { zone: z, penalty: pen });
        }
      }
    }
    risk += worst + reportPenalty(p, reports);
  }
  const km = Math.max(0.1, route.distance / 1000);
  return {
    riskTotal: Number(risk.toFixed(2)),
    riskPerKm: Number((risk / km).toFixed(2)),
    zones: [...hit.values()]
      .sort((a, b) => b.penalty - a.penalty)
      .map((h) => ({ id: h.zone.id, name: h.zone.name, type: h.zone.type, severity: h.zone.severity, note: h.zone.note })),
  };
}

async function getRoutes(from, to, { zones, reports, ctx }) {
  let routes;
  let source = 'osrm';
  try {
    routes = await fetchOsrm(from, to);
  } catch (err) {
    routes = syntheticRoutes(from, to);
    source = 'synthetic-fallback';
  }
  const scored = routes.map((r, i) => ({
    id: i,
    coords: r.coords,
    distanceKm: Number((r.distance / 1000).toFixed(2)),
    durationMin: Math.round(r.duration / 60),
    ...scoreRoute(r, zones, reports, ctx),
  }));

  const fastest = [...scored].sort((a, b) => a.durationMin - b.durationMin)[0];
  // "safest" must not be absurdly slower: allow up to +40% duration over the fastest
  const candidates = scored.filter((r) => r.durationMin <= fastest.durationMin * 1.4 + 3);
  const safest = [...candidates].sort((a, b) => a.riskTotal - b.riskTotal)[0] || fastest;

  scored.forEach((r) => {
    r.tags = [];
    if (r.id === fastest.id) r.tags.push('fastest');
    if (r.id === safest.id) r.tags.push('safest');
  });
  const saved = fastest.riskTotal ? Math.round(((fastest.riskTotal - safest.riskTotal) / fastest.riskTotal) * 100) : 0;
  return {
    source,
    routes: scored,
    fastestId: fastest.id,
    safestId: safest.id,
    summary:
      fastest.id === safest.id
        ? 'The fastest route is also the lowest-risk option right now.'
        : `The safest route cuts estimated risk by ~${Math.max(0, saved)}% for +${safest.durationMin - fastest.durationMin} min.`,
  };
}

module.exports = { getRoutes };
