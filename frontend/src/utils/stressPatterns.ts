// Curated word-stress data and helpers for the Stress Tap pronunciation
// mini-game. Pure, side-effect free (except for the localStorage helpers
// at the bottom which are explicitly opt-in).

export interface StressWord {
  /** The word itself (lowercase, single token). */
  word: string;
  /** Syllable breakdown, in order. Joined with no separator should ~= word. */
  syllables: string[];
  /** 0-based index of the syllable carrying the PRIMARY stress. */
  stressIndex: number;
  /** Optional short gloss shown after grading. */
  meaning?: string;
}

/** ~30 common multi-syllable English words with their primary-stress index. */
export const STRESS_WORDS: StressWord[] = [
  { word: 'beautiful',     syllables: ['beau', 'ti', 'ful'],          stressIndex: 0, meaning: 'pleasing to look at' },
  { word: 'computer',      syllables: ['com', 'pu', 'ter'],           stressIndex: 1, meaning: 'electronic device' },
  { word: 'photograph',    syllables: ['pho', 'to', 'graph'],         stressIndex: 0, meaning: 'a picture' },
  { word: 'photographer',  syllables: ['pho', 'to', 'gra', 'pher'],   stressIndex: 1, meaning: 'one who takes photos' },
  { word: 'photographic',  syllables: ['pho', 'to', 'gra', 'phic'],   stressIndex: 2, meaning: 'of photography' },
  { word: 'develop',       syllables: ['de', 've', 'lop'],            stressIndex: 1, meaning: 'to grow or build' },
  { word: 'development',   syllables: ['de', 've', 'lop', 'ment'],    stressIndex: 1, meaning: 'process of developing' },
  { word: 'remember',      syllables: ['re', 'mem', 'ber'],           stressIndex: 1, meaning: 'recall' },
  { word: 'understand',    syllables: ['un', 'der', 'stand'],         stressIndex: 2, meaning: 'comprehend' },
  { word: 'important',     syllables: ['im', 'por', 'tant'],          stressIndex: 1, meaning: 'of great value' },
  { word: 'family',        syllables: ['fa', 'mi', 'ly'],             stressIndex: 0, meaning: 'group of relatives' },
  { word: 'banana',        syllables: ['ba', 'na', 'na'],             stressIndex: 1, meaning: 'a yellow fruit' },
  { word: 'tomato',        syllables: ['to', 'ma', 'to'],             stressIndex: 1, meaning: 'a red fruit' },
  { word: 'potato',        syllables: ['po', 'ta', 'to'],             stressIndex: 1, meaning: 'a tuber vegetable' },
  { word: 'hospital',      syllables: ['hos', 'pi', 'tal'],           stressIndex: 0, meaning: 'medical facility' },
  { word: 'animal',        syllables: ['a', 'ni', 'mal'],             stressIndex: 0, meaning: 'a living creature' },
  { word: 'engineer',      syllables: ['en', 'gi', 'neer'],           stressIndex: 2, meaning: 'technical professional' },
  { word: 'volunteer',     syllables: ['vo', 'lun', 'teer'],          stressIndex: 2, meaning: 'one who helps freely' },
  { word: 'celebrate',     syllables: ['ce', 'le', 'brate'],          stressIndex: 0, meaning: 'mark a happy event' },
  { word: 'celebration',   syllables: ['ce', 'le', 'bra', 'tion'],    stressIndex: 2, meaning: 'a happy event' },
  { word: 'energy',        syllables: ['e', 'ner', 'gy'],             stressIndex: 0, meaning: 'power, vitality' },
  { word: 'energetic',     syllables: ['e', 'ner', 'ge', 'tic'],      stressIndex: 2, meaning: 'full of energy' },
  { word: 'communicate',   syllables: ['com', 'mu', 'ni', 'cate'],    stressIndex: 1, meaning: 'share information' },
  { word: 'communication', syllables: ['com', 'mu', 'ni', 'ca', 'tion'], stressIndex: 3, meaning: 'sharing of info' },
  { word: 'opportunity',   syllables: ['op', 'por', 'tu', 'ni', 'ty'], stressIndex: 2, meaning: 'a chance' },
  { word: 'experience',    syllables: ['ex', 'pe', 'ri', 'ence'],     stressIndex: 1, meaning: 'practical knowledge' },
  { word: 'difficult',     syllables: ['dif', 'fi', 'cult'],          stressIndex: 0, meaning: 'hard to do' },
  { word: 'interesting',   syllables: ['in', 'te', 'rest', 'ing'],    stressIndex: 0, meaning: 'engaging' },
  { word: 'restaurant',    syllables: ['res', 'tau', 'rant'],         stressIndex: 0, meaning: 'a place to eat' },
  { word: 'hotel',         syllables: ['ho', 'tel'],                  stressIndex: 1, meaning: 'lodging' },
];

