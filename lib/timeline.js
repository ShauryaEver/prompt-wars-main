'use strict';

// Safety Time-Machine: how a place's score changes hour by hour (dry vs rain).
const { score, DEFAULT_WEIGHTS } = require('./scoring');

function dayTimeline(place, { zones, reports, weights = DEFAULT_WEIGHTS }) {
  const hours = [];
  for (let h = 0; h < 24; h++) {
    const dry = score(place, { zones, reports, ctx: { hour: h, rainy: false }, weights });
    const wet = score(place, { zones, reports, ctx: { hour: h, rainy: true }, weights });
    hours.push({ hour: h, dry: dry.parts.safety, rain: wet.parts.safety, composite: dry.composite });
  }
  const best = hours.reduce((a, b) => (b.dry > a.dry ? b : a));
  const worst = hours.reduce((a, b) => (b.dry < a.dry ? b : a));
  // longest run of hours (06-22) with dry safety within 0.5 of the best
  const good = hours.filter((x) => x.hour >= 6 && x.hour <= 22 && x.dry >= best.dry - 0.5).map((x) => x.hour);
  const swing = Number((best.dry - worst.dry).toFixed(1));
  const rainDrop = Number(Math.max(...hours.map((x) => x.dry - x.rain)).toFixed(1));
  let verdict = 'Safety stays steady through the day.';
  if (swing >= 1.5) verdict = `Noticeably riskier around ${fmt(worst.hour)}. Best at ${fmt(best.hour)}.`;
  else if (swing >= 0.5) verdict = `Slightly better around ${fmt(best.hour)}.`;
  if (rainDrop >= 1) verdict += ` Rain can cost up to ${rainDrop} safety points here.`;
  return { hours, best: best.hour, worst: worst.hour, swing, rainDrop, goodWindow: good.length ? [good[0], good[good.length - 1] + 1] : null, verdict };
}

function fmt(h) {
  const hh = ((h + 11) % 12) + 1;
  return `${hh}${h < 12 ? 'am' : 'pm'}`;
}

module.exports = { dayTimeline, fmt };

// City Risk Clock: 24h view of how many zones are live and the average safety of all places.
function cityClock(places, { zones, reports, weights = DEFAULT_WEIGHTS }) {
  const { isNight } = require('./geo');
  const out = [];
  for (let h = 0; h < 24; h++) {
    const active = (rainy) => zones.filter((z) => z.when === 'always' || (z.when === 'night' && isNight(h)) || (z.when === 'rain' && rainy)).length;
    const avg = (rainy) => places.reduce((a, p) => a + score(p, { zones, reports, ctx: { hour: h, rainy }, weights }).parts.safety, 0) / places.length;
    out.push({ hour: h, activeZones: active(false), activeZonesRain: active(true), avgSafety: Number(avg(false).toFixed(2)), avgSafetyRain: Number(avg(true).toFixed(2)) });
  }
  const safest = out.reduce((a, b) => (b.avgSafety > a.avgSafety ? b : a));
  const riskiest = out.reduce((a, b) => (b.avgSafety < a.avgSafety ? b : a));
  return { hours: out, safest: safest.hour, riskiest: riskiest.hour };
}

module.exports.cityClock = cityClock;
