<<<<<<< HEAD
# CityPulse Pune

A smart city-exploration platform that turns scattered city data into verified, actionable insights: discover places, learn the history, avoid unsafe areas, compare the best and worst spots, and see live conditions.

## Run it

```bash
npm install
npm start          # http://localhost:3000
npm test           # API smoke tests
```

Requires Node 18+ (uses built-in `fetch`). No database or API keys needed.

## How it maps to the challenge

| Challenge pillar | What's built |
|---|---|
| **Exploration & hospitality** | Attractions, food, hotels, markets, parks with search, budget-friendly and indoor filters, sorting. |
| **History & culture** | Landmark timeline with histories, plus living traditions and festivals. |
| **Safety & security** | Risk zones (accident, crime, flood, crowd, lighting) that switch on/off with **time of day and rain**; citizen-report hotspots; **safest-route** finder that scores alternatives against zones and live reports. |
| **Best vs worst** | Composite score from safety, cleanliness, affordability, ratings and accessibility with **user-tunable weights**; best/worst leaderboards; side-by-side compare. |
| **Smart city insights** | Weather and AQI alerts (Open-Meteo), traffic model, citizen reports with photos and voice notes, social sentiment, and context-aware "smart picks" for right now. |

## The AI / data pieces

- **NLP (`lib/nlp.js`)**: classifies free-text reports (accident, crime, flooding, lighting, road damage, garbage, traffic, crowd, positive) with sentiment (negation-aware), urgency and language hint (English, Hinglish/Marathi words, Devanagari). Dependency-free and swappable for an LLM or a hosted model.
- **Credibility engine (`lib/reports.js`)**: each report gets a 0-1 score from photo/voice evidence, community confirmations and corroboration by other reports within 300 m / 24 h; weight decays with age. Becomes `verified` / `likely` / `unverified`.
- **Risk model (`lib/risk.js`)**: zone severity × distance falloff × context factor (night, rain) + live report penalties.
- **Safe routing (`lib/routing.js`)**: fetches alternatives from OSRM, samples each path every ~100 m, sums risk, and picks the lowest-risk route that is not unreasonably slower.
- **Scoring (`lib/scoring.js`)**: composite score with log-scaled affordability and dynamic safety adjusted by nearby live risk.
- **Hotspots**: greedy clustering of recent reports.
- **Voice notes**: recorded with `MediaRecorder` and transcribed in-browser via the Web Speech API where supported.

## Honest limitations (and the production path)

- **Seed data is illustrative.** Place coordinates are approximate, and risk zones, seeded reports and social posts are samples, not official records. Wire in police/NCRB, traffic police, PMC/PCMC and OpenStreetMap/Overpass data for production.
- **Traffic is a model, not a live feed.** It is a typical-congestion profile boosted by nearby reports. Swap `lib/traffic.js` for Google Routes, TomTom or HERE.
- **Routing uses the public OSRM demo server** (driving profile only). If it's unreachable the app falls back to clearly-labelled demo geometry. Self-host OSRM/Valhalla for walking and reliability.
- **Weather** comes from Open-Meteo; if unreachable, labelled sample data is shown.
- **Reports** persist to `data/user-reports.json` and uploads to `data/uploads/`. Anyone can post and confirm, with only basic in-memory rate limiting. Add auth, moderation, abuse detection and a real database before launch.

## Project layout

```
server.js            Express API + static hosting
lib/                 nlp, reports, risk, scoring, routing, traffic, weather, geo, seed
data/                places, zones, corridors, traditions (JSON)
public/              index.html, app.js (Leaflet UI), styles.css
test/smoke.js        end-to-end API checks
```

## API

`GET /api/places` (`category,q,budget,indoor,sort,weights`) · `/api/places/:id` · `/api/compare?ids=` · `/api/rank` · `/api/zones` · `/api/reports` (+ `POST`, `POST /:id/confirm`) · `POST /api/nlp` · `/api/route?from=lat,lng&to=lat,lng` · `/api/weather` · `/api/traffic` · `/api/social` · `/api/traditions` · `/api/insights`

Most endpoints accept `?hour=0-23&rain=0|1` to simulate a time of day or weather scenario.
=======
# prompt_wars
>>>>>>> 3467d12fc17c318c65df811c752e8653bad731a3