/* ---------- pure helpers ---------- */

/**
 * Mulberry32 seeded PRNG. Returns a function that yields floats in [0, 1).
 * Exported only for testing; consumers should use `pickStressRound`.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick `n` words for one round using Fisher-Yates. If `seed` is supplied
 * the round is deterministic, otherwise `Math.random` is used.
 *
 * Pure: never mutates the input array.
 */
export function pickStressRound(
  words: StressWord[],
  n: number,
  seed?: number,
): StressWord[] {
  if (!Array.isArray(words) || words.length === 0 || n <= 0) return [];
  const rng = typeof seed === 'number' ? mulberry32(seed) : Math.random;
  const arr = words.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(n, arr.length));
}

/** Per-word accuracy stats persisted in localStorage. */
export interface StressStat {
  correct: number;
  wrong: number;
}
export type StressStats = Record<string, StressStat>;

/**
 * Build a weighted round: words the learner has previously gotten WRONG
 * are weighted ~3x so they appear more often. Pure & deterministic when
 * `seed` is supplied.
 */
export function selectWeightedRound(
  words: StressWord[],
  stats: StressStats,
  n: number,
  seed?: number,
): StressWord[] {
  if (!Array.isArray(words) || words.length === 0 || n <= 0) return [];
  const rng = typeof seed === 'number' ? mulberry32(seed) : Math.random;

  const weightOf = (w: StressWord): number => {
    const s = stats[w.word];
    if (!s) return 1;
    // Each prior wrong attempt adds 3 weight units; correct attempts taper down.
    const w_wrong = (s.wrong || 0) * 3;
    const w_correct = (s.correct || 0) * 1;
    return Math.max(1, 1 + w_wrong - Math.min(w_correct, w_wrong));
  };

  // Weighted sampling without replacement.
  const pool = words.map((w) => ({ word: w, weight: weightOf(w) }));
  const out: StressWord[] = [];
  const take = Math.min(n, pool.length);
  for (let i = 0; i < take; i++) {
    const total = pool.reduce((s, p) => s + p.weight, 0);
    let r = rng() * total;
    let pick = 0;
    for (let j = 0; j < pool.length; j++) {
      r -= pool[j].weight;
      if (r <= 0) { pick = j; break; }
    }
    out.push(pool[pick].word);
    pool.splice(pick, 1);
  }
  return out;
}

/* ---------- localStorage persistence ---------- */

export const STRESS_STATS_KEY = 'stress_tap_stats';

export function loadStressStats(): StressStats {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    const raw = window.localStorage.getItem(STRESS_STATS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

export function saveStressStats(stats: StressStats): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STRESS_STATS_KEY, JSON.stringify(stats));
  } catch {
    /* ignore quota / serialization errors */
  }
}

export function recordStressAttempt(
  stats: StressStats,
  word: string,
  correct: boolean,
): StressStats {
  const next = { ...stats };
  const cur = next[word] || { correct: 0, wrong: 0 };
  next[word] = correct
    ? { ...cur, correct: cur.correct + 1 }
    : { ...cur, wrong: cur.wrong + 1 };
  return next;
}

/* ---------- reducer used by <StressTapDrill /> ---------- */

export interface StressDrillState {
  round: StressWord[];
  index: number;
  /** Tapped pill index per word; null if not yet answered. */
  taps: (number | null)[];
  /** 'playing' while answering, 'summary' once round complete. */
  phase: 'playing' | 'summary';
}

export type StressDrillAction =
  | { type: 'tap'; pillIndex: number }
  | { type: 'next' }
  | { type: 'restart'; round: StressWord[] };

export function initStressDrill(round: StressWord[]): StressDrillState {
  return {
    round,
    index: 0,
    taps: round.map(() => null),
    phase: round.length === 0 ? 'summary' : 'playing',
  };
}

export function stressDrillReducer(
  state: StressDrillState,
  action: StressDrillAction,
): StressDrillState {
  switch (action.type) {
    case 'tap': {
      if (state.phase !== 'playing') return state;
      if (state.taps[state.index] != null) return state; // already answered
      const taps = state.taps.slice();
      taps[state.index] = action.pillIndex;
      return { ...state, taps };
    }
    case 'next': {
      if (state.phase !== 'playing') return state;
      const isLast = state.index >= state.round.length - 1;
      if (isLast) return { ...state, phase: 'summary' };
      return { ...state, index: state.index + 1 };
    }
    case 'restart': {
      return initStressDrill(action.round);
    }
    default:
      return state;
  }
}

/** Number of correct answers so far. */
export function stressScore(state: StressDrillState): number {
  let n = 0;
  for (let i = 0; i < state.round.length; i++) {
    const t = state.taps[i];
    if (t != null && t === state.round[i].stressIndex) n++;
  }
  return n;
}
