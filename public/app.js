'use strict';

/* =========================================================
   CityPulse Pune – frontend
   Vanilla JS + Leaflet. All user-supplied text is escaped.
   ========================================================= */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts) {
  const res = await fetch('/api' + path, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 3200);
}

const EMOJI = { food: '🍽️', hotel: '🛏️', heritage: '🏛️', attraction: '⭐', market: '🛍️', park: '🌳' };
const ZONE_COLOR = { accident: '#ff5d5d', crime: '#c77dff', flood: '#4aa3ff', crowd: '#ffc857', lighting: '#f4e04d' };
const PART_LABEL = { safety: 'Safety', cleanliness: 'Cleanliness', affordability: 'Affordability', rating: 'Ratings', accessibility: 'Accessibility' };

const state = {
  tab: 'discover',
  meta: null,
  places: [],
  placeIndex: {},
  filters: { category: 'all', q: '', budget: false, indoor: false, sort: 'score' },
  selected: null,
  compare: [],
  weights: null,
  override: { hour: null, rain: null },
  weather: null,
  safety: { zones: true, reports: true, pick: null, from: null, to: null, fromLabel: '', toLabel: '', routes: null, activeRoute: null },
  draft: { lat: null, lng: null, photo: null, audio: null, transcript: '' },
  reportCats: [],
};

/* ---------- query helpers ---------- */
function ctxQs(extra = {}) {
  const p = new URLSearchParams(extra);
  if (state.override.hour !== null) p.set('hour', state.override.hour);
  if (state.override.rain !== null) p.set('rain', state.override.rain ? '1' : '0');
  const s = p.toString();
  return s ? '?' + s : '';
}
const scoreClass = (v) => (v >= 7.5 ? 'hi' : v >= 5.5 ? 'mid' : 'lo');
const barClass = (v) => (v >= 7 ? '' : v >= 5 ? 'mid' : 'bad');

/* ---------- map ---------- */
const map = L.map('map', { zoomControl: false }).setView([18.5204, 73.8567], 13);
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
const layers = {
  places: L.layerGroup().addTo(map),
  zones: L.layerGroup().addTo(map),
  reports: L.layerGroup().addTo(map),
  route: L.layerGroup().addTo(map),
  pick: L.layerGroup().addTo(map),
  traffic: L.layerGroup().addTo(map),
};
const clearLayers = (...names) => names.forEach((n) => layers[n].clearLayers());

function pinIcon(p, sel) {
  return L.divIcon({
    className: '',
    html: `<div class="pin ${esc(p.category)} ${sel ? 'sel' : ''}"><span>${EMOJI[p.category] || '📍'}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [8, 30],
    popupAnchor: [7, -28],
  });
}

function drawPlaces(list) {
  clearLayers('places');
  list.forEach((p) => {
    const m = L.marker([p.lat, p.lng], { icon: pinIcon(p, state.selected === p.id) }).addTo(layers.places);
    m.bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.priceLabel)} · ★ ${p.rating}<br>Score ${p.scores.composite}/10`);
    m.on('click', () => selectPlace(p.id, false));
  });
}

function drawZones(zonesData, hotspots) {
  clearLayers('zones');
  zonesData.forEach((z) => {
    const color = ZONE_COLOR[z.type] || '#ff5d5d';
    const c = L.circle([z.lat, z.lng], {
      radius: z.radius,
      color,
      weight: z.activeNow ? 2 : 1,
      dashArray: z.activeNow ? null : '4 6',
      fillColor: color,
      fillOpacity: z.activeNow ? 0.18 + z.severity * 0.03 : 0.04,
    }).addTo(layers.zones);
    c.bindPopup(
      `<b>${esc(z.name)}</b><br>${esc(z.type)} · severity ${z.severity}/5<br>${esc(z.note)}<br><i>${z.activeNow ? 'Active now' : 'Not active at the selected time/weather'}</i>`
    );
  });
  (hotspots || []).forEach((h) => {
    L.circleMarker([h.lat, h.lng], { radius: 9 + h.count * 2, color: '#fff', weight: 2, fillColor: '#ff5d5d', fillOpacity: 0.5 })
      .addTo(layers.zones)
      .bindPopup(`<b>${esc(h.icon)} ${esc(h.label)} hotspot</b><br>${h.count} citizen reports within 300 m`);
  });
}

