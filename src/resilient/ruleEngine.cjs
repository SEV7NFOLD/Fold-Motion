'use strict';
/**
 * SEV7N FOLD — deterministic storyboard engine (final fallback tier).
 *
 * Pure JS: no network, no I/O, no async. Same brief in => same storyboard out.
 * generateStoryboard() NEVER throws; worst case it returns a static 3-scene board.
 *
 * Tune detection by editing the `keywords` weights per niche.
 * Add a niche by adding one entry to NICHES (hook / reveal / 3 details / proof / cta).
 */

const b = (shot, camera, motion, text, vo) => ({ shot, camera, motion, text, vo });

const NICHES = {
  hospitality: {
    label: 'Hotel & Hospitality',
    keywords: { hotel: 4, resort: 4, 'boutique hotel': 5, suite: 3, hospitality: 4, villa: 2, lodge: 3, guest: 2, booking: 2, 'room service': 3, spa: 2, concierge: 3, lobby: 2, 'bed and breakfast': 4, stay: 1 },
    palette: ['#0E0E10', '#C8A96A', '#F4EFE6'],
    music: 'Warm cinematic ambient, soft piano, slow build',
    tone: 'Aspirational, calm, tactile luxury',
    hook: b('Macro of a key card sliding into a door as warm light spills out', 'Slow push-in', 'Light bloom reveal', 'Arrive. Exhale.', 'Some places you visit. Others you feel.'),
    reveal: b('Wide of {brand} exterior at golden hour, cut to a lobby glide-through', 'Gimbal glide', 'Parallax depth on foreground elements', 'Welcome to {brand}', '{brand}: every detail arranged for your comfort.'),
    details: [
      b('Suite reveal: crisp linens, window light, curtains drifting', 'Slow tilt-up', 'Soft focus pull', 'Rooms made for rest', 'Wake up to a view worth remembering.'),
      b('Dining and spa montage with steam, candlelight and fresh flowers', 'Slider left-to-right', 'Staggered text rise', 'Taste. Unwind. Repeat.', 'From the first coffee to the last glass of the night.'),
      b('Pool or rooftop at dusk, lights flickering on', 'Wide dolly-out', 'Light-leak transition', 'Golden hour, every hour', 'The evening begins when you decide it does.'),
    ],
    proof: b('Guests laughing over breakfast, rating badge slides in', 'Handheld close-up', 'Review card slide-in', 'Loved by guests worldwide', 'Guests don’t just stay. They return.'),
    cta: b('Logo lockup over the hero exterior', 'Locked-off', 'Soft logo reveal', 'Book your stay', 'Reserve your stay at {brand}.'),
  },

  real_estate: {
    label: 'Real Estate',
    keywords: { 'real estate': 5, property: 3, properties: 3, listing: 3, realtor: 4, apartment: 3, penthouse: 3, condo: 3, residence: 3, 'for sale': 3, 'show home': 3, developer: 2, estate: 2, mortgage: 2, homes: 2, home: 1 },
    palette: ['#101418', '#E3B04B', '#F7F5F0'],
    music: 'Confident modern orchestral-pop with light percussion',
    tone: 'Aspirational, trustworthy, spacious',
    hook: b('Drone rise over the neighbourhood at sunrise', 'Drone ascent', 'Speed-ramp toward the building', 'Your next chapter starts here', 'Every great story starts with the right address.'),
    reveal: b('Front door opens into a light-filled living space', 'Steadicam walk-through', 'Match-cut door to door', 'Meet {brand}', '{brand}: space, light and a place to belong.'),
    details: [
      b('Kitchen island hero shot in morning light', 'Slider left-to-right', 'Staggered text rise', 'Designed for how you live', 'Room to cook, host and unwind.'),
      b('Primary suite and bathroom detail', 'Slow tilt-up', 'Soft zoom', 'Quiet, private, yours', 'A retreat built into the everyday.'),
      b('Balcony or garden at golden hour', 'Wide dolly-out', 'Floor-plan overlay draws in', 'Room to grow', 'Outdoor space that extends the home.'),
    ],
    proof: b('Handover moment: keys, a smiling family', 'Handheld close-up', 'Counter animates to buyer stats', 'Trusted by hundreds of homeowners', 'Families who chose {brand} never looked back.'),
    cta: b('Aerial pull-back with logo and contact details', 'Drone pull-back', 'Logo mask reveal', 'Book a private viewing', 'Book your private viewing with {brand} today.'),
  },

  agency: {
    label: 'Agency & Creative Studio',
    keywords: { agency: 4, 'digital agency': 5, studio: 2, branding: 3, marketing: 3, creative: 2, portfolio: 3, campaign: 2, 'web design': 3, strategy: 2, 'social media': 3, seo: 3, 'motion graphics': 3, brand: 1 },
    palette: ['#0A0A0A', '#FF4D2E', '#FFFFFF'],
    music: 'Driving electronic beat with tight percussive hits',
    tone: 'Bold, kinetic, confident',
    hook: b('Kinetic typography slams a claim over rapid screen cuts', 'Hard cuts on the beat', 'Text smash-in with shake', 'Brands don’t grow by accident', 'Growth is designed.'),
    reveal: b('Studio team at work: glowing screens, whiteboard strategy', 'Handheld orbit', 'Split-screen wipes', 'This is {brand}', '{brand}: strategy, design and motion under one roof.'),
    details: [
      b('Portfolio carousel: device mockups sliding past', 'Lateral tracking', 'Grid-based UI motion', 'Websites that convert', 'Design that earns attention and keeps it.'),
      b('Analytics dashboard counting up', 'Push-in on screen', 'Number counters tick up', 'Strategy backed by data', 'Every decision measured. Every result visible.'),
      b('Brand identity system assembling piece by piece', 'Top-down', 'Elements snap into a grid', 'Identity with intent', 'A system, not just a logo.'),
    ],
    proof: b('Client logo wall with a before/after stat', 'Static with micro-parallax', 'Logo marquee and counter', 'Results that speak', 'Real clients. Real growth.'),
    cta: b('Logo lockup on a bold colour field', 'Locked-off', 'Glitch-in logo', 'Let’s build what’s next', 'Talk to {brand}.'),
  },

  restaurant: {
    label: 'Restaurant & Food',
    keywords: { restaurant: 4, 'fine dining': 5, cafe: 3, café: 3, bistro: 3, menu: 2, chef: 3, dining: 3, food: 2, cocktail: 2, bakery: 3, catering: 3, coffee: 2, kitchen: 1 },
    palette: ['#1A0F0A', '#D9822B', '#FBF3E4'],
    music: 'Warm acoustic groove with subtle jazz brushes',
    tone: 'Sensory, warm, appetising',
    hook: b('Macro: sauce pour and steam rising off a fresh plate', 'Macro slider', 'Slow-motion pour', 'Taste it before you see it', 'Some flavours stay with you.'),
    reveal: b('Chef plating in an open kitchen, flames and motion', 'Handheld close', 'Whip-pan transitions', 'Welcome to {brand}', 'At {brand}, every plate has a story.'),
    details: [
      b('Signature dish rotating hero shot', 'Overhead cut to 45°', 'Ingredient labels pop in', 'Made from scratch', 'Fresh ingredients, honest cooking.'),
      b('Dining-room ambience, glasses clinking', 'Slow dolly', 'Bokeh lights pulse', 'Made for sharing', 'Good food is better together.'),
      b('Dessert or bar close-up with a final garnish', 'Macro push', 'Slow-motion drip', 'Save room for more', 'Finish with something unforgettable.'),
    ],
    proof: b('Happy table over shared plates, review stars', 'Handheld', 'Review cards slide in', 'Guests keep coming back', 'Loved by the neighbourhood.'),
    cta: b('Storefront at dusk, sign glowing, logo lockup', 'Locked-off', 'Sign flicker-on', 'Reserve your table', 'Book your table at {brand}.'),
  },

  fitness: {
    label: 'Fitness & Wellness',
    keywords: { gym: 4, fitness: 4, workout: 3, 'personal trainer': 4, trainer: 3, training: 2, yoga: 3, pilates: 3, crossfit: 4, athlete: 2, wellness: 2 },
    palette: ['#0B0B0D', '#B6FF3B', '#F2F2F2'],
    music: 'High-energy bass-heavy electronic, tempo building',
    tone: 'Intense, motivational, raw',
    hook: b('Extreme close-up: chalk, breath, a grip tightening', 'Handheld shake', 'Hard cut on the first beat', 'Earn it.', 'Nobody ever regretted a workout.'),
    reveal: b('Gym floor wide shot, athletes in motion', 'Fast dolly and whip pan', 'Speed ramps', 'Welcome to {brand}', '{brand}: where effort becomes results.'),
    details: [
      b('Slow-motion lift, sweat droplets', 'High-speed 120fps', 'Slow-mo into snap', 'Strength, built daily', 'Progress is made one rep at a time.'),
      b('Coach correcting form, group-class energy', 'Tracking shots', 'Beat-synced cuts', 'Coaching that cares', 'Guided by people who’ve done the work.'),
      b('Transformation montage with stats overlay', 'Quick cuts', 'Counters tick up', 'Results you can see', 'Week by week, the work shows.'),
    ],
    proof: b('Member testimonial straight to camera', 'Static close-up', 'Lower-third slides in', 'Real members. Real results.', 'Join a community that keeps you moving.'),
    cta: b('Logo slam on a dark gym backdrop', 'Locked-off', 'Impact flash', 'Start today', 'Your first session is waiting at {brand}.'),
  },

  fashion: {
    label: 'Fashion & Beauty',
    keywords: { fashion: 4, clothing: 3, apparel: 3, boutique: 2, collection: 3, streetwear: 4, lookbook: 4, jewelry: 3, jewellery: 3, skincare: 3, cosmetics: 3, beauty: 2, couture: 4, 'ready-to-wear': 4, sneakers: 3 },
    palette: ['#111111', '#E8D5C4', '#FFFFFF'],
    music: 'Minimal downtempo with sharp, stylish percussion',
    tone: 'Editorial, minimal, confident',
    hook: b('Fabric in motion against a clean backdrop', 'Slow orbit', 'Slow-motion flow', 'Wear the moment', 'Style is a statement.'),
    reveal: b('Model walks the set: full look, then detail crops', 'Tracking shot', 'Hard-cut silhouettes', 'Introducing {brand}', 'This is {brand}.'),
    details: [
      b('Texture macro: stitching, weave, hardware', 'Macro slider', 'Focus pull', 'Crafted to last', 'Detail in every stitch.'),
      b('Studio and street styling variations in quick cuts', 'Handheld', 'Beat-synced cuts', 'One piece, many ways', 'Made to move with you.'),
      b('Flat-lay of the full collection', 'Top-down', 'Items snap into a grid', 'The full collection', 'Everything you need, nothing you don’t.'),
    ],
    proof: b('Customer street-style clips with tagged handles', 'Handheld', 'Grid collage builds', 'Worn by the community', 'See how others style it.'),
    cta: b('Hero look with logo and URL', 'Locked-off', 'Wipe to logo', 'Shop the collection', 'Explore {brand} today.'),
  },

  tech: {
    label: 'Tech & SaaS',
    keywords: { saas: 4, software: 3, 'mobile app': 4, 'web app': 3, app: 2, startup: 3, fintech: 4, platform: 2, dashboard: 2, automation: 3, cloud: 2, api: 3, ai: 2, 'product demo': 4, tech: 2 },
    palette: ['#0A1020', '#5B8CFF', '#EAF0FF'],
    music: 'Clean synth pulse, optimistic and light',
    tone: 'Clear, modern, confident',
    hook: b('A messy workflow collapses into one clean screen', 'Screen-capture zoom', 'Elements snap into place', 'Work shouldn’t feel like this', 'There’s a simpler way.'),
    reveal: b('Product UI hero with a cursor flowing through it', 'Smooth zoom into UI', 'Panels slide with easing', 'Meet {brand}', '{brand}: everything in one place.'),
    details: [
      b('Feature one highlighted with callouts', 'Focused zoom', 'Callout lines draw in', 'Do more in less time', 'Automate the busywork.'),
      b('Collaboration view with live cursors', 'Pan across UI', 'Avatars pop in', 'Better together', 'Your team, in sync.'),
      b('Insights dashboard with animated charts', 'Push-in', 'Charts animate in', 'See what matters', 'Clarity at a glance.'),
    ],
    proof: b('Customer logos and a headline metric', 'Static', 'Counter and logo marquee', 'Trusted by teams everywhere', 'Teams ship faster with {brand}.'),
    cta: b('Logo and URL over a product gradient', 'Locked-off', 'Gradient sweep', 'Try {brand} free', 'Get started with {brand} today.'),
  },

  generic: {
    label: 'Brand',
    keywords: {},
    palette: ['#0D0D0F', '#7C5CFF', '#F5F5F7'],
    music: 'Modern cinematic pulse, uplifting',
    tone: 'Polished, confident, clear',
    hook: b('Striking macro of the product or place in dramatic light', 'Slow push-in', 'Light sweep reveal', 'Make it unforgettable', 'Great things start with a first impression.'),
    reveal: b('Hero shot establishing {brand}', 'Gimbal glide', 'Parallax depth', 'Introducing {brand}', 'This is {brand}.'),
    details: [
      b('Key feature in close-up', 'Macro slider', 'Text rise', 'Built with care', 'Every detail considered.'),
      b('Process or people in action', 'Handheld', 'Beat-synced cuts', 'Made by people who care', 'Passion you can see.'),
      b('Benefit montage', 'Quick cuts', 'Kinetic type', 'Made for you', 'Designed around what you need.'),
    ],
    proof: b('Customer reaction or result', 'Static close-up', 'Lower-third slides in', 'Trusted by customers', 'Real people. Real results.'),
    cta: b('Logo lockup on brand colour', 'Locked-off', 'Logo reveal', 'Get in touch', 'Contact {brand} today.'),
  },
};

