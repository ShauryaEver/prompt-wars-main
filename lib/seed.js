'use strict';

/**
 * Illustrative seed data so the app is useful offline and for demos.
 * Seeded reports are regenerated on each boot (relative to "now") and are NOT persisted;
 * real citizen submissions are saved to data/user-reports.json.
 *
 * These entries are samples, not real incident records.
 */

const H = 3600 * 1000;

const reportSeeds = [
  { text: 'Huge pothole near the Navale Bridge exit, two bikes skidded this morning', lat: 18.4562, lng: 73.8236, hoursAgo: 3, confirms: 5, photo: true },
  { text: 'Accident at Chandni Chowk, truck overturned, police are diverting traffic', lat: 18.5088, lng: 73.7912, hoursAgo: 1.5, confirms: 7, photo: true },
  { text: 'Chandni Chowk completely jammed, standstill from Bavdhan side', lat: 18.5094, lng: 73.7920, hoursAgo: 1.2, confirms: 3, photo: false },
  { text: 'Knee-deep waterlogging near Warje underpass, avoid this road', lat: 18.4833, lng: 73.8028, hoursAgo: 5, confirms: 4, photo: true },
  { text: 'Streetlights are off on Parvati hill approach, very dark and unsafe at night', lat: 18.4979, lng: 73.8421, hoursAgo: 10, confirms: 2, photo: false },
  { text: 'Chain snatching attempt near Swargate bus stand, please be careful', lat: 18.5020, lng: 73.8641, hoursAgo: 8, confirms: 3, photo: false },
  { text: 'Garbage pile and bad smell near Tulshibaug market entrance', lat: 18.5146, lng: 73.8556, hoursAgo: 20, confirms: 2, photo: true },
  { text: 'Laxmi Road extremely crowded today, long queue and almost a stampede near Belbaug', lat: 18.5152, lng: 73.8533, hoursAgo: 2, confirms: 2, photo: false },
  { text: 'Pataleshwar cave temple was clean and peaceful, loved the quiet', lat: 18.5281, lng: 73.8468, hoursAgo: 12, confirms: 1, photo: true },
  { text: 'Pothole near Hadapsar Gadital flyover, two-wheelers swerving', lat: 18.4992, lng: 73.9306, hoursAgo: 6, confirms: 1, photo: false },
  { text: 'Guy was drunk and harassing women outside the station at night', lat: 18.5286, lng: 73.8748, hoursAgo: 14, confirms: 2, photo: false },
  { text: 'Sinhagad road flooding near Rajaram bridge, water on the carriageway', lat: 18.4885, lng: 73.8255, hoursAgo: 4, confirms: 6, photo: true },
  { text: 'FC Road lanes smooth today and very clean footpaths, nice evening walk', lat: 18.5230, lng: 73.8412, hoursAgo: 9, confirms: 0, photo: false },
  { text: 'Accident, bike hit a rickshaw at Hadapsar flyover, ambulance called!!', lat: 18.4989, lng: 73.9314, hoursAgo: 0.7, confirms: 1, photo: false },
];

const socialSeeds = [
  { platform: 'x', text: 'Shaniwar Wada light show is amazing, beautiful and worth it!', lat: 18.5195, lng: 73.8553, hoursAgo: 5 },
  { platform: 'instagram', text: 'Bun maska at Cafe Goodluck is the best, great vibes, love this place', lat: 18.5167, lng: 73.8423, hoursAgo: 9 },
  { platform: 'reddit', text: 'Tulshibaug is so crowded and dirty on weekends, avoid if you hate rush', lat: 18.5148, lng: 73.8552, hoursAgo: 7 },
  { platform: 'x', text: 'Navale bridge again, another accident this week, dangerous stretch!', lat: 18.4570, lng: 73.8240, hoursAgo: 2 },
  { platform: 'instagram', text: 'Sinhagad sunrise trek was peaceful and beautiful', lat: 18.3663, lng: 73.7558, hoursAgo: 28 },
  { platform: 'reddit', text: 'Zostel Pune was clean and helpful staff, good value hostel', lat: 18.5303, lng: 73.8740, hoursAgo: 40 },
  { platform: 'x', text: 'Bedekar misal is delicious but the queue is huge, worth it', lat: 18.5133, lng: 73.8498, hoursAgo: 3 },
  { platform: 'reddit', text: 'Station area at night feels unsafe, rude touts and dark lanes', lat: 18.5289, lng: 73.8744, hoursAgo: 15 },
  { platform: 'x', text: 'Sagar Plaza rooms are not clean, slow service, overpriced', lat: 18.5290, lng: 73.8753, hoursAgo: 30 },
  { platform: 'instagram', text: 'Aga Khan Palace gardens are lovely, peaceful and clean', lat: 18.5522, lng: 73.9018, hoursAgo: 22 },
  { platform: 'reddit', text: 'Kayani bakery biscuits great, a nice heritage spot', lat: 18.5133, lng: 73.8776, hoursAgo: 18 },
  { platform: 'x', text: 'Parvati hill steps are not safe after dark, poor lighting', lat: 18.4976, lng: 73.8426, hoursAgo: 11 },
];

function buildReports(now = Date.now()) {
  return reportSeeds.map((r, i) => ({
    id: `seed-${i + 1}`,
    text: r.text,
    lat: r.lat,
    lng: r.lng,
    ts: now - r.hoursAgo * H,
    confirms: r.confirms,
    hasPhoto: r.photo,
    hasVoice: false,
    seed: true,
  }));
}

function buildSocial(now = Date.now()) {
  return socialSeeds.map((s, i) => ({ id: `soc-${i + 1}`, ...s, ts: now - s.hoursAgo * H }));
}

module.exports = { buildReports, buildSocial };