function drawReports(reports) {
  clearLayers('reports');
  reports.filter((r) => r.category !== 'other').forEach((r) => {
    const icon = L.divIcon({
      className: '',
      html: `<div class="rpin ${esc(r.status)}">${esc(r.nlp.icon)}</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });
    L.marker([r.lat, r.lng], { icon })
      .addTo(layers.reports)
      .bindPopup(
        `<b>${esc(r.nlp.label)}</b> · ${esc(r.status)}<br>${esc(r.text)}<br><span class="hint">${r.ageHours}h ago · credibility ${Math.round(r.credibility * 100)}%</span>` +
          (r.photoUrl ? `<br><img src="${esc(r.photoUrl)}" style="width:180px;border-radius:8px;margin-top:6px">` : '')
      );
  });
}

function drawPick() {
  clearLayers('pick');
  const mk = (pt, label, color) =>
    pt &&
    L.circleMarker([pt.lat, pt.lng], { radius: 9, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 })
      .addTo(layers.pick)
      .bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -8] });
  mk(state.safety.from, 'Start', '#2ec4b6');
  mk(state.safety.to, 'Destination', '#ff9f1c');
  if (state.tab === 'report' && state.draft.lat !== null) {
    L.circleMarker([state.draft.lat, state.draft.lng], { radius: 10, color: '#fff', weight: 2, fillColor: '#ff5d5d', fillOpacity: 1 })
      .addTo(layers.pick)
      .bindTooltip('Report location', { permanent: true, direction: 'top', offset: [0, -8] });
  }
}

function setLegend(html) {
  const el = $('#legend');
  el.innerHTML = html || '';
  el.classList.toggle('show', !!html);
}

/* ---------- data loading ---------- */
async function loadPlaces() {
  const f = state.filters;
  const params = { category: f.category, sort: f.sort };
  if (f.q) params.q = f.q;
  if (f.budget) params.budget = '1';
  if (f.indoor) params.indoor = '1';
  if (state.weights) params.weights = JSON.stringify(state.weights);
  const data = await api('/places' + ctxQs(params));
  state.places = data.places;
  data.places.forEach((p) => (state.placeIndex[p.id] = p));
  return data.places;
}

async function ensureAllPlaces() {
  if (Object.keys(state.placeIndex).length < 20) {
    const data = await api('/places' + ctxQs({ category: 'all' }));
    data.places.forEach((p) => (state.placeIndex[p.id] = p));
  }
}

/* ---------- shared UI pieces ---------- */
function bars(parts) {
  return (
    '<div class="bars">' +
    Object.entries(PART_LABEL)
      .map(
        ([k, label]) =>
          `<span>${label}</span><div class="bar ${barClass(parts[k])}"><i style="width:${parts[k] * 10}%"></i></div><b>${parts[k]}</b>`
      )
      .join('') +
    '</div>'
  );
}

function placeCard(p) {
  const on = state.compare.includes(p.id);
  return `<div class="card click ${state.selected === p.id ? 'sel' : ''}" data-place="${esc(p.id)}">
    <div class="top">
      <div>
        <div class="name">${EMOJI[p.category] || ''} ${esc(p.name)}</div>
        <div class="meta">${esc(p.category)} · ★ ${p.rating} · ${esc(p.priceLabel)}</div>
      </div>
      <div class="badge ${scoreClass(p.scores.composite)}" title="Composite score">${p.scores.composite}</div>
    </div>
    <div class="meta" style="margin-top:6px">${esc(p.blurb)}</div>
    <div>${p.tags.slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
      ${p.scores.livePenalty > 1 ? '<span class="tag" style="color:#ffc857">⚠ nearby risk</span>' : ''}</div>
    <div class="row" style="margin-top:8px">
      <button class="btn ghost small" data-cmp="${esc(p.id)}">${on ? '✓ In compare' : '⚖ Compare'}</button>
      <button class="btn ghost small" data-route-to="${esc(p.id)}">🧭 Safe route</button>
    </div>
  </div>`;
}

async function placeDetail(id) {
  const p = await api('/places/' + id + ctxQs());
  const zonesHtml = p.nearbyZones
    .map((z) => `<div class="alert ${z.penalty > 1.5 ? 'warning' : ''}"><b>${esc(z.name)} · ${z.distance} m away</b><span>${esc(z.note)}</span></div>`)
    .join('');
  const repHtml = p.nearbyReports
    .map((r) => `<div class="alert"><b>${esc(r.nlp.icon)} ${esc(r.nlp.label)} <span class="pill ${esc(r.status)}">${esc(r.status)}</span></b><span>${esc(r.text)} (${r.ageHours}h ago)</span></div>`)
    .join('');
  return `<div class="card sel">
    <div class="top"><div><h2>${esc(p.name)}</h2><div class="meta">${esc(p.hours)} · ${esc(p.priceLabel)}</div></div>
    <div class="badge ${scoreClass(p.scores.composite)}">${p.scores.composite}</div></div>
    <p class="sub" style="margin-top:8px">${esc(p.blurb)}</p>
    ${p.history ? `<p class="sub"><b>History:</b> ${esc(p.history)}</p>` : ''}
    ${bars(p.scores.parts)}
    ${p.scores.livePenalty > 0 ? `<div class="hint" style="margin-top:8px">Safety adjusted from ${p.scores.safetyBaseline} to ${p.scores.parts.safety} using live risk near this spot.</div>` : ''}
    ${p.socialMood ? `<div class="hint" style="margin-top:6px">Social mood: ${p.socialMood.sentiment > 0.15 ? '😊 positive' : p.socialMood.sentiment < -0.15 ? '😟 negative' : '😐 mixed'} (${p.socialMood.posts} post${p.socialMood.posts > 1 ? 's' : ''})</div>` : ''}
    ${zonesHtml ? '<h3>Nearby risk zones</h3>' + zonesHtml : ''}
    ${repHtml ? '<h3>Recent citizen reports</h3>' + repHtml : ''}
    <div class="row" style="margin-top:10px">
      <button class="btn small" data-route-to="${esc(p.id)}">🧭 Safe route here</button>
      <button class="btn ghost small" data-cmp="${esc(p.id)}">⚖ Compare</button>
    </div></div>`;
}

async function selectPlace(id, fly = true) {
  state.selected = id;
  const p = state.placeIndex[id];
  if (p && fly) map.flyTo([p.lat, p.lng], 16, { duration: 0.8 });
  if (['discover', 'heritage'].includes(state.tab)) {
    const host = $('#detail');
    if (host) host.innerHTML = await placeDetail(id);
    $$('.card[data-place]').forEach((c) => c.classList.toggle('sel', c.dataset.place === id));
    if (host) host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  drawPlaces(state.places);
}

/* =========================================================
   TABS
   ========================================================= */
const tabs = {};

/* ---------- Discover ---------- */
tabs.discover = async (host) => {
  clearLayers('zones', 'reports', 'route', 'traffic');
  setLegend(
    Object.entries(EMOJI).map(([k, e]) => `${e} ${k}`).join('<br>')
  );
  const f = state.filters;
  const cats = ['all', ...state.meta.categories];
  host.innerHTML = `
    <h2>Explore Pune</h2>
    <p class="sub">Food, stays, landmarks and budget spots, ranked by a live composite of safety, cleanliness, price, ratings and accessibility.</p>
    <input type="search" id="q" placeholder="Search misal, fort, hostel…" value="${esc(f.q)}" />
    <div class="chips">${cats.map((c) => `<span class="chip ${f.category === c ? 'on' : ''}" data-cat="${c}">${c === 'all' ? 'All' : (EMOJI[c] || '') + ' ' + c}</span>`).join('')}</div>
    <div class="row">
      <span class="chip ${f.budget ? 'on' : ''}" id="fBudget">💸 Budget-friendly</span>
      <span class="chip ${f.indoor ? 'on' : ''}" id="fIndoor">☂ Indoor only</span>
      <select id="fSort" style="width:auto">
        ${[['score', 'Best overall'], ['rating', 'Top rated'], ['price', 'Cheapest'], ['safety', 'Safest']].map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div id="detail" style="margin-top:12px"></div>
    <div id="list" style="margin-top:12px"></div>`;
  const list = await loadPlaces();
  drawPlaces(list);
  $('#list').innerHTML = list.length ? list.map(placeCard).join('') : '<p class="sub">No places match these filters.</p>';
  if (state.selected && state.placeIndex[state.selected]) $('#detail').innerHTML = await placeDetail(state.selected);

  let t;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.filters.q = e.target.value.trim(); render(); }, 300);
  });
  $$('.chip[data-cat]', host).forEach((c) => c.addEventListener('click', () => { state.filters.category = c.dataset.cat; render(); }));
  $('#fBudget').onclick = () => { state.filters.budget = !state.filters.budget; render(); };
  $('#fIndoor').onclick = () => { state.filters.indoor = !state.filters.indoor; render(); };
  $('#fSort').onchange = (e) => { state.filters.sort = e.target.value; render(); };
};

/* ---------- Heritage ---------- */
tabs.heritage = async (host) => {
  clearLayers('zones', 'reports', 'route', 'traffic');
  setLegend('');
  const [all, traditions] = await Promise.all([api('/places' + ctxQs({ category: 'all' })), api('/traditions')]);
  all.places.forEach((p) => (state.placeIndex[p.id] = p));
  const heritage = all.places
    .filter((p) => ['heritage', 'attraction'].includes(p.category) && p.history)
    .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
  state.places = heritage;
  drawPlaces(heritage);
  host.innerHTML = `
    <h2>History &amp; culture</h2>
    <p class="sub">A timeline of the landmarks that shaped Pune, then the traditions that keep the city alive. Tap an entry to jump to it on the map.</p>
    <div id="detail"></div>
    <h3>Landmark timeline</h3>
    <div class="timeline">
      ${heritage.map((p) => `<div class="item" data-place="${esc(p.id)}">
        <div class="yr">${p.year ? (p.year < 1000 ? '~8th c.' : p.year) : ''}</div>
        <div class="name">${esc(p.name)}</div>
        <div class="meta">${esc(p.history)}</div>
      </div>`).join('')}
    </div>
    <h3>Living traditions</h3>
    ${traditions.map((t) => `<div class="card"><div class="name">${t.emoji} ${esc(t.name)} <span class="tag">${esc(t.when)}</span></div><div class="meta" style="margin-top:6px">${esc(t.text)}</div></div>`).join('')}`;
};

/* ---------- Safety ---------- */
function hourNow() {
  return state.override.hour !== null ? state.override.hour : new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getHours();
}

async function refreshZones() {
  const z = await api('/zones' + ctxQs());
  clearLayers('zones', 'reports');
  if (state.safety.zones) drawZones(z.zones, z.hotspots);
  if (state.safety.reports) drawReports((await api('/reports')).reports);
  return z;
}

tabs.safety = async (host) => {
  clearLayers('places', 'traffic');
  await ensureAllPlaces();
  const rainDefault = state.weather ? state.weather.rainy : false;
  const rain = state.override.rain !== null ? state.override.rain : rainDefault;
  const hour = hourNow();
  const placeOpts = Object.values(state.placeIndex)
    .filter((p) => p.category !== 'hotel' || true)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
    .join('');
  const s = state.safety;
  host.innerHTML = `
    <h2>Safety &amp; safer routes</h2>
    <p class="sub">Risk zones switch on and off with time of day and rain. Reports from citizens add live weight, and routes are scored against both.</p>
    <div class="card">
      <div class="slider-row"><span>Time of day</span><input type="range" id="hr" min="0" max="23" value="${hour}"><b id="hrv">${String(hour).padStart(2, '0')}:00</b></div>
      <div class="row" style="margin-top:6px">
        <span class="chip ${rain ? 'on' : ''}" id="rainT">🌧 Rain scenario</span>
        <span class="chip ${s.zones ? 'on' : ''}" id="zT">Risk zones</span>
        <span class="chip ${s.reports ? 'on' : ''}" id="rT">Citizen reports</span>
        <button class="btn ghost small" id="resetCtx">Use live time/weather</button>
      </div>
    </div>

    <h3>Route planner</h3>
    <div class="card">
      <div class="row" style="flex-wrap:nowrap"><span style="width:44px" class="hint">From</span>
        <select id="from"><option value="">Choose…</option><option value="__me">📍 My location</option><option value="__map">🗺 Pick on map</option>${placeOpts}</select></div>
      <div class="row" style="flex-wrap:nowrap;margin-top:8px"><span style="width:44px" class="hint">To</span>
        <select id="to"><option value="">Choose…</option><option value="__map">🗺 Pick on map</option>${placeOpts}</select></div>
      <div class="row" style="margin-top:10px"><button class="btn" id="go">Find safest route</button><span class="hint" id="pickHint"></span></div>
      <div id="routes" style="margin-top:12px"></div>
    </div>
    <div id="zlist"></div>
    <div class="warn-note">Zones and ratings here are illustrative seed data for the demo. In production, plug in police/NCRB, traffic-police and municipal feeds.</div>`;

  setLegend(Object.entries(ZONE_COLOR).map(([k, c]) => `<span class="rec-dot" style="background:${c}"></span>${k}`).join('<br>') + '<br><span class="rec-dot" style="background:#ff5d5d"></span>reported incident');

  const z = await refreshZones();
  const renderZoneList = (zs) => {
    const active = zs.zones.filter((x) => x.activeNow).sort((a, b) => b.severity - a.severity);
    $('#zlist').innerHTML = `<h3>Active risk zones (${active.length})</h3>` +
      (active.length ? active.map((x) => `<div class="alert ${x.severity >= 4 ? 'warning' : ''}" data-fly="${x.lat},${x.lng}" style="cursor:pointer"><b>${esc(x.name)} · ${x.severity}/5</b><span>${esc(x.note)}</span></div>`).join('') : '<p class="sub">Nothing active at this time and weather.</p>');
    $$('[data-fly]', host).forEach((a) => a.onclick = () => { const [la, ln] = a.dataset.fly.split(',').map(Number); map.flyTo([la, ln], 15); });
  };
  renderZoneList(z);

  const update = async () => { const zz = await refreshZones(); renderZoneList(zz); if (s.routes) findRoute(); };
  $('#hr').oninput = (e) => { $('#hrv').textContent = String(e.target.value).padStart(2, '0') + ':00'; };
  $('#hr').onchange = (e) => { state.override.hour = Number(e.target.value); update(); };
  $('#rainT').onclick = () => { state.override.rain = !rain; render(); };
  $('#zT').onclick = () => { s.zones = !s.zones; render(); };
  $('#rT').onclick = () => { s.reports = !s.reports; render(); };
  $('#resetCtx').onclick = () => { state.override = { hour: null, rain: null }; render(); toast('Using live time and weather'); };

  const setPoint = (which, val) => {
    const hint = $('#pickHint');
    if (val === '__map') { s.pick = which; hint.textContent = `Click the map to set ${which === 'from' ? 'start' : 'destination'}`; return; }
    s.pick = null; hint.textContent = '';
    if (val === '__me') {
      navigator.geolocation?.getCurrentPosition(
        (pos) => { s[which] = { lat: pos.coords.latitude, lng: pos.coords.longitude }; drawPick(); toast('Using your location'); },
        () => toast('Could not read your location'),
        { enableHighAccuracy: true, timeout: 8000 }
      );
      return;
    }
    const p = state.placeIndex[val];
    s[which] = p ? { lat: p.lat, lng: p.lng } : null;
    drawPick();
  };
  $('#from').onchange = (e) => setPoint('from', e.target.value);
  $('#to').onchange = (e) => setPoint('to', e.target.value);
  if (s.toPlace) { $('#to').value = s.toPlace; }
  if (s.from) drawPick();
  $('#go').onclick = findRoute;
  if (s.routes) renderRoutes(s.routes);
  drawPick();
};

async function findRoute() {
  const s = state.safety;
  if (!s.from || !s.to) return toast('Pick a start and destination first');
  const btn = $('#go');
  if (btn) { btn.disabled = true; btn.textContent = 'Scoring routes…'; }
  try {
    const data = await api('/route' + ctxQs({ from: `${s.from.lat},${s.from.lng}`, to: `${s.to.lat},${s.to.lng}` }));
    s.routes = data;
    s.activeRoute = data.safestId;
    renderRoutes(data);
  } catch (e) {
    toast(e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Find safest route'; }
  }
}

function renderRoutes(data) {
  const host = $('#routes');
  if (!host) return;
  const s = state.safety;
  clearLayers('route');
  data.routes.forEach((r) => {
    const safest = r.id === data.safestId;
    const fastest = r.id === data.fastestId;
    const active = r.id === s.activeRoute;
    L.polyline(r.coords, {
      color: safest ? '#4cd964' : fastest ? '#9aa4b2' : '#4aa3ff',
      weight: active ? 7 : 4,
      opacity: active ? 0.95 : 0.5,
      dashArray: !safest && fastest ? '8 8' : null,
    }).addTo(layers.route).on('click', () => { s.activeRoute = r.id; renderRoutes(data); });
  });
  const all = data.routes.flatMap((r) => r.coords);
  if (all.length) map.fitBounds(L.latLngBounds(all), { padding: [40, 40] });
  host.innerHTML =
    `<div class="hint" style="margin-bottom:8px">${esc(data.summary)}${data.source === 'synthetic-fallback' ? ' <b>(Demo geometry: live routing service unreachable.)</b>' : ''}</div>` +
    data.routes
      .map((r) => {
        const color = r.id === data.safestId ? '#4cd964' : r.id === data.fastestId ? '#9aa4b2' : '#4aa3ff';
        return `<div class="card click ${r.id === s.activeRoute ? 'sel' : ''}" data-r="${r.id}">
          <div class="route-opt"><div><span class="swatch" style="background:${color}"></span><b>${r.tags.map((t) => t[0].toUpperCase() + t.slice(1)).join(' + ') || 'Alternative'}</b>
          <div class="meta">${r.distanceKm} km · ${r.durationMin} min</div></div>
          <div class="badge ${r.riskPerKm < 1 ? 'hi' : r.riskPerKm < 3 ? 'mid' : 'lo'}" title="Risk per km">${r.riskPerKm}<div style="font-size:10px;font-weight:500">risk/km</div></div></div>
          ${r.zones.length ? `<div class="meta" style="margin-top:6px">Passes: ${r.zones.slice(0, 3).map((z) => esc(z.name)).join(', ')}</div>` : '<div class="meta" style="margin-top:6px">No known risk zones on this path</div>'}
        </div>`;
      })
      .join('');
  $$('[data-r]', host).forEach((c) => (c.onclick = () => { s.activeRoute = Number(c.dataset.r); renderRoutes(data); }));
}

/* ---------- Compare ---------- */
tabs.compare = async (host) => {
  clearLayers('zones', 'reports', 'route', 'traffic', 'places');
  setLegend('');
  await ensureAllPlaces();
  if (!state.weights) state.weights = { ...state.meta.weights };
  const w = state.weights;
  const wq = JSON.stringify(w);
  const [rank] = await Promise.all([api('/rank' + ctxQs({ category: state.filters.category, weights: wq }))]);
  let cmp = null;
  if (state.compare.length >= 2) cmp = await api('/compare' + ctxQs({ ids: state.compare.join(','), weights: wq }));
  const names = Object.values(state.placeIndex).sort((a, b) => a.name.localeCompare(b.name));
  const cats = ['all', ...state.meta.categories];

  host.innerHTML = `
    <h2>Best vs worst</h2>
    <p class="sub">Tune what matters to you; every ranking updates instantly.</p>
    <div class="card">
      ${Object.entries(PART_LABEL).map(([k, l]) => `<div class="slider-row"><span>${l}</span><input type="range" min="0" max="10" step="1" value="${Math.round(w[k] * 10)}" data-w="${k}"><b>${Math.round(w[k] * 10)}</b></div>`).join('')}
    </div>
    <div class="chips">${cats.map((c) => `<span class="chip ${state.filters.category === c ? 'on' : ''}" data-cat="${c}">${c === 'all' ? 'All' : c}</span>`).join('')}</div>

    <h3>🏆 Best</h3>${rank.best.map((p, i) => rankRow(p, i + 1)).join('')}
    <h3>⚠ Worst</h3>${rank.worst.map((p, i) => rankRow(p, i + 1)).join('')}

    <h3>Side-by-side</h3>
    <div class="row"><select id="addCmp"><option value="">Add a place (up to 3)…</option>${names.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select><button class="btn small" id="addBtn">Add</button></div>
    <div class="chips">${state.compare.map((id) => `<span class="chip on" data-rm="${esc(id)}">${esc(state.placeIndex[id]?.name || id)} ✕</span>`).join('')}</div>
    ${cmp ? cmpTable(cmp) : '<p class="sub">Select at least two places to compare. You can also use ⚖ Compare on any place card.</p>'}`;

  $$('input[data-w]', host).forEach((r) => {
    r.oninput = () => { r.nextElementSibling.textContent = r.value; };
    r.onchange = () => { state.weights[r.dataset.w] = Number(r.value) / 10; render(); };
  });
  $$('.chip[data-cat]', host).forEach((c) => (c.onclick = () => { state.filters.category = c.dataset.cat; render(); }));
  $('#addBtn').onclick = () => {
    const v = $('#addCmp').value;
    if (!v) return;
    if (state.compare.length >= 3 && !state.compare.includes(v)) return toast('You can compare up to 3 places');
    if (!state.compare.includes(v)) state.compare.push(v);
    render();
  };
  $$('[data-rm]', host).forEach((c) => (c.onclick = () => { state.compare = state.compare.filter((x) => x !== c.dataset.rm); render(); }));
  $$('[data-place]', host).forEach((c) => (c.onclick = () => { const p = state.placeIndex[c.dataset.place]; if (p) map.flyTo([p.lat, p.lng], 16); }));
  const shown = [...rank.best, ...rank.worst, ...(cmp ? cmp.places : [])];
  clearLayers('places');
  shown.forEach((p) => L.marker([p.lat, p.lng], { icon: pinIcon(p, false) }).addTo(layers.places).bindPopup(`<b>${esc(p.name)}</b><br>Score ${p.scores.composite}/10`));
};

function rankRow(p, i) {
  return `<div class="card click" data-place="${esc(p.id)}"><div class="top"><div><div class="name">${i}. ${esc(p.name)}</div>
    <div class="meta">${esc(p.category)} · ${esc(p.priceLabel)}</div></div><div class="badge ${scoreClass(p.scores.composite)}">${p.scores.composite}</div></div></div>`;
}

function cmpTable(c) {
  const rows = [...Object.keys(PART_LABEL), 'composite'];
  return `<table class="cmp"><thead><tr><th></th>${c.places.map((p) => `<th>${esc(p.name)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((k) => {
      const vals = c.places.map((p) => (k === 'composite' ? p.scores.composite : p.scores.parts[k]));
      const best = Math.max(...vals);
      return `<tr><td>${k === 'composite' ? '<b>Overall</b>' : PART_LABEL[k]}</td>${vals.map((v) => `<td class="${v === best ? 'win' : ''}">${v}</td>`).join('')}</tr>`;
    }).join('')}
    <tr><td>Price</td>${c.places.map((p) => `<td>${esc(p.priceLabel)}</td>`).join('')}</tr>
  </tbody></table>
  <p class="sub" style="margin-top:10px">Winner for your weights: <b style="color:var(--green)">${esc(state.placeIndex[c.winner]?.name || '')}</b></p>`;
}

/* ---------- Live ---------- */
tabs.live = async (host) => {
  clearLayers('places', 'route', 'zones', 'reports');
  setLegend('');
  const [ins, traffic, social, zones] = await Promise.all([api('/insights' + ctxQs()), api('/traffic' + ctxQs()), api('/social'), api('/zones' + ctxQs())]);
  clearLayers('traffic');
  traffic.corridors.forEach((c) => {
    const col = c.index >= 0.85 ? '#ff5d5d' : c.index >= 0.6 ? '#ff9f1c' : c.index >= 0.35 ? '#ffc857' : '#4cd964';
    L.circle([c.lat, c.lng], { radius: 350 + c.index * 500, color: col, fillColor: col, fillOpacity: 0.28, weight: 2 })
      .addTo(layers.traffic).bindPopup(`<b>${esc(c.name)}</b><br>${esc(c.level)} (${Math.round(c.index * 100)}%)`);
  });
  drawZones(zones.zones.filter((z) => z.activeNow), zones.hotspots);

  const mood = ins.stats.socialMood;
  host.innerHTML = `
    <h2>Right now in Pune</h2>
    <p class="sub">${ins.weather.condition}, ${Math.round(ins.weather.temperature)}° (feels ${Math.round(ins.weather.apparent)}°)${ins.weather.aqi != null ? ' · AQI ' + ins.weather.aqi : ''}${ins.weather.source === 'fallback-sample' ? ' <b>· sample data (weather API unreachable)</b>' : ''}</p>
    <div class="stats">
      <div class="stat"><b>${ins.stats.activeReports}</b><span>active citizen reports</span></div>
      <div class="stat"><b>${ins.stats.verified}</b><span>verified by community</span></div>
      <div class="stat"><b>${ins.stats.hotspots}</b><span>incident hotspots</span></div>
      <div class="stat"><b>${mood > 0.15 ? '😊' : mood < -0.15 ? '😟' : '😐'}</b><span>social mood (${mood})</span></div>
    </div>

    <h3>Alerts</h3>
    ${ins.alerts.length ? ins.alerts.map((a) => `<div class="alert ${a.level}" ${a.lat ? `data-fly="${a.lat},${a.lng}" style="cursor:pointer"` : ''}><b>${esc(a.title)}</b><span>${esc(a.text)}</span></div>`).join('') : '<p class="sub">No active alerts.</p>'}

    <h3>Smart picks for this moment</h3>
    ${ins.recommendations.map((r) => `<div class="card"><div class="name">${esc(r.title)}</div><div class="meta">${esc(r.why)}</div>
      ${r.places.map((p) => `<div class="row" style="margin-top:6px;cursor:pointer" data-fly="${p.lat},${p.lng}"><span>${EMOJI[p.category] || ''}</span><span>${esc(p.name)}</span><span class="tag" style="margin:0 0 0 auto">${p.scores.composite}</span></div>`).join('')}</div>`).join('')}

    <h3>Traffic (${esc(traffic.model)})</h3>
    ${traffic.corridors.map((c) => `<div style="margin-bottom:8px" data-fly="${c.lat},${c.lng}"><div class="row" style="justify-content:space-between"><span>${esc(c.name)}</span><span class="pill ${c.index >= 0.6 ? 'high' : c.index >= 0.35 ? 'medium' : 'low'}">${esc(c.level)}</span></div>
      <div class="bar ${c.index >= 0.6 ? 'bad' : c.index >= 0.35 ? 'mid' : ''}"><i style="width:${Math.round(c.index * 100)}%"></i></div></div>`).join('')}

    <h3>Social pulse</h3>
    ${social.items.slice(0, 6).map((s) => `<div class="card"><div class="meta">${esc(s.platform)} · ${esc(s.placeName || 'Pune')}</div><div>${esc(s.text)}</div>
      <span class="pill ${s.sentiment > 0.15 ? 'verified' : s.sentiment < -0.15 ? 'high' : 'low'}">${s.sentiment > 0.15 ? 'positive' : s.sentiment < -0.15 ? 'negative' : 'neutral'}</span></div>`).join('')}
    <div class="warn-note">Traffic uses a typical-congestion model boosted by live reports, and social posts are samples. Connect Google/TomTom traffic and a social API for production.</div>`;
  $$('[data-fly]', host).forEach((a) => (a.onclick = () => { const [la, ln] = a.dataset.fly.split(',').map(Number); map.flyTo([la, ln], 15); }));
};

/* ---------- Report ---------- */
let recorder = null;
let recognition = null;

function fileToResizedDataUrl(file, max = 900) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = url;
  });
}

const blobToDataUrl = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });

tabs.report = async (host) => {
  clearLayers('places', 'route', 'traffic', 'zones');
  setLegend('');
  const reports = (await api('/reports')).reports;
  drawReports(reports);
  const d = state.draft;
  host.innerHTML = `
    <h2>Report what you see</h2>
    <p class="sub">Potholes, floods, accidents, poor lighting, harassment, overcrowding or even something great. Photos, voice notes and community confirmations raise credibility.</p>
    <div class="card">
      <textarea id="rtext" maxlength="1000" placeholder="e.g. Streetlights off near Parvati hill steps, very dark and unsafe at night"></textarea>
      <div id="nlp" class="hint" style="margin:6px 0"></div>
      <div class="row">
        <button class="btn ghost small" id="mic">🎙 Voice note</button>
        <label class="btn ghost small" style="cursor:pointer">📷 Photo<input id="photo" type="file" accept="image/*" capture="environment" hidden></label>
        <button class="btn ghost small" id="loc">📍 My location</button>
      </div>
      <div class="hint" id="locinfo" style="margin-top:8px">${d.lat !== null ? `Location set (${d.lat.toFixed(4)}, ${d.lng.toFixed(4)})` : 'Tap the map to set the location'}</div>
      <div id="media"></div>
      <div class="row" style="margin-top:10px"><button class="btn" id="submit">Submit report</button></div>
      <div id="result"></div>
    </div>
    <h3>Recent reports (${reports.length})</h3>
    <div id="rlist">${reports.slice(0, 15).map(reportCard).join('')}</div>`;

  if (d.photo) $('#media').innerHTML = `<img class="photo-prev" src="${d.photo}" alt="Attached photo">`;
  drawPick();

  let t;
  $('#rtext').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(async () => {
      if (e.target.value.trim().length < 5) { $('#nlp').textContent = ''; return; }
      const a = await post('/nlp', { text: e.target.value });
      $('#nlp').innerHTML = `AI read: ${esc(a.icon)} <b>${esc(a.label)}</b> · urgency <span class="pill ${esc(a.urgencyLabel)}">${esc(a.urgencyLabel)}</span> · sentiment ${a.sentiment} · ${esc(a.language)}`;
    }, 350);
  });

  $('#loc').onclick = () => {
    if (!navigator.geolocation) return toast('Geolocation is not supported here');
    navigator.geolocation.getCurrentPosition(
      (pos) => { d.lat = pos.coords.latitude; d.lng = pos.coords.longitude; map.flyTo([d.lat, d.lng], 16); $('#locinfo').textContent = 'Location set from your device'; drawPick(); },
      () => toast('Could not read your location. Tap the map instead.'),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  $('#photo').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { d.photo = await fileToResizedDataUrl(f); $('#media').innerHTML = `<img class="photo-prev" src="${d.photo}" alt="Attached photo">`; }
    catch (err) { toast(err.message); }
  };

  $('#mic').onclick = async () => {
    const btn = $('#mic');
    if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (ev) => chunks.push(ev.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        recognition?.stop();
        btn.textContent = '🎙 Voice note ✓';
        d.audio = await blobToDataUrl(new Blob(chunks, { type: recorder.mimeType }));
        const prev = $('#media');
        prev.insertAdjacentHTML('beforeend', `<audio controls src="${d.audio}" style="width:100%;margin-top:8px"></audio>`);
      };
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        recognition = new SR();
        recognition.lang = 'en-IN';
        recognition.interimResults = false;
        recognition.continuous = true;
        recognition.onresult = (ev) => {
          const text = [...ev.results].map((r) => r[0].transcript).join(' ');
          d.transcript = text;
          const ta = $('#rtext');
          if (!ta.value.trim()) { ta.value = text; ta.dispatchEvent(new Event('input')); }
        };
        recognition.start();
      }
      recorder.start();
      btn.textContent = '⏹ Stop recording';
    } catch {
      toast('Microphone permission denied or unavailable');
    }
  };

  $('#submit').onclick = async () => {
    const text = $('#rtext').value.trim();
    if (text.length < 5) return toast('Please describe the issue first');
    if (d.lat === null) return toast('Set a location: tap the map or use My location');
    const btn = $('#submit');
    btn.disabled = true;
    try {
      const { report } = await post('/reports', { text, lat: d.lat, lng: d.lng, photo: d.photo, audio: d.audio, transcript: d.transcript });
      state.draft = { lat: null, lng: null, photo: null, audio: null, transcript: '' };
      toast('Report submitted. Thank you!');
      await render();
      $('#result').innerHTML = `<div class="alert" style="margin-top:10px"><b>${esc(report.nlp.icon)} Classified as ${esc(report.nlp.label)}</b><span>Urgency ${esc(report.nlp.urgencyLabel)} · credibility ${Math.round(report.credibility * 100)}% (${esc(report.status)}). Others can confirm it to raise trust.</span></div>`;
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  };

  $$('[data-confirm]', host).forEach((b) => (b.onclick = async () => {
    try { await post(`/reports/${b.dataset.confirm}/confirm`, {}); toast('Thanks for confirming'); render(); }
    catch (err) { toast(err.message); }
  }));
  $$('[data-fly]', host).forEach((a) => (a.onclick = (ev) => { if (ev.target.closest('button')) return; const [la, ln] = a.dataset.fly.split(',').map(Number); map.flyTo([la, ln], 16); }));
};

function reportCard(r) {
  return `<div class="card click" data-fly="${r.lat},${r.lng}">
    <div class="top"><div class="name">${esc(r.nlp.icon)} ${esc(r.nlp.label)}</div><span class="pill ${esc(r.status)}">${esc(r.status)}</span></div>
    <div style="margin-top:4px">${esc(r.text)}</div>
    ${r.photoUrl ? `<img class="photo-prev" style="max-height:140px" src="${esc(r.photoUrl)}" alt="Report photo">` : ''}
    ${r.audioUrl ? `<audio controls src="${esc(r.audioUrl)}" style="width:100%;margin-top:6px"></audio>` : ''}
    <div class="row" style="margin-top:6px;justify-content:space-between"><span class="hint">${r.ageHours}h ago · ${r.confirms} confirm${r.confirms === 1 ? '' : 's'} · credibility ${Math.round(r.credibility * 100)}%</span>
    <button class="btn ghost small" data-confirm="${esc(r.id)}">👍 Confirm</button></div></div>`;
}

/* =========================================================
   Router / wiring
   ========================================================= */
async function render() {
  const host = $('#content');
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  const scroll = host.scrollTop;
  try {
    await tabs[state.tab](host);
    host.scrollTop = scroll;
  } catch (err) {
    host.innerHTML = `<div class="alert warning"><b>Something went wrong</b><span>${esc(err.message)}</span></div>`;
  }
}

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  state.tab = b.dataset.tab;
  render();
});

