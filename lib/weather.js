'use strict';

/**
 * Live weather + air quality from Open-Meteo (free, no API key).
 * Falls back to clearly-labelled sample data if the network is unavailable.
 */

const LAT = 18.5204;
const LNG = 73.8567;
const TTL = 10 * 60 * 1000;
let cache = { at: 0, data: null };

const WMO = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  80: 'Rain showers', 81: 'Heavy showers', 82: 'Violent showers', 95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Severe thunderstorm',
};

async function getJson(url, ms = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function deriveAlerts(w) {
  const alerts = [];
  if (w.maxPrecipProb >= 70 || w.precipitation >= 2.5) {
    alerts.push({ level: 'warning', type: 'rain', title: 'Heavy rain likely',
      text: 'Low-lying roads (Sinhagad Road, Mula-Mutha riverside, Warje underpass) may flood. Prefer indoor plans and elevated routes.' });
  } else if (w.maxPrecipProb >= 40) {
    alerts.push({ level: 'watch', type: 'rain', title: 'Showers possible',
      text: 'Carry rain cover; expect slower traffic.' });
  }
  if (w.apparent >= 38) {
    alerts.push({ level: 'warning', type: 'heat', title: 'Heat stress',
      text: 'Feels-like temperature is very high. Avoid midday treks (Sinhagad, Parvati) and hydrate.' });
  }
  if (w.uvMax >= 8) {
    alerts.push({ level: 'watch', type: 'uv', title: 'High UV', text: 'Sun protection recommended between 11:00 and 15:00.' });
  }
  if (w.aqi != null && w.aqi >= 150) {
    alerts.push({ level: 'warning', type: 'air', title: 'Unhealthy air quality',
      text: 'Consider masks and shorter outdoor stays, especially near busy corridors.' });
  }
  if (w.gust >= 50) {
    alerts.push({ level: 'watch', type: 'wind', title: 'Strong gusts', text: 'Be careful on hilltops and bridges.' });
  }
  return alerts;
}

function fallback() {
  const w = {
    source: 'fallback-sample', temperature: 29, apparent: 31, precipitation: 0, weatherCode: 2,
    condition: 'Partly cloudy', gust: 18, maxPrecipProb: 20, uvMax: 7, aqi: 90, pm25: 32,
    hourly: Array.from({ length: 12 }, (_, i) => ({ hour: i * 2, prob: 20 })),
  };
  w.alerts = deriveAlerts(w);
  w.rainy = false;
  return w;
}

async function getWeather(force = false) {
  if (!force && cache.data && Date.now() - cache.at < TTL) return cache.data;
  try {
    const wUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LNG}` +
      `&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_gusts_10m` +
      `&hourly=precipitation_probability&daily=uv_index_max&forecast_days=1&timezone=Asia%2FKolkata`;
    const aUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAT}&longitude=${LNG}&current=us_aqi,pm2_5`;
    const [wx, air] = await Promise.all([getJson(wUrl), getJson(aUrl).catch(() => null)]);
    const c = wx.current || {};
    const probs = (wx.hourly && wx.hourly.precipitation_probability) || [];
    const w = {
      source: 'open-meteo',
      temperature: c.temperature_2m,
      apparent: c.apparent_temperature,
      precipitation: c.precipitation || 0,
      weatherCode: c.weather_code,
      condition: WMO[c.weather_code] || 'Unknown',
      gust: c.wind_gusts_10m || 0,
      maxPrecipProb: probs.length ? Math.max(...probs) : 0,
      uvMax: wx.daily && wx.daily.uv_index_max ? wx.daily.uv_index_max[0] : 0,
      aqi: air && air.current ? air.current.us_aqi : null,
      pm25: air && air.current ? air.current.pm2_5 : null,
      hourly: probs.filter((_, i) => i % 2 === 0).map((p, i) => ({ hour: i * 2, prob: p })),
    };
    w.alerts = deriveAlerts(w);
    w.rainy = w.precipitation >= 0.5 || w.maxPrecipProb >= 60;
    cache = { at: Date.now(), data: w };
    return w;
  } catch (err) {
    const w = fallback();
    w.error = String(err.message || err);
    cache = { at: Date.now() - TTL + 60 * 1000, data: w }; // retry in ~1 min
    return w;
  }
}

module.exports = { getWeather };
