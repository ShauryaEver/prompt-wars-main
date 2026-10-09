'use strict';

/**
 * Lightweight, dependency-free NLP for citizen reports and social posts.
 * Handles English plus common Hinglish/Marathi words and Devanagari script hints.
 * Output: category, sentiment (-1..1), urgency (0..1), keywords, language hint.
 */

const CATEGORIES = {
  accident: {
    label: 'Accident', icon: '🚨', severity: 4, urgency: 0.7, zone: 'accident',
    words: ['accident', 'crash', 'collision', 'collided', 'overturned', 'hit and run', 'injured', 'ambulance', 'rammed', 'fatal'],
  },
  crime: {
    label: 'Crime / harassment', icon: '🛑', severity: 4, urgency: 0.7, zone: 'crime',
    words: ['theft', 'stolen', 'snatch', 'robbed', 'robbery', 'pickpocket', 'harass', 'eve teasing', 'stalk', 'molest', 'assault', 'chor', 'unsafe', 'threat', 'drunk'],
  },
  flooding: {
    label: 'Flooding / waterlogging', icon: '🌊', severity: 3, urgency: 0.6, zone: 'flood',
    words: ['flood', 'waterlog', 'water log', 'submerged', 'knee-deep', 'knee deep', 'pani bhar', 'overflow', 'inundat'],
  },
  lighting: {
    label: 'Poor lighting', icon: '💡', severity: 2, urgency: 0.3, zone: 'lighting',
    words: ['dark', 'streetlight', 'street light', 'no light', 'lights off', 'unlit', 'andhera', 'poorly lit', 'poor lighting'],
  },
  pothole: {
    label: 'Road damage', icon: '🕳️', severity: 2, urgency: 0.3, zone: 'road',
    words: ['pothole', 'potholes', 'road damage', 'crater', 'broken road', 'khadda', 'khadde', 'caved', 'uneven road'],
  },
  garbage: {
    label: 'Cleanliness issue', icon: '🗑️', severity: 1, urgency: 0.15, zone: 'clean',
    words: ['garbage', 'trash', 'litter', 'dirty', 'stink', 'sewage', 'kachra', 'smell', 'overflowing bin', 'open drain'],
  },
  traffic: {
    label: 'Traffic jam', icon: '🚦', severity: 1.5, urgency: 0.3, zone: 'traffic',
    words: ['traffic', 'jam', 'congestion', 'standstill', 'gridlock', 'slow-moving', 'slow moving', 'blocked', 'diversion', 'gardi'],
  },
  crowd: {
    label: 'Overcrowding', icon: '👥', severity: 1.5, urgency: 0.4, zone: 'crowd',
    words: ['crowded', 'overcrowded', 'stampede', 'rush', 'packed', 'long queue', 'huge crowd'],
  },
};

const POSITIVE = ['clean', 'safe', 'well-lit', 'well lit', 'friendly', 'great', 'lovely', 'amazing', 'tasty', 'delicious',
  'beautiful', 'peaceful', 'good', 'excellent', 'worth', 'love', 'best', 'nice', 'smooth', 'helpful', 'maja', 'zakas'];
const NEGATIVE = ['bad', 'worst', 'terrible', 'avoid', 'dangerous', 'scary', 'awful', 'unsafe', 'dirty', 'rude', 'scam',
  'overpriced', 'horrible', 'stink', 'broken', 'poor', 'slow', 'blocked', 'injured', 'accident', 'flood', 'theft',
  'harass', 'jam', 'worse', 'disgusting', 'pathetic'];
const NEGATIONS = ['not', 'no', "isn't", 'isnt', "wasn't", 'never', "don't", 'dont', 'nahi', 'nahin'];
const URGENT_WORDS = ['urgent', 'emergency', 'help', 'fire', 'trapped', 'injured', 'ambulance', 'now', 'immediately', 'bleeding', 'asap'];

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\- ]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function detectLanguage(text) {
  if (/[ऀ-ॿ]/.test(text)) return 'mr/hi (Devanagari)';
  if (/\b(khadda|kachra|pani|gardi|andhera|chor|nahi|maja|zakas)\b/i.test(text)) return 'en + hinglish/marathi';
  return 'en';
}

function sentimentOf(tokens) {
  let score = 0;
  let hits = 0;
  tokens.forEach((tok, i) => {
    let val = 0;
    if (POSITIVE.includes(tok)) val = 1;
    else if (NEGATIVE.includes(tok) || NEGATIVE.some((n) => tok.startsWith(n) && n.length > 4)) val = -1;
    if (!val) return;
    const window = tokens.slice(Math.max(0, i - 2), i);
    if (window.some((w) => NEGATIONS.includes(w))) val = -val;
    score += val;
    hits += 1;
  });
  if (!hits) return 0;
  return Math.max(-1, Math.min(1, score / Math.max(2, hits)));
}

function analyze(text) {
  const clean = String(text || '').trim();
  const lower = clean.toLowerCase();
  const tokens = tokenize(clean);
  const scores = {};
  const matched = [];

  for (const [key, def] of Object.entries(CATEGORIES)) {
    let s = 0;
    for (const w of def.words) {
      if (lower.includes(w)) {
        s += w.includes(' ') ? 2 : 1;
        matched.push(w);
      }
    }
    if (s) scores[key] = s;
  }

  const sentiment = sentimentOf(tokens);
  let category = 'other';
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (ranked.length) category = ranked[0][0];
  // A clearly positive post with only weak "problem" words is treated as positive feedback.
  if (sentiment > 0.4 && (!ranked.length || ranked[0][1] < 2)) category = 'positive';
  if (!ranked.length && sentiment > 0) category = 'positive';

  const def = CATEGORIES[category];
  let urgency = def ? def.urgency : 0.1;
  const urgentHits = URGENT_WORDS.filter((w) => tokens.includes(w)).length;
  urgency += Math.min(0.3, urgentHits * 0.12);
  if ((clean.match(/!/g) || []).length >= 2) urgency += 0.05;
  if (category === 'positive') urgency = 0.05;
  urgency = Math.max(0, Math.min(1, urgency));

  return {
    category,
    label: def ? def.label : category === 'positive' ? 'Positive feedback' : 'General note',
    icon: def ? def.icon : category === 'positive' ? '✅' : '📝',
    severity: def ? def.severity : 0,
    sentiment: Number(sentiment.toFixed(2)),
    urgency: Number(urgency.toFixed(2)),
    urgencyLabel: urgency >= 0.7 ? 'high' : urgency >= 0.4 ? 'medium' : 'low',
    keywords: [...new Set(matched)].slice(0, 6),
    language: detectLanguage(clean),
  };
}

const severityOf = (category) => (CATEGORIES[category] ? CATEGORIES[category].severity : 0);

module.exports = { analyze, CATEGORIES, severityOf };