// delegated clicks for place cards, compare toggles and route shortcuts
$('#content').addEventListener('click', (e) => {
  const cmp = e.target.closest('[data-cmp]');
  if (cmp) {
    e.stopPropagation();
    const id = cmp.dataset.cmp;
    if (state.compare.includes(id)) state.compare = state.compare.filter((x) => x !== id);
    else if (state.compare.length >= 3) return toast('You can compare up to 3 places');
    else state.compare.push(id);
    cmp.textContent = state.compare.includes(id) ? '✓ In compare' : '⚖ Compare';
    toast(`${state.compare.length} place${state.compare.length === 1 ? '' : 's'} in compare`);
    return;
  }
  const rt = e.target.closest('[data-route-to]');
  if (rt) {
    e.stopPropagation();
    const p = state.placeIndex[rt.dataset.routeTo];
    if (!p) return;
    state.safety.to = { lat: p.lat, lng: p.lng };
    state.safety.toPlace = p.id;
    state.safety.routes = null;
    state.tab = 'safety';
    render().then(() => toast('Destination set. Choose a start and tap Find safest route'));
    return;
  }
  const card = e.target.closest('[data-place]');
  if (card && !e.target.closest('button')) selectPlace(card.dataset.place);
});

map.on('click', (e) => {
  const { lat, lng } = e.latlng;
  if (state.tab === 'report') {
    state.draft.lat = lat;
    state.draft.lng = lng;
    const info = $('#locinfo');
    if (info) info.textContent = `Location set (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    drawPick();
  } else if (state.tab === 'safety' && state.safety.pick) {
    state.safety[state.safety.pick] = { lat, lng };
    state.safety.pick = null;
    const hint = $('#pickHint');
    if (hint) hint.textContent = 'Point set';
    drawPick();
  }
});

$('#panelToggle').onclick = () => $('.app').classList.toggle('map-big');

async function boot() {
  state.meta = await api('/meta');
  state.reportCats = state.meta.reportCategories;
  try {
    state.weather = await api('/weather');
    const ins = await api('/insights');
    const wx = ins.weather;
    $('#liveChip').textContent = `${Math.round(wx.temperature)}° ${wx.condition}${wx.aqi != null ? ' · AQI ' + wx.aqi : ''} · ${ins.alerts.length} alert${ins.alerts.length === 1 ? '' : 's'}`;
  } catch {
    $('#liveChip').textContent = 'offline mode';
  }
  render();
}
boot();
