import { useState, useMemo, useCallback } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Props {
  /** The full AI message text to build the cloze from */
  content: string;
  /** Called once the user has answered every blank */
  onComplete: (correct: number, total: number) => void;
}

interface Blank {
  /** index into the tokenised word array */
  wordIndex: number;
  /** the correct word (original casing) */
  answer: string;
  /** multiple-choice options (includes the correct answer, shuffled) */
  options: string[];
}

interface BlankState {
  selected: string | null;
  isCorrect: boolean | null;
}

/* ------------------------------------------------------------------ */
/*  Stop-word list  — common function words we never blank-out         */
/* ------------------------------------------------------------------ */

const STOP_WORDS = new Set([
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'its',
  'they', 'them', 'their', 'this', 'that', 'these', 'those',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
  'should', 'may', 'might', 'must', 'can', 'could',
  'the', 'a', 'an', 'and', 'but', 'or', 'nor', 'not', 'no', 'so',
  'if', 'then', 'than', 'too', 'very', 'just', 'also', 'now',
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'from', 'by', 'as',
  'into', 'about', 'up', 'out', 'over', 'after', 'before',
  'here', 'there', 'when', 'where', 'how', 'what', 'which', 'who',
  'whom', 'why', 'all', 'each', 'some', 'any', 'many', 'much',
  'more', 'most', 'other', 'such', 'only', 'own', 'same',
  'well', 'back', 'even', 'still', 'already', 'again',
  'hello', 'hi', 'hey', 'please', 'thank', 'thanks', 'yes', 'yeah',
  'okay', 'sure', 'right', 'good', 'great', 'nice', 'fine',
  "don't", "doesn't", "didn't", "won't", "wouldn't", "can't", "couldn't",
  "isn't", "aren't", "wasn't", "weren't", "hasn't", "haven't", "hadn't",
  "let's", "i'm", "i'll", "i've", "i'd", "it's", "that's", "there's",
  "what's", "who's", "he's", "she's", "we're", "they're", "you're",
  "you'll", "you've", "you'd", "we'll", "we've", "we'd", "they'll",
  "they've", "they'd", "he'll", "he'd", "she'll", "she'd",
]);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Strip leading/trailing punctuation from a word token */
function stripPunctuation(word: string): string {
  return word.replace(/^[^a-zA-Z0-9]+/, '').replace(/[^a-zA-Z0-9]+$/, '');
}

/** Check if a word is a "content word" suitable for blanking */
function isContentWord(word: string): boolean {
  const clean = stripPunctuation(word).toLowerCase();
  if (clean.length < 4) return false;
  if (STOP_WORDS.has(clean)) return false;
  // skip anything that's purely numeric (e.g. "2024")
  if (/^\d+$/.test(clean)) return false;
  return true;
}

