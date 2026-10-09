'use strict';

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in metres between {lat,lng} points. */
function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Total length (m) of a [[lat,lng],...] polyline. */
function polylineLength(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversine(
      { lat: coords[i - 1][0], lng: coords[i - 1][1] },
      { lat: coords[i][0], lng: coords[i][1] }
    );
  }
  return total;
}

/** Evenly spaced sample points (about stepM metres apart) along a polyline. */
function samplePolyline(coords, stepM = 100) {
  if (!coords.length) return [];
  const out = [{ lat: coords[0][0], lng: coords[0][1] }];
  let carry = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = { lat: coords[i - 1][0], lng: coords[i - 1][1] };
    const b = { lat: coords[i][0], lng: coords[i][1] };
    const d = haversine(a, b);
    if (d === 0) continue;
    let pos = stepM - carry;
    while (pos <= d) {
      const t = pos / d;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
      pos += stepM;
    }
    carry = d - (pos - stepM);
  }
  const last = coords[coords.length - 1];
  out.push({ lat: last[0], lng: last[1] });
  return out;
}

/** Current hour (0-23) in India Standard Time. */
function istHour(date = new Date()) {
  const h = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  }).format(date);
  return Number(h) % 24;
}

function istWeekday(date = new Date()) {
  const w = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Asia/Kolkata' }).format(date);
  return w; // Mon..Sun
}

const isNight = (hour) => hour >= 20 || hour < 5;

module.exports = { haversine, polylineLength, samplePolyline, istHour, istWeekday, isNight };