// ---------- compiled matchers (built once at load) ----------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const n of Object.values(NICHES)) {
  // Short keywords (<=3 chars) need whole-word matching ("ai" must not match "air");
  // longer ones match as a word prefix so plurals/stems work ("suite" -> "suites").
  n._rx = Object.entries(n.keywords).map(([kw, w]) => [
    new RegExp(kw.length <= 3 ? `\\b${esc(kw)}\\b` : `\\b${esc(kw)}`, 'i'),
    w,
  ]);
}

const WEIGHT = { hook: 0.15, reveal: 0.2, detail: 0.2, proof: 0.15, cta: 0.15 };
const TRANSITIONS = ['Hard cut', 'Match cut', 'Whip pan', 'Light-leak dissolve', 'Push-through', 'Speed-ramp cut'];
const MODS = [
  [/luxur|premium|elegant|upscale|five.star/i, 'luxury pacing'],
  [/playful|\bfun\b|quirky/i, 'playful'],
  [/minimal|clean|simple/i, 'minimal'],
  [/bold|loud|punchy|energetic|\bfast/i, 'high energy'],
  [/cinematic|\bfilm/i, 'cinematic grade'],
];

// ---------- helpers ----------
const round1 = (x) => Math.round(x * 10) / 10;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function normalizeBrief(brief) {
  let t;
  try {
    t = typeof brief === 'string' ? brief : JSON.stringify(brief) ?? '';
  } catch {
    t = '';
  }
  return t.slice(0, 5000).normalize('NFKC').trim();
}

