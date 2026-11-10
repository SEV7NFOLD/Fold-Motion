/**
 * Style kits: each brand gets its own visual language. A kit decides which text
 * motions, emphasis styles, graphics, echoes and headline effects a film may use,
 * and how many graphics. The storyboard picks one from the brief (or the studio
 * overrides it); enforceStyleKit applies it in code, so a luxury film can't get
 * emojis even if the model asks for them.
 */

export const STYLE_KITS = Object.freeze({
  'editorial-luxury': {
    label: 'Editorial luxury',
    feel: 'quiet confidence: serif-like scale contrast, hairlines, fine signs and line icons',
    textMotions: ['rise', 'split', 'slam'],
    emphasisStyles: ['gradient', 'outline', 'highlight'],
    graphics: ['icon', 'sign'],
    echo: true,
    typeEffects: ['outline'],
    maxGraphics: 3,
  },
  'playful-dtc': {
    label: 'Playful DTC',
    feel: 'bright and bouncy: emojis, stickers, pills and highlighters, type that drops and slams',
    textMotions: ['slam', 'drop', 'rise'],
    emphasisStyles: ['pill', 'highlight', 'gradient'],
    graphics: ['emoji', 'badge', 'icon', 'sign'],
    echo: false,
    typeEffects: [],
    maxGraphics: 6,
  },
  'tech-ui': {
    label: 'Tech & UI',
    feel: 'precise and modern: split and decoded type, outlines, clean icons and badges',
    textMotions: ['split', 'rise', 'slam'],
    emphasisStyles: ['outline', 'pill', 'gradient'],
    graphics: ['icon', 'sign', 'badge'],
    echo: false,
    typeEffects: ['decode'],
    maxGraphics: 4,
  },
  'bold-street': {
    label: 'Bold street',
    feel: 'loud and direct: slams, marker highlights, arrows, stamps and giant echoes',
    textMotions: ['slam', 'split', 'drop'],
    emphasisStyles: ['highlight', 'pill', 'gradient'],
    graphics: ['sign', 'badge', 'emoji'],
    echo: true,
    typeEffects: ['decode'],
    maxGraphics: 5,
  },
  'warm-craft': {
    label: 'Warm craft',
    feel: 'gentle and handmade: calm rises, soft highlights, simple line icons',
    textMotions: ['rise', 'drop'],
    emphasisStyles: ['gradient', 'highlight'],
    graphics: ['icon', 'sign'],
    echo: false,
    typeEffects: ['outline'],
    maxGraphics: 3,
  },
});

export const STYLE_OPTIONS = Object.freeze(Object.keys(STYLE_KITS));

const STYLE_WORDS = {
  'playful-dtc': /\b(playful|fun|bright|bubbly|gen z|cheeky|colourful|colorful|snack|candy|sweet|juicy|tiktok|bouncy)\b/gi,
  'tech-ui': /\b(tech|app|digital|software|device|gadget|smart|ai|data|platform|fintech|precision|engineered)\b/gi,
  'bold-street': /\b(street|streetwear|sneaker|sneakers|drop|hype|bold|loud|urban|edgy|festival|limited run)\b/gi,
  'warm-craft': /\b(handmade|hand-poured|craft|crafted|artisan|cosy|cozy|warm|homemade|bakery|candle|small batch|rustic)\b/gi,
  'editorial-luxury': /\b(luxury|luxurious|premium|elegant|refined|editorial|couture|exquisite|timeless|jewel|jewelled|fragrance|perfume)\b/gi,
};
const MOOD_STYLE = { premium: 'editorial-luxury', energetic: 'bold-street', editorial: 'tech-ui', warm: 'warm-craft' };

/** A style kit from the brief's words; the music mood breaks ties. */
export function chooseStyle(text = '', musicMood) {
  const scores = Object.entries(STYLE_WORDS).map(([style, pattern]) => [style, (String(text).match(pattern) || []).length]);
  scores.sort((a, b) => b[1] - a[1]);
  if (scores[0][1] > 0 && scores[0][1] > (scores[1]?.[1] ?? 0)) return scores[0][0];
  return MOOD_STYLE[musicMood] || (scores[0][1] > 0 ? scores[0][0] : 'editorial-luxury');
}

/** The film's style: the studio's pick, else the storyboard's, else the brief's words. */
export function resolveStyle(storyboard = {}, context = {}) {
  if (STYLE_OPTIONS.includes(context.style)) return context.style;
  if (STYLE_OPTIONS.includes(storyboard.style)) return storyboard.style;
  return chooseStyle([storyboard.title, storyboard.narrativeConcept, storyboard.creativeDirection].filter(Boolean).join(' '), storyboard.musicMood);
}

/**
 * Applies a kit to a film's shot directions, in place: disallowed text motions,
 * emphasis styles, echoes, headline effects and graphics give way to the kit's
 * own, and graphics stay within the kit's budget. Returns what changed.
 */
export function enforceStyleKit(specs, style, labels = []) {
  const kit = STYLE_KITS[style];
  if (!kit) return [];
  const changes = [];
  let graphics = 0;
  specs.forEach((spec, index) => {
    if (spec?.version !== 2) return;
    const label = labels[index] || `shot ${index + 1}`;
    // The brief's explicit typography words win over the kit (the user asked for
    // them); graphics stay guarded, since that's where brand risk lives.
    const locked = new Set(spec.briefLocked || []);
    if (spec.textMotion && !locked.has('textMotion') && !kit.textMotions.includes(spec.textMotion)) {
      changes.push(`${label}: ${kit.label} doesn't use "${spec.textMotion}"; used "${kit.textMotions[0]}".`);
      spec.textMotion = kit.textMotions[0];
    }
    if (spec.emphasisStyle && !locked.has('emphasisStyle') && !kit.emphasisStyles.includes(spec.emphasisStyle)) {
      changes.push(`${label}: ${kit.label} doesn't use a ${spec.emphasisStyle} emphasis; used "${kit.emphasisStyles[0]}".`);
      spec.emphasisStyle = kit.emphasisStyles[0];
    }
    if (spec.echo && !locked.has('echo') && !kit.echo) {
      changes.push(`${label}: ${kit.label} doesn't use echoes.`);
      delete spec.echo;
    }
    if (spec.typeEffect && !locked.has('typeEffect') && !kit.typeEffects.includes(spec.typeEffect)) {
      changes.push(`${label}: ${kit.label} doesn't use the ${spec.typeEffect} effect.`);
      delete spec.typeEffect;
    }
    if (Array.isArray(spec.graphics) && spec.graphics.length) {
      const kept = spec.graphics.filter((graphic) => {
        if (!kit.graphics.includes(graphic.kind)) {
          changes.push(`${label}: ${kit.label} doesn't use ${graphic.kind}s; dropped "${graphic.name}".`);
          return false;
        }
        if (graphics >= kit.maxGraphics) {
          changes.push(`${label}: ${kit.label} keeps graphics to ${kit.maxGraphics} per film; dropped "${graphic.name}".`);
          return false;
        }
        graphics += 1;
        return true;
      });
      spec.graphics = kept;
    }
  });
  return changes;
}
