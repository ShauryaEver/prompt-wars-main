'use strict';

/** Smoke test: boots the app on a random port and exercises every API endpoint. */
const assert = require('assert');
const app = require('../server');

(async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p) => {
    const r = await fetch(base + p);
    return { status: r.status, body: await r.json() };
  };
  let failures = 0;
  const check = async (name, fn) => {
    try { await fn(); console.log('ok  ', name); }
    catch (e) { failures++; console.log('FAIL', name, '-', e.message); }
  };

  await check('meta', async () => {
    const { body } = await get('/api/meta');
    assert.strictEqual(body.city, 'Pune');
  });
  await check('places list + scores', async () => {
    const { body } = await get('/api/places?category=food&sort=score');
    assert(body.count >= 5);
    assert(body.places[0].scores.composite >= body.places[body.places.length - 1].scores.composite);
  });
  await check('budget + indoor filters', async () => {
    const { body } = await get('/api/places?budget=1&indoor=1');
    assert(body.places.every((p) => p.indoor && p.scores.parts.affordability >= 7));
  });
  await check('place detail', async () => {
    const { status, body } = await get('/api/places/shaniwar-wada');
    assert.strictEqual(status, 200);
    assert(body.scores && Array.isArray(body.nearbyZones));
  });
  await check('place 404', async () => assert.strictEqual((await get('/api/places/nope')).status, 404));
  await check('compare', async () => {
    const { body } = await get('/api/compare?ids=vaishali,cafe-goodluck,bedekar-misal');
    assert.strictEqual(body.places.length, 3);
    assert(body.winner);
  });
  await check('rank best/worst', async () => {
    const { body } = await get('/api/rank?category=hotel');
    assert(body.best.length && body.worst.length);
    assert(body.best[0].scores.composite >= body.worst[0].scores.composite);
  });
  await check('night raises danger near station vs day', async () => {
    const night = (await get('/api/zones?hour=23&rain=0')).body;
    const day = (await get('/api/zones?hour=12&rain=0')).body;
    assert(night.zones.find((z) => z.id === 'station-night').activeNow);
    assert(!day.zones.find((z) => z.id === 'station-night').activeNow);
  });
  await check('rain activates flood zones', async () => {
    const wet = (await get('/api/zones?hour=12&rain=1')).body;
    assert(wet.zones.find((z) => z.id === 'sinhagad-road-flood').activeNow);
  });
  await check('hotspots exist', async () => {
    const { body } = await get('/api/zones');
    assert(body.hotspots.length >= 1);
  });
  await check('nlp classify', async () => {
    const r = await fetch(base + '/api/nlp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Big accident at the junction, someone injured, ambulance needed now!' }) });
    const b = await r.json();
    assert.strictEqual(b.category, 'accident');
    assert.strictEqual(b.urgencyLabel, 'high');
  });
  await check('nlp: pothole with skidding bikes is road damage, not accident', async () => {
    const r = await fetch(base + '/api/nlp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Huge pothole near FC Road, bikes skidding' }) });
    assert.strictEqual((await r.json()).category, 'pothole');
  });
  await check('nlp negation', async () => {
    const r = await fetch(base + '/api/nlp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'This place is not clean at all' }) });
    assert((await r.json()).sentiment < 0);
  });
  await check('submit report + validation', async () => {
    const bad = await fetch(base + '/api/reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x', lat: 1, lng: 1 }) });
    assert.strictEqual(bad.status, 400);
    const ok = await fetch(base + '/api/reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Pothole near FC Road crossing, very deep', lat: 18.5231, lng: 73.8415 }) });
    assert.strictEqual(ok.status, 201);
    const { report } = await ok.json();
    assert.strictEqual(report.category, 'pothole');
    const c = await fetch(base + `/api/reports/${report.id}/confirm`, { method: 'POST' });
    assert.strictEqual(c.status, 200);
    const dup = await fetch(base + `/api/reports/${report.id}/confirm`, { method: 'POST' });
    assert.strictEqual(dup.status, 409);
    // cleanup test data
    require('fs').rmSync(require('path').join(__dirname, '..', 'data', 'user-reports.json'), { force: true });
  });
  await check('route (osrm or fallback) returns fastest + safest', async () => {
    const { status, body } = await get('/api/route?from=18.5195,73.8553&to=18.5522,73.9018&hour=23');
    assert.strictEqual(status, 200);
    assert(body.routes.length >= 1);
    assert(body.routes.find((r) => r.tags.includes('fastest')));
    assert(body.routes.find((r) => r.tags.includes('safest')));
    console.log('     route source:', body.source, '|', body.summary);
  });
  await check('route bad input', async () => assert.strictEqual((await get('/api/route?from=a&to=b')).status, 400));
  await check('weather', async () => {
    const { body } = await get('/api/weather');
    assert(typeof body.temperature === 'number');
    console.log('     weather source:', body.source);
  });
  await check('traffic rush hour > 3am', async () => {
    const rush = (await get('/api/traffic?hour=18')).body.corridors;
    const quiet = (await get('/api/traffic?hour=3')).body.corridors;
    const avg = (c) => c.reduce((s, x) => s + x.index, 0) / c.length;
    assert(avg(rush) > avg(quiet));
  });
  await check('social pulse', async () => {
    const { body } = await get('/api/social');
    assert(body.items.length && body.mood.length);
  });
  await check('insights', async () => {
    const { body } = await get('/api/insights');
    assert(body.recommendations.length && body.stats);
  });

  server.close();
  console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