function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) { // mulberry32
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];
function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function parseDuration(text) {
  let m = text.match(/(\d+(?:\.\d+)?)\s*(?:min|mins|minutes?)\b/i);
  if (m) return Number(m[1]) * 60;
  m = text.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)\b/i);
  return m ? Number(m[1]) : 30;
}

function parseAspect(text) {
  if (/9\s*:\s*16|vertical|\breels?\b|tiktok|shorts|stories/i.test(text)) return '9:16';
  if (/4\s*:\s*5/.test(text)) return '4:5';
  if (/1\s*:\s*1|square/i.test(text)) return '1:1';
  return '16:9';
}

function extractBrand(text) {
  const q = text.match(/["“]([^"“”]{2,40})["”]/);
  if (q) return q[1].trim();
  const m = text.match(/\b(?:for|called|named)\s+((?:[A-Z][\w&’'-]*)(?:\s+[A-Z][\w&’'-]*){0,3})/);
  return m ? m[1].trim() : 'Your Brand';
}

function detectNiche(text) {
  const scores = {};
  let best = 'generic';
  let bestScore = 0;
  for (const [id, n] of Object.entries(NICHES)) {
    let s = 0;
    for (const [rx, w] of n._rx) if (rx.test(text)) s += w;
    scores[id] = s;
    if (s > bestScore) { best = id; bestScore = s; }
  }
  return bestScore >= 2 ? { id: best, score: bestScore, scores } : { id: 'generic', score: 0, scores };
}

// ---------- main builder ----------
function buildStoryboard(brief, opts = {}) {
  const raw = normalizeBrief(brief);
  const detected = detectNiche(raw);
  const id = opts.niche && NICHES[opts.niche] ? opts.niche : detected.id;
  const n = NICHES[id];
  const rand = rng(seedFrom(`${raw}|${id}`));

  const brand = (opts.brand && String(opts.brand).trim()) || extractBrand(raw);
  const duration = clamp(Number(opts.duration) || parseDuration(raw), 6, 120);
  const aspectRatio = opts.aspectRatio || parseAspect(raw);
  const mods = MODS.filter(([rx]) => rx.test(raw)).map(([, label]) => label);
  const fill = (s) => s.replace(/\{brand\}/g, brand);

  const nDetail = duration <= 10 ? 0 : duration <= 20 ? 1 : duration <= 40 ? 2 : 3;
  const details = shuffle(n.details.slice(), rand).slice(0, nDetail);
  const plan = [
    ['hook', n.hook],
    ['reveal', n.reveal],
    ...details.map((d) => ['detail', d]),
    ...(duration > 20 ? [['proof', n.proof]] : []),
    ['cta', n.cta],
  ];

  const totalW = plan.reduce((s, [beat]) => s + WEIGHT[beat], 0);
  let t = 0;
  const scenes = plan.map(([beat, src], i) => {
    const last = i === plan.length - 1;
    const d = last ? round1(duration - t) : round1((duration * WEIGHT[beat]) / totalW);
    const start = round1(t);
    t = round1(t + d);
    return {
      index: i + 1,
      beat,
      start,
      end: last ? duration : t,
      duration: d,
      shot: fill(src.shot),
      camera: src.camera,
      motion: src.motion,
      onScreenText: fill(src.text),
      voiceover: fill(src.vo),
      // transition INTO this scene
      transition: i === 0 ? 'Fade from black' : last ? 'Match cut to logo lockup' : pick(TRANSITIONS, rand),
    };
  });

  return {
    title: `${brand} — ${n.label} Promo (${duration}s)`,
    brand,
    niche: id,
    nicheLabel: n.label,
    aspectRatio,
    totalDuration: duration,
    tone: mods.length ? `${n.tone} · ${mods.join(', ')}` : n.tone,
    palette: n.palette.slice(),
    music: n.music,
    scenes,
    cta: scenes[scenes.length - 1].onScreenText,
    meta: { source: 'rules', engine: 'sev7n-rules/1', nicheScore: detected.score },
  };
}

// Literals only, so it cannot throw. Used if buildStoryboard ever does.
function emergencyStoryboard() {
  const mk = (i, beat, start, end, text) => ({
    index: i, beat, start, end, duration: end - start,
    shot: 'Hero visual of the subject', camera: 'Slow push-in', motion: 'Soft reveal',
    onScreenText: text, voiceover: text, transition: i === 1 ? 'Fade from black' : 'Hard cut',
  });
  return {
    title: 'Brand Promo (30s)', brand: 'Your Brand', niche: 'generic', nicheLabel: 'Brand',
    aspectRatio: '16:9', totalDuration: 30, tone: 'Polished, confident, clear',
    palette: ['#0D0D0F', '#7C5CFF', '#F5F5F7'], music: 'Modern cinematic pulse, uplifting',
    scenes: [mk(1, 'hook', 0, 8, 'Make it unforgettable'), mk(2, 'reveal', 8, 22, 'Introducing Your Brand'), mk(3, 'cta', 22, 30, 'Get in touch')],
    cta: 'Get in touch', meta: { source: 'rules', engine: 'sev7n-rules/1', emergency: true },
  };
}

function generateStoryboard(brief, opts) {
  try {
    return buildStoryboard(brief, opts || {});
  } catch (err) {
    console.error('[ruleEngine] unexpected error, using emergency board:', err && err.message);
    return emergencyStoryboard();
  }
}

const listNiches = () => Object.entries(NICHES).map(([id, n]) => ({ id, label: n.label }));

module.exports = { generateStoryboard, detectNiche, normalizeBrief, listNiches };
