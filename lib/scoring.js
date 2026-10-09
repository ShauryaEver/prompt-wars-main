'use strict';

const { totalPenalty } = require('./risk');

const DEFAULT_WEIGHTS = { safety: 0.3, cleanliness: 0.2, affordability: 0.2, rating: 0.2, accessibility: 0.1 };

// price anchors (INR) mapping to affordability 10 (cheap) and 0 (expensive) per category
const PRICE_SCALE = {
  food: [100, 1500],
  hotel: [600, 12000],
  attraction: [0, 600],
  heritage: [0, 600],
  market: [100, 1500],
  park: [0, 300],
};

const clamp = (v, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, v));

function affordability(place) {
  const [cheap, pricey] = PRICE_SCALE[place.category] || [0, 1000];
  if (place.price <= cheap) return 10;
  if (place.price >= pricey) return 0;
  // log scale so ₹300 vs ₹700 matters more than ₹9000 vs ₹11000
  const t = (Math.log(place.price + 1) - Math.log(cheap + 1)) / (Math.log(pricey + 1) - Math.log(cheap + 1));
  return clamp(10 * (1 - t));
}

/** Baseline safety minus live penalties from nearby risk zones and verified reports. */
function dynamicSafety(place, zones, reports, ctx) {
  const penalty = totalPenalty(place, zones, reports, ctx);
  return { value: clamp(place.safety - penalty * 0.6, 1, 10), penalty: Number(penalty.toFixed(2)) };
}

function score(place, { zones, reports, ctx, weights = DEFAULT_WEIGHTS }) {
  const safety = dynamicSafety(place, zones, reports, ctx);
  const parts = {
    safety: safety.value,
    cleanliness: place.cleanliness,
    affordability: affordability(place),
    rating: clamp((place.rating / 5) * 10),
    accessibility: place.accessibility,
  };
  const wSum = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  let total = 0;
  for (const k of Object.keys(parts)) total += (parts[k] * (weights[k] || 0)) / wSum;
  return {
    composite: Number(total.toFixed(2)),
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Number(v.toFixed(1))])),
    livePenalty: safety.penalty,
    safetyBaseline: place.safety,
  };
}

function normalizeWeights(input) {
  if (!input) return DEFAULT_WEIGHTS;
  const w = {};
  for (const k of Object.keys(DEFAULT_WEIGHTS)) {
    const v = Number(input[k]);
    w[k] = Number.isFinite(v) && v >= 0 ? v : DEFAULT_WEIGHTS[k];
  }
  return w;
}

module.exports = { score, affordability, dynamicSafety, normalizeWeights, DEFAULT_WEIGHTS };
