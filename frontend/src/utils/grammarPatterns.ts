/**
 * Grammar error pattern detection utilities.
 *
 * Categorises grammar errors into broad categories based on keyword
 * analysis of the error's explanation, original text, and correction.
 */

export interface GrammarError {
  original: string;
  correction: string;
  explanation: string;
}

export type GrammarCategory =
  | 'article'
  | 'tense'
  | 'preposition'
  | 'subject-verb agreement'
  | 'word order'
  | 'plural'
  | 'other';

interface CategoryRule {
  category: GrammarCategory;
  /** Patterns tested against the lowercased combined text of original + correction + explanation. */
  patterns: RegExp[];
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: 'article',
    patterns: [/\barticles?\b/, /\bdeterminer\b/],
  },
  {
    category: 'tense',
    patterns: [/\btense\b/, /\bpast\b/, /\bpresent\b/, /\bfuture\b/, /\bperfect\b/, /\bcontinuous\b/, /\bprogressive\b/],
  },
  {
    category: 'preposition',
    patterns: [/\bpreposition\b/, /\b(in|on|at)\b.*\bpreposition\b|\bpreposition\b.*\b(in|on|at)\b/, /\buse ['"]?(in|on|at|to|for|with|from|by|about|of)\b/],
  },
  {
    category: 'subject-verb agreement',
    patterns: [/\bagreement\b/, /\bsubject.{0,30}verb\b/, /\bverb.{0,30}subject\b/, /\bconcord\b/],
  },
  {
    category: 'word order',
    patterns: [/\border\b/, /\bposition\b/, /\bword order\b/, /\binversion\b/],
  },
  {
    category: 'plural',
    patterns: [/\bplural\b/, /\bsingular\b/, /\bcountable\b/, /\buncountable\b/],
  },
];

/**
 * Classify a grammar error into a category based on keyword matching.
 *
 * The function concatenates the error's `explanation`, `original`, and
 * `correction` fields, converts to lowercase, and checks against a set
 * of keyword patterns for each category. The first matching category wins.
 * Returns `'other'` when no specific category matches.
 */
export function categorizeGrammarError(error: GrammarError): GrammarCategory {
  const text = `${error.explanation} ${error.original} ${error.correction}`.toLowerCase();

  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      return rule.category;
    }
  }

  return 'other';
}

/** Human-readable advice strings keyed by grammar category. */
export const CATEGORY_ADVICE: Record<GrammarCategory, string> = {
  article: 'Use "the" for specific items, "a/an" for general ones.',
  tense: 'Match your verb tense to when the action happens.',
  preposition: 'Prepositions like in/on/at have specific rules — practice common collocations.',
  'subject-verb agreement': 'Make sure your verb matches the subject (e.g., "he goes", not "he go").',
  'word order': 'In English, the standard order is Subject → Verb → Object.',
  plural: 'Check if the noun should be singular or plural based on quantity.',
  other: 'Review the specific correction and try to spot the pattern.',
};
