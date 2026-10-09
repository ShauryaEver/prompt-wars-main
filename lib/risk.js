'use strict';

const { haversine, isNight } = require('./geo');
const { severityOf } = require('./nlp');

/**
 * Context-aware risk model.
 * ctx = { hour: 0-23, rainy: boolean }
 * Zones tagged "night" matter mostly after dark; "rain" zones matter mostly when it is raining.
 */
function zoneFactor(zone, ctx) {
  if (zone.when === 'night') return isNight(ctx.hour) ? 1.4 : 0.25;
  if (zone.when === 'rain') return ctx.rainy ? 1.5 : 0.2;
  // always-on zones get slightly worse at night and in rain
  let f = 1;
  if (isNight(ctx.hour)) f *= 1.15;
  if (ctx.rainy) f *= 1.15;
  return f;
}

/** Penalty (0..~7) contributed by one zone at a point. */
function zonePenalty(point, zone, ctx) {
  const d = haversine(point, zone);
  if (d >= zone.radius) return 0;
  return zone.severity * (1 - d / zone.radius) * zoneFactor(zone, ctx);
}

function zonesAt(point, zones, ctx) {
  return zones
    .map((z) => ({ zone: z, penalty: zonePenalty(point, z, ctx) }))
    .filter((x) => x.penalty > 0);
}

/** Penalty from live citizen reports within 250 m of a point. */
function reportPenalty(point, reports) {
  let p = 0;
  for (const r of reports) {
    const d = haversine(point, r);
    if (d >= 250) continue;
    p += severityOf(r.category) * r.weight * (1 - d / 250);
  }
  return p;
}

function totalPenalty(point, zones, reports, ctx) {
  const z = zones.reduce((s, zone) => Math.max(s, zonePenalty(point, zone, ctx)), 0);
  return z + reportPenalty(point, reports);
}

module.exports = { zonePenalty, zonesAt, reportPenalty, totalPenalty, zoneFactor };
