// Curated minimal-pair sets for client-side rendering.
// Mirrors the server-side list in app/routers/listening.py — the server is the
// source of truth for round selection, but this list is used to render hints
// and offline fallbacks.

export interface MinimalPairEntry {
  word_a: string;
  word_b: string;
  ipa_a: string;
  ipa_b: string;
}

export interface MinimalPairSet {
  contrast: string;
  description: string;
  pairs: MinimalPairEntry[];
}

export const MINIMAL_PAIR_SETS: MinimalPairSet[] = [
  {
    contrast: '/i/-/iː/',
    description: 'Short vs long "i" — ship vs sheep',
    pairs: [
      { word_a: 'ship',  word_b: 'sheep', ipa_a: 'ʃɪp',  ipa_b: 'ʃiːp' },
      { word_a: 'bit',   word_b: 'beat',  ipa_a: 'bɪt',  ipa_b: 'biːt' },
      { word_a: 'fit',   word_b: 'feet',  ipa_a: 'fɪt',  ipa_b: 'fiːt' },
      { word_a: 'live',  word_b: 'leave', ipa_a: 'lɪv',  ipa_b: 'liːv' },
      { word_a: 'sit',   word_b: 'seat',  ipa_a: 'sɪt',  ipa_b: 'siːt' },
    ],
  },
  {
    contrast: '/l/-/r/',
    description: 'L vs R — light vs right',
    pairs: [
      { word_a: 'light',   word_b: 'right',   ipa_a: 'laɪt',     ipa_b: 'raɪt' },
      { word_a: 'lice',    word_b: 'rice',    ipa_a: 'laɪs',     ipa_b: 'raɪs' },
      { word_a: 'lock',    word_b: 'rock',    ipa_a: 'lɒk',      ipa_b: 'rɒk' },
      { word_a: 'long',    word_b: 'wrong',   ipa_a: 'lɔːŋ',     ipa_b: 'rɔːŋ' },
      { word_a: 'collect', word_b: 'correct', ipa_a: 'kəˈlɛkt',  ipa_b: 'kəˈrɛkt' },
    ],
  },
  {
    contrast: '/v/-/b/',
    description: 'V vs B — very vs berry',
    pairs: [
      { word_a: 'very', word_b: 'berry', ipa_a: 'ˈvɛri', ipa_b: 'ˈbɛri' },
      { word_a: 'vest', word_b: 'best',  ipa_a: 'vɛst',  ipa_b: 'bɛst' },
      { word_a: 'vase', word_b: 'base',  ipa_a: 'veɪs',  ipa_b: 'beɪs' },
      { word_a: 'vat',  word_b: 'bat',   ipa_a: 'væt',   ipa_b: 'bæt' },
      { word_a: 'vow',  word_b: 'bow',   ipa_a: 'vaʊ',   ipa_b: 'baʊ' },
    ],
  },
  {
    contrast: '/θ/-/s/',
    description: 'TH vs S — think vs sink',
    pairs: [
      { word_a: 'think', word_b: 'sink', ipa_a: 'θɪŋk', ipa_b: 'sɪŋk' },
      { word_a: 'thick', word_b: 'sick', ipa_a: 'θɪk',  ipa_b: 'sɪk' },
      { word_a: 'thumb', word_b: 'sum',  ipa_a: 'θʌm',  ipa_b: 'sʌm' },
      { word_a: 'path',  word_b: 'pass', ipa_a: 'pɑːθ', ipa_b: 'pɑːs' },
      { word_a: 'thin',  word_b: 'sin',  ipa_a: 'θɪn',  ipa_b: 'sɪn' },
    ],
  },
  {
    contrast: '/æ/-/ɛ/',
    description: 'Cat vs bed — bad vs bed',
    pairs: [
      { word_a: 'bad', word_b: 'bed',  ipa_a: 'bæd', ipa_b: 'bɛd' },
      { word_a: 'man', word_b: 'men',  ipa_a: 'mæn', ipa_b: 'mɛn' },
      { word_a: 'pan', word_b: 'pen',  ipa_a: 'pæn', ipa_b: 'pɛn' },
      { word_a: 'sad', word_b: 'said', ipa_a: 'sæd', ipa_b: 'sɛd' },
      { word_a: 'had', word_b: 'head', ipa_a: 'hæd', ipa_b: 'hɛd' },
    ],
  },
  {
    contrast: '/ɔː/-/ɜː/',
    description: 'Walk vs work',
    pairs: [
      { word_a: 'walk', word_b: 'work', ipa_a: 'wɔːk', ipa_b: 'wɜːk' },
      { word_a: 'ward', word_b: 'word', ipa_a: 'wɔːd', ipa_b: 'wɜːd' },
      { word_a: 'born', word_b: 'burn', ipa_a: 'bɔːn', ipa_b: 'bɜːn' },
    ],
  },
];

export function pickRandomSet(): MinimalPairSet {
  return MINIMAL_PAIR_SETS[Math.floor(Math.random() * MINIMAL_PAIR_SETS.length)];
}

export type SpeakAttemptScore = 'match' | 'confused' | 'unclear';

/**
 * Normalize a transcript / word for comparison: lowercase, strip everything
 * that isn't a basic latin letter, collapse whitespace.
 */
function normalize(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score a Speak-mode attempt for the MinimalPairs production drill.
 *
 *  - `match`     – the user said the target word (exact word or as one of the
 *                   tokens in their utterance, including simple inflections
 *                   like "rights" → "right").
 *  - `confused`  – the user said the *other* word in the pair (a contrast
 *                   confusion such as L↔R, V↔B, TH↔S).
 *  - `unclear`   – ASR returned nothing meaningful, or neither word matched.
 *
 * Pure function: easy to unit test, no side effects.
 */
export function scoreSpeakAttempt(
  transcript: string,
  target: string,
  other: string,
): SpeakAttemptScore {
  const t = normalize(transcript);
  const tgt = normalize(target);
  const oth = normalize(other);

  if (!t || !tgt) return 'unclear';

  const tokens = t.split(' ').filter(Boolean);

  const tokenMatchesWord = (token: string, word: string): boolean => {
    if (!word) return false;
    if (token === word) return true;
    // Allow simple inflections / sub-string forms ("rights" → "right",
    // "lighter" → "light"). We require the candidate word to be a prefix
    // of the spoken token AND the token to be at most 3 chars longer
    // (covers -s, -ed, -ing, -er endings) to avoid spurious matches.
    if (token.startsWith(word) && token.length - word.length <= 3) return true;
    return false;
  };

  const matchesTarget = tokens.some(tok => tokenMatchesWord(tok, tgt));
  const matchesOther  = oth ? tokens.some(tok => tokenMatchesWord(tok, oth)) : false;

  // Prefer target match — if both appear (e.g. "right not light"), credit
  // the learner: they produced the target word.
  if (matchesTarget) return 'match';
  if (matchesOther) return 'confused';
  return 'unclear';
}
