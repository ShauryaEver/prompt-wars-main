'use strict';

const fs = require('fs');
const path = require('path');
const { haversine } = require('./geo');
const { analyze, CATEGORIES, severityOf } = require('./nlp');
const seed = require('./seed');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USER_FILE = path.join(DATA_DIR, 'user-reports.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

let userReports = null;
const bootSeed = seed.buildReports();

function loadUser() {
  if (userReports) return userReports;
  try {
    userReports = JSON.parse(fs.readFileSync(USER_FILE, 'utf8'));
  } catch {
    userReports = [];
  }
  return userReports;
}

function saveUser() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USER_FILE, JSON.stringify(userReports, null, 1));
}

function rawAll() {
  return [...bootSeed, ...loadUser()];
}

const H = 3600 * 1000;

/**
 * Credibility model (0-1):
 *  base 0.30 + photo 0.15 + voice 0.05 + community confirms (up to 0.30)
 *  + corroboration by other same-category reports within 300 m / 24 h (up to 0.20)
 * Weight decays with age so stale reports fade out of the risk maps.
 */
function enrich(report, all, now = Date.now()) {
  const nlp = analyze(report.text);
  const category = report.category && CATEGORIES[report.category] ? report.category : nlp.category;
  const ageH = Math.max(0, (now - report.ts) / H);

  const corroborating = all.filter(
    (o) =>
      o.id !== report.id &&
      Math.abs(o.ts - report.ts) < 24 * H &&
      haversine(o, report) <= 300 &&
      (o.category && CATEGORIES[o.category] ? o.category : analyze(o.text).category) === category
  ).length;

  let cred = 0.3;
  if (report.hasPhoto) cred += 0.15;
  if (report.hasVoice) cred += 0.05;
  cred += Math.min(0.3, (report.confirms || 0) * 0.06);
  cred += Math.min(0.2, corroborating * 0.1);
  cred = Math.min(1, cred);

  const status = cred >= 0.7 ? 'verified' : cred >= 0.5 ? 'likely' : 'unverified';
  const weight = category === 'positive' ? 0 : cred * Math.exp(-ageH / 36);

  return {
    ...report,
    category,
    nlp: { ...nlp, category },
    ageHours: Number(ageH.toFixed(1)),
    corroborating,
    credibility: Number(cred.toFixed(2)),
    status,
    weight: Number(weight.toFixed(3)),
    active: ageH < 72,
  };
}

function list({ activeOnly = false, category, now = Date.now() } = {}) {
  const all = rawAll();
  let out = all.map((r) => enrich(r, all, now));
  if (activeOnly) out = out.filter((r) => r.active);
  if (category) out = out.filter((r) => r.category === category);
  return out.sort((a, b) => b.ts - a.ts);
}

function parseDataUrl(dataUrl) {
  const m = /^data:((?:image\/(?:png|jpe?g|webp))|(?:audio\/[\w.+-]+));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) return null;
  const mime = m[1];
  const ext = mime.startsWith('audio/')
    ? mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm'
    : mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  return { mime, ext, buf: Buffer.from(m[2], 'base64') };
}

function add({ text, category, lat, lng, photo, audio, transcript }) {
  const id = `u-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const report = {
    id,
    text: String(text || '').slice(0, 1000),
    lat: Number(lat),
    lng: Number(lng),
    ts: Date.now(),
    confirms: 0,
    hasPhoto: false,
    hasVoice: false,
    seed: false,
  };
  if (category && CATEGORIES[category]) report.category = category;
  if (transcript) report.transcript = String(transcript).slice(0, 1000);

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const p = parseDataUrl(photo);
  if (p && p.buf.length < 4 * 1024 * 1024) {
    fs.writeFileSync(path.join(UPLOAD_DIR, `${id}.${p.ext}`), p.buf);
    report.hasPhoto = true;
    report.photoUrl = `/uploads/${id}.${p.ext}`;
  }
  const a = parseDataUrl(audio);
  if (a && a.buf.length < 6 * 1024 * 1024) {
    fs.writeFileSync(path.join(UPLOAD_DIR, `${id}-voice.${a.ext}`), a.buf);
    report.hasVoice = true;
    report.audioUrl = `/uploads/${id}-voice.${a.ext}`;
  }

  loadUser().push(report);
  saveUser();
  const all = rawAll();
  return enrich(report, all);
}

function confirm(id) {
  const all = rawAll();
  const r = all.find((x) => x.id === id);
  if (!r) return null;
  r.confirms = (r.confirms || 0) + 1;
  if (!r.seed) saveUser();
  return enrich(r, all);
}

/** Greedy clustering of active reports into hotspots (≈300 m). */
function hotspots({ minReports = 2, now = Date.now() } = {}) {
  const items = list({ activeOnly: true, now }).filter((r) => r.category !== 'positive' && r.category !== 'other');
  const used = new Set();
  const out = [];
  for (const r of items) {
    if (used.has(r.id)) continue;
    const members = items.filter((o) => !used.has(o.id) && haversine(o, r) <= 300);
    members.forEach((m) => used.add(m.id));
    if (members.length < minReports) continue;
    const lat = members.reduce((s, m) => s + m.lat, 0) / members.length;
    const lng = members.reduce((s, m) => s + m.lng, 0) / members.length;
    const counts = {};
    members.forEach((m) => (counts[m.category] = (counts[m.category] || 0) + 1));
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const score = members.reduce((s, m) => s + m.weight * (severityOf(m.category) || 1), 0);
    out.push({
      lat, lng, count: members.length, topCategory: top,
      label: CATEGORIES[top] ? CATEGORIES[top].label : top,
      icon: CATEGORIES[top] ? CATEGORIES[top].icon : '📍',
      score: Number(score.toFixed(2)),
      ids: members.map((m) => m.id),
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

module.exports = { list, add, confirm, hotspots };