/**
 * Deterministic shuffle seeded by a simple hash of the content string.
 * We use this so the blanks / option order are stable across re-renders.
 */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const copy = [...arr];
  let s = seed;
  for (let i = copy.length - 1; i > 0; i--) {
    s = (s * 16807 + 11) % 2147483647;
    const j = s % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Build the cloze data: pick 2-3 content words to blank, and generate
 * distractor options for each blank from remaining content words.
 */
function buildBlanks(content: string): { words: string[]; blanks: Blank[] } {
  const words = content.split(/\s+/).filter(Boolean);
  const seed = hashString(content);

  // Collect candidate indices (content words)
  const candidates: number[] = [];
  for (let i = 0; i < words.length; i++) {
    if (isContentWord(words[i])) {
      candidates.push(i);
    }
  }

  if (candidates.length === 0) {
    return { words, blanks: [] };
  }

  // Pick 2-3 blanks, well-spaced across the message
  const numBlanks = Math.min(candidates.length, candidates.length >= 3 ? 3 : 2);
  const shuffled = seededShuffle(candidates, seed);

  // Sort by index to spread them out, then take the first numBlanks
  const selected = shuffled.slice(0, Math.min(shuffled.length, numBlanks + 3));
  selected.sort((a, b) => a - b);

  // Greedily pick spaced-out blanks
  const picked: number[] = [];
  for (const idx of selected) {
    if (picked.length >= numBlanks) break;
    if (picked.length === 0 || idx - picked[picked.length - 1] >= 2) {
      picked.push(idx);
    }
  }
  // If we still need more, fill from remaining
  if (picked.length < numBlanks) {
    for (const idx of selected) {
      if (picked.length >= numBlanks) break;
      if (!picked.includes(idx)) {
        picked.push(idx);
      }
    }
    picked.sort((a, b) => a - b);
  }

  // Build distractor pool from other content words
  const pickedSet = new Set(picked);
  const distractorPool: string[] = [];
  const seenLower = new Set<string>();
  for (const idx of candidates) {
    if (pickedSet.has(idx)) continue;
    const clean = stripPunctuation(words[idx]).toLowerCase();
    if (!seenLower.has(clean)) {
      seenLower.add(clean);
      distractorPool.push(stripPunctuation(words[idx]));
    }
  }

  // Some generic distractor fallbacks if pool is small
  const fallbackDistractors = ['another', 'different', 'special', 'available', 'important', 'comfortable', 'wonderful', 'excellent'];

  const blanks: Blank[] = picked.map((wordIndex, blankIdx) => {
    const answer = stripPunctuation(words[wordIndex]);

    // Pick 3 distractors
    let pool = distractorPool.filter(
      (d) => d.toLowerCase() !== answer.toLowerCase()
    );
    if (pool.length < 3) {
      const extra = fallbackDistractors.filter(
        (d) => d.toLowerCase() !== answer.toLowerCase() && !pool.some(p => p.toLowerCase() === d.toLowerCase())
      );
      pool = [...pool, ...extra];
    }
    const distractors = seededShuffle(pool, seed + blankIdx + 1).slice(0, 3);

    // Combine correct answer + distractors and shuffle
    const options = seededShuffle([answer, ...distractors], seed + blankIdx + 7);

    return { wordIndex, answer, options };
  });

  return { words, blanks };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ListenModeCloze({ content, onComplete }: Props) {
  const { words, blanks } = useMemo(() => buildBlanks(content), [content]);

  const [blankStates, setBlankStates] = useState<BlankState[]>(() =>
    blanks.map(() => ({ selected: null, isCorrect: null }))
  );
  const [completed, setCompleted] = useState(false);

  const blankIndexMap = useMemo(() => {
    const m = new Map<number, number>();
    blanks.forEach((b, i) => m.set(b.wordIndex, i));
    return m;
  }, [blanks]);

  const handleSelect = useCallback(
    (blankIdx: number, option: string) => {
      if (completed) return;
      if (blankStates[blankIdx].selected !== null) return; // already answered

      const isCorrect = option.toLowerCase() === blanks[blankIdx].answer.toLowerCase();
      const next = [...blankStates];
      next[blankIdx] = { selected: option, isCorrect };

      setBlankStates(next);

      // Check if all blanks answered
      const allAnswered = next.every((s) => s.selected !== null);
      if (allAnswered) {
        setCompleted(true);
        const correctCount = next.filter((s) => s.isCorrect).length;
        // Small delay so user sees the last answer's feedback
        setTimeout(() => onComplete(correctCount, next.length), 600);
      }
    },
    [blanks, blankStates, completed, onComplete]
  );

  // If we couldn't create any blanks (very short message), fall back
  if (blanks.length === 0) {
    return (
      <div
        style={{
          padding: '12px 16px',
          background: 'var(--bg-secondary, #f0f0f0)',
          borderRadius: 8,
          color: 'var(--text-secondary)',
          fontSize: '0.9rem',
          textAlign: 'center',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => onComplete(0, 0)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onComplete(0, 0); }}
        aria-label="Tap to reveal text"
      >
        🎧 Tap to reveal text
      </div>
    );
  }

  return (
    <div
      style={{ padding: '10px 14px', borderRadius: 8 }}
      role="region"
      aria-label="Listening comprehension cloze exercise"
    >
      {/* Cloze text */}
      <div
        style={{
          lineHeight: 1.8,
          fontSize: '0.95rem',
          color: completed ? 'var(--text-primary, #1a1a2e)' : 'var(--text-primary, #1a1a2e)',
          marginBottom: 10,
        }}
      >
        {words.map((word, wIdx) => {
          const blankIdx = blankIndexMap.get(wIdx);
          if (blankIdx === undefined) {
            return <span key={wIdx}>{word} </span>;
          }

          const state = blankStates[blankIdx];
          const blank = blanks[blankIdx];

          if (state.selected !== null) {
            // Show selected answer with color feedback
            const prefix = word.match(/^[^a-zA-Z0-9]*/)?.[0] || '';
            const suffix = word.match(/[^a-zA-Z0-9]*$/)?.[0] || '';
            return (
              <span key={wIdx}>
                {prefix}
                <span
                  style={{
                    display: 'inline-block',
                    padding: '1px 6px',
                    borderRadius: 6,
                    fontWeight: 600,
                    background: state.isCorrect
                      ? 'rgba(34,197,94,0.15)'
                      : 'rgba(239,68,68,0.15)',
                    color: state.isCorrect
                      ? 'var(--success, #22c55e)'
                      : 'var(--danger, #ef4444)',
                    textDecoration: state.isCorrect ? 'none' : 'line-through',
                  }}
                  title={state.isCorrect ? 'Correct!' : `Correct answer: ${blank.answer}`}
                >
                  {state.isCorrect ? (
                    <><CheckCircle size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} />{state.selected}</>
                  ) : (
                    <><XCircle size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} />{state.selected}</>
                  )}
                </span>
                {!state.isCorrect && (
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '1px 6px',
                      borderRadius: 6,
                      fontWeight: 600,
                      marginLeft: 4,
                      background: 'rgba(34,197,94,0.15)',
                      color: 'var(--success, #22c55e)',
                      fontSize: '0.85rem',
                    }}
                  >
                    {blank.answer}
                  </span>
                )}
                {suffix}{' '}
              </span>
            );
          }

          // Show blank placeholder
          return (
            <span
              key={wIdx}
              style={{
                display: 'inline-block',
                minWidth: 60,
                borderBottom: '2px dashed var(--primary, #6366f1)',
                textAlign: 'center',
                color: 'var(--primary, #6366f1)',
                fontWeight: 600,
                margin: '0 2px',
                padding: '0 4px',
                fontSize: '0.85rem',
              }}
              aria-label={`Blank ${blankIdx + 1}`}
            >
              ____
            </span>
          );
        })}
      </div>

      {/* Option chips per blank */}
      {!completed && blanks.map((blank, blankIdx) => {
        const state = blankStates[blankIdx];
        if (state.selected !== null) return null;
        return (
          <div
            key={blankIdx}
            style={{
              marginBottom: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                minWidth: 60,
              }}
            >
              Blank {blankIdx + 1}:
            </span>
            {blank.options.map((opt) => (
              <button
                key={opt}
                onClick={() => handleSelect(blankIdx, opt)}
                aria-label={`Select "${opt}" for blank ${blankIdx + 1}`}
                style={{
                  padding: '4px 12px',
                  borderRadius: 16,
                  border: '1px solid var(--border, #e2e8f0)',
                  background: 'var(--bg-secondary, #f8f9fa)',
                  color: 'var(--text-primary, #1a1a2e)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--primary, #6366f1)';
                  e.currentTarget.style.color = '#fff';
                  e.currentTarget.style.borderColor = 'var(--primary, #6366f1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--bg-secondary, #f8f9fa)';
                  e.currentTarget.style.color = 'var(--text-primary, #1a1a2e)';
                  e.currentTarget.style.borderColor = 'var(--border, #e2e8f0)';
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        );
      })}

      {/* Completion summary */}
      {completed && (
        <div
          style={{
            marginTop: 6,
            padding: '6px 10px',
            borderRadius: 8,
            background: blankStates.every((s) => s.isCorrect)
              ? 'rgba(34,197,94,0.1)'
              : 'rgba(234,179,8,0.1)',
            fontSize: '0.8rem',
            fontWeight: 600,
            color: blankStates.every((s) => s.isCorrect)
              ? 'var(--success, #22c55e)'
              : 'var(--warning, #eab308)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
          role="status"
          aria-live="polite"
        >
          {blankStates.every((s) => s.isCorrect) ? (
            <>✅ Perfect — all blanks correct!</>
          ) : (
            <>🎧 {blankStates.filter((s) => s.isCorrect).length}/{blankStates.length} correct — full text revealed</>
          )}
        </div>
      )}
    </div>
  );
}
