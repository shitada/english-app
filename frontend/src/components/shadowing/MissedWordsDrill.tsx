import { Volume2 } from 'lucide-react';

/** Rate used for tap-to-hear and Play-all-slowly drill TTS. */
export const DRILL_RATE = 0.7;

/** Default gap (ms) between consecutive words in Play-all-slowly. */
export const DRILL_DEFAULT_GAP_MS = 700;

export type SpeakFn = (text: string, lang?: string, rateOverride?: number) => void;

/**
 * Pure helper: pick the missed (unmatched) words from an expected sentence
 * compared with what was actually transcribed. Comparison is whole-word and
 * case-insensitive (delegates to the same word tokenization used by the
 * Shadowing scorer). Returns deduplicated words preserving first-seen order.
 */
const WORD_RE = /[a-z0-9']+/g;
function tokenize(text: string): string[] {
  return (text || '').toLowerCase().match(WORD_RE) || [];
}

export function getMissedWords(expected: string, transcript: string): string[] {
  const exp = tokenize(expected);
  const trSet = new Set(tokenize(transcript));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of exp) {
    if (!trSet.has(w) && !seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}

/**
 * Pure handler: speak a single drill word at the slow drill rate.
 * Exposed so unit tests can assert the (text, lang, rate) call shape
 * without needing a DOM.
 */
export function handleDrillChipClick(word: string, speak: SpeakFn): void {
  if (!word) return;
  speak(word, 'en-US', DRILL_RATE);
}

/**
 * Pure helper: schedule sequential TTS for each missed word, with a short
 * gap between words. The `schedule` parameter is injected so tests can
 * pass a synchronous stub (e.g. `(cb) => cb()`) and assert that `speak`
 * is called once per word with rate=DRILL_RATE.
 */
export function playAllMissed(
  words: string[],
  speak: SpeakFn,
  opts?: { gapMs?: number; schedule?: (cb: () => void, ms: number) => void },
): void {
  if (!Array.isArray(words) || words.length === 0) return;
  const gap = opts?.gapMs ?? DRILL_DEFAULT_GAP_MS;
  const schedule = opts?.schedule ?? ((cb, ms) => { setTimeout(cb, ms); });
  words.forEach((w, idx) => {
    if (idx === 0) {
      speak(w, 'en-US', DRILL_RATE);
    } else {
      schedule(() => speak(w, 'en-US', DRILL_RATE), idx * gap);
    }
  });
}

interface MissedWordsDrillProps {
  /** The full expected sentence the learner was supposed to repeat. */
  expected: string;
  /** What the recognizer captured from the learner. */
  transcript: string;
  /** Speech-synthesis speak fn (typically from useSpeechSynthesis). */
  speak: SpeakFn;
}

/**
 * Renders a small interactive panel beneath the Shadowing word-check diff:
 * each missed word is a tappable chip that re-speaks the word at slow rate,
 * plus a "Play all slowly" button that cycles through them. When the
 * learner missed nothing, shows a celebratory perfect-state line.
 */
export function MissedWordsDrill({ expected, transcript, speak }: MissedWordsDrillProps) {
  const missed = getMissedWords(expected, transcript);

  if (missed.length === 0) {
    return (
      <div
        data-testid="drill-perfect-state"
        style={{
          marginTop: 6,
          padding: '0.45rem 0.6rem',
          borderRadius: 8,
          fontSize: 13,
          background: 'rgba(34,197,94,0.10)',
          color: '#16a34a',
          border: '1px solid rgba(34,197,94,0.30)',
        }}
      >
        Perfect — no drill needed 🎉
      </div>
    );
  }

  return (
    <div
      data-testid="missed-words-drill"
      style={{
        marginTop: 6,
        padding: '0.55rem 0.65rem',
        borderRadius: 8,
        background: 'var(--bg, #f8fafc)',
        border: '1px solid var(--border)',
        color: 'var(--text)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 6,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600 }}>Drill missed words</div>
        <button
          type="button"
          className="btn"
          data-testid="drill-play-all"
          onClick={() => playAllMissed(missed, speak)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            padding: '4px 10px',
          }}
          aria-label="Play all missed words slowly"
        >
          <Volume2 size={12} /> Play all slowly
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {missed.map((w, i) => (
          <button
            key={`${w}-${i}`}
            type="button"
            data-testid="missed-word-chip"
            onClick={() => handleDrillChipClick(w, speak)}
            aria-label={`Hear "${w}" slowly`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 9px',
              borderRadius: 999,
              fontSize: 13,
              cursor: 'pointer',
              background: 'rgba(99,102,241,0.10)',
              color: 'var(--primary, #6366f1)',
              border: '1px solid rgba(99,102,241,0.35)',
            }}
          >
            <Volume2 size={12} />
            {w}
          </button>
        ))}
      </div>
    </div>
  );
}
