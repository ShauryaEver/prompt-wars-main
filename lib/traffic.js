'use strict';

const corridors = require('../data/corridors.json');
const { istHour, istWeekday } = require('./geo');
const { haversine } = require('./geo');

/**
 * Typical-congestion model (NOT a live feed): morning and evening rush peaks,
 * weekend adjustments per corridor, raised by nearby active traffic/accident reports.
 * Swap `typicalIndex` for a real provider (e.g. Google Routes, TomTom, HERE) in production.
 */
function gaussian(x, mu, sigma) {
  return Math.exp(-((x - mu) ** 2) / (2 * sigma ** 2));
}

function typicalIndex(corridor, hourFloat, weekday) {
  const weekend = weekday === 'Sat' || weekday === 'Sun';
  const peak = weekend
    ? 0.6 * gaussian(hourFloat, 18.5, 2.2) + 0.3 * gaussian(hourFloat, 12, 2.5)
    : 0.9 * gaussian(hourFloat, 9.5, 1.4) + 1.0 * gaussian(hourFloat, 18.5, 1.8) + 0.25 * gaussian(hourFloat, 13, 2);
  let idx = corridor.base * 0.35 + corridor.base * peak;
  if (weekend) idx += corridor.weekendBoost;
  return idx;
}

const label = (v) => (v >= 0.85 ? 'jammed' : v >= 0.6 ? 'heavy' : v >= 0.35 ? 'moderate' : 'free-flowing');

function getTraffic({ reports = [], hour, weekday, rainy = false } = {}) {
  const h = hour != null ? hour : istHour();
  const wd = weekday || istWeekday();
  return corridors.map((c) => {
    let idx = typicalIndex(c, h + 0.5, wd);
    if (rainy) idx += 0.12;
    const nearby = reports.filter(
      (r) => ['traffic', 'accident', 'flooding'].includes(r.category) && r.active && haversine(r, c) <= 1200
    );
    const bump = nearby.reduce((s, r) => s + 0.12 * Math.max(0.3, r.weight * 2), 0);
    idx = Math.min(1, idx + Math.min(0.4, bump));
    return {
      id: c.id, name: c.name, lat: c.lat, lng: c.lng,
      index: Number(idx.toFixed(2)), level: label(idx),
      reportsNearby: nearby.length,
    };
  }).sort((a, b) => b.index - a.index);
}

module.exports = { getTraffic };
