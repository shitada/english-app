import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, X, RotateCcw } from 'lucide-react';
import {
  fetchPhrasalVerbDrill,
  postPhrasalVerbAttempt,
  type PhrasalVerbItem,
  type PhrasalVerbLevel,
} from '../api';

type Phase = 'select' | 'loading' | 'drill' | 'feedback' | 'summary' | 'error';

interface AttemptResult {
  item: PhrasalVerbItem;
  user_answer: string;
  correct: boolean;
}

const LS_KEY = 'phrasal_verb_progress_v1';
const DEFAULT_COUNT = 10;

// -----------------------------------------------------------------------------
// Exported pure helpers (for tests)
// -----------------------------------------------------------------------------

/** Normalize an answer for case-insensitive trimmed comparison. */
export function normalizeAnswer(raw: string): string {
  return (raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Return true when `userAnswer` matches the item's `particle` (or any of its
 * `accepted` synonyms), comparing case-insensitively after trimming.
 */
export function isAnswerCorrect(item: PhrasalVerbItem, userAnswer: string): boolean {
  const u = normalizeAnswer(userAnswer);
  if (!u) return false;
  if (u === normalizeAnswer(item.particle)) return true;
  return (item.accepted || []).some((alt) => u === normalizeAnswer(alt));
}

interface Progress {
  wrong: Record<string, number>;
  seen: Record<string, number>;
}

function readProgress(): Progress {
  if (typeof window === 'undefined') return { wrong: {}, seen: {} };
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return { wrong: {}, seen: {} };
    const parsed = JSON.parse(raw);
    return {
      wrong: typeof parsed.wrong === 'object' && parsed.wrong ? parsed.wrong : {},
      seen: typeof parsed.seen === 'object' && parsed.seen ? parsed.seen : {},
    };
  } catch {
    return { wrong: {}, seen: {} };
  }
}

function writeProgress(p: Progress) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/**
 * Sort items by a weak-first heuristic: items with more past-wrong answers
 * rank earlier, then items never seen before, then everything else.
 */
export function prioritizeByProgress(
  items: PhrasalVerbItem[],
  progress: Progress,
): PhrasalVerbItem[] {
  const score = (it: PhrasalVerbItem): number => {
    const wrong = progress.wrong[it.id] || 0;
    const seen = progress.seen[it.id] || 0;
    // Higher = earlier. Unseen items get a mild boost over easy-ones.
    return wrong * 10 + (seen === 0 ? 1 : 0);
  };
  return [...items].sort((a, b) => score(b) - score(a));
}

const LEVELS: { id: PhrasalVerbLevel; label: string; emoji: string; desc: string }[] = [
  { id: 'beginner', emoji: '🌱', label: 'Beginner', desc: 'turn on, get up, sit down…' },
  { id: 'intermediate', emoji: '🌿', label: 'Intermediate', desc: 'look up, run into, give up…' },
  { id: 'advanced', emoji: '🌳', label: 'Advanced', desc: 'put up with, look forward to…' },
];

export default function PhrasalVerbDrill() {
  const [phase, setPhase] = useState<Phase>('select');
  const [level, setLevel] = useState<PhrasalVerbLevel>('beginner');
  const [errorMsg, setErrorMsg] = useState('');
  const [items, setItems] = useState<PhrasalVerbItem[]>([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [results, setResults] = useState<AttemptResult[]>([]);
  const [lastCorrect, setLastCorrect] = useState(false);

  const current = items[index] || null;

  const correctCount = useMemo(
    () => results.filter((r) => r.correct).length,
    [results],
  );

  const startDrill = useCallback(
    async (opts?: { retryMissedOnly?: boolean; selectedLevel?: PhrasalVerbLevel }) => {
      const target = opts?.selectedLevel || level;
      setErrorMsg('');
      setPhase('loading');
      setIndex(0);
      setAnswer('');
      setResults([]);
      try {
        const data = await fetchPhrasalVerbDrill(DEFAULT_COUNT, target);
        const progress = readProgress();
        let picked = prioritizeByProgress(data.items, progress);
        if (opts?.retryMissedOnly) {
          const missedIds = new Set(
            results.filter((r) => !r.correct).map((r) => r.item.id),
          );
          picked = picked.filter((it) => missedIds.has(it.id));
        }
        if (picked.length === 0) {
          setErrorMsg('No items to practice.');
          setPhase('error');
          return;
        }
        setItems(picked);
        setPhase('drill');
      } catch (err) {
        setErrorMsg((err as Error).message || 'Failed to load drill');
        setPhase('error');
      }
    },
    [level, results],
  );

  const handleSubmit = useCallback(() => {
    if (!current) return;
    const correct = isAnswerCorrect(current, answer);
    setLastCorrect(correct);

    const progress = readProgress();
    progress.seen[current.id] = (progress.seen[current.id] || 0) + 1;
    if (!correct) {
      progress.wrong[current.id] = (progress.wrong[current.id] || 0) + 1;
    }
    writeProgress(progress);

    setResults((prev) => [
      ...prev,
      { item: current, user_answer: answer, correct },
    ]);

    // Fire-and-forget logging.
    postPhrasalVerbAttempt({
      id: current.id,
      user_answer: answer,
      correct,
    }).catch(() => {
      /* ignore */
    });

    setPhase('feedback');
  }, [answer, current]);

  const handleNext = useCallback(() => {
    if (index + 1 >= items.length) {
      setPhase('summary');
    } else {
      setIndex(index + 1);
      setAnswer('');
      setPhase('drill');
    }
  }, [index, items.length]);

  // Keep input focused-friendly by submitting on Enter.
  useEffect(() => {
    if (phase !== 'drill') return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && answer.trim()) {
        handleSubmit();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [phase, answer, handleSubmit]);

  const hasMissed = results.some((r) => !r.correct);
  const accuracyPct = results.length
    ? Math.round((correctCount / results.length) * 100)
    : 0;

  return (
    <div
      data-testid="phrasal-verb-page"
      style={{ maxWidth: 720, margin: '0 auto', padding: '1rem' }}
    >
      <Link
        to="/"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          marginBottom: '1rem', fontSize: 14, color: 'var(--text-secondary)',
          textDecoration: 'none',
        }}
      >
        <ArrowLeft size={16} /> Home
      </Link>

      <h1
        data-testid="phrasal-verb-title"
        style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}
      >
        🧩 Phrasal Verb Particle Drill
      </h1>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
        Type the missing particle (e.g. <em>off</em>, <em>up</em>, <em>up with</em>).
        Productive recall beats passive recognition.
      </p>

      {phase === 'select' && (
        <div data-testid="phrasal-verb-select">
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Choose a level</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {LEVELS.map((l) => (
              <button
                key={l.id}
                data-testid={`phrasal-verb-level-${l.id}`}
                onClick={() => setLevel(l.id)}
                style={{
                  textAlign: 'left', padding: '12px 14px',
                  borderRadius: 10,
                  border: level === l.id
                    ? '2px solid #8b5cf6'
                    : '1px solid var(--border)',
                  background: level === l.id ? 'rgba(139,92,246,0.08)' : 'transparent',
                  cursor: 'pointer', color: 'inherit',
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {l.emoji} {l.label}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {l.desc}
                </div>
              </button>
            ))}
          </div>
          <button
            data-testid="phrasal-verb-start"
            onClick={() => startDrill({ selectedLevel: level })}
            style={{
              marginTop: 16, width: '100%', padding: '12px 16px',
              background: '#8b5cf6', color: 'white', border: 'none',
              borderRadius: 10, fontWeight: 600, fontSize: 15, cursor: 'pointer',
            }}
          >
            Start drill ({DEFAULT_COUNT} items)
          </button>
        </div>
      )}

      {phase === 'loading' && (
        <div data-testid="phrasal-verb-loading" style={{ padding: 24, textAlign: 'center' }}>
          Loading…
        </div>
      )}

      {phase === 'error' && (
        <div
          data-testid="phrasal-verb-error"
          style={{
            padding: 16, border: '1px solid #ef4444', borderRadius: 10,
            background: 'rgba(239,68,68,0.08)', color: '#ef4444',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Oops</div>
          <div style={{ fontSize: 14 }}>{errorMsg}</div>
          <button
            onClick={() => setPhase('select')}
            style={{
              marginTop: 12, padding: '8px 14px', border: '1px solid var(--border)',
              background: 'transparent', color: 'inherit', borderRadius: 8, cursor: 'pointer',
            }}
          >
            Back
          </button>
        </div>
      )}

      {phase === 'drill' && current && (
        <div data-testid="phrasal-verb-drill">
          <div style={{
            fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8,
          }}>
            Item {index + 1} of {items.length} · {level}
          </div>
          <div
            style={{
              padding: 16, border: '1px solid var(--border)', borderRadius: 12,
              marginBottom: 12, background: 'var(--bg-card, transparent)',
            }}
          >
            <div style={{ fontSize: 14, marginBottom: 4, color: 'var(--text-secondary)' }}>
              Meaning
            </div>
            <div style={{ fontSize: 15, marginBottom: 12 }}>
              <strong>{current.verb}</strong> ____ — {current.meaning}
            </div>
            <div style={{ fontSize: 14, marginBottom: 4, color: 'var(--text-secondary)' }}>
              Example
            </div>
            <div data-testid="phrasal-verb-example" style={{ fontSize: 16, fontWeight: 500 }}>
              {current.example_with_blank}
            </div>
          </div>
          <input
            data-testid="phrasal-verb-input"
            type="text"
            autoFocus
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type the missing particle…"
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 10,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'inherit', fontSize: 16, boxSizing: 'border-box',
            }}
          />
          <button
            data-testid="phrasal-verb-submit"
            onClick={handleSubmit}
            disabled={!answer.trim()}
            style={{
              marginTop: 12, width: '100%', padding: '12px 16px',
              background: answer.trim() ? '#8b5cf6' : 'var(--border)',
              color: 'white', border: 'none', borderRadius: 10,
              fontWeight: 600, fontSize: 15,
              cursor: answer.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Check answer
          </button>
        </div>
      )}

      {phase === 'feedback' && current && (
        <div data-testid="phrasal-verb-feedback">
          <div
            style={{
              padding: 16, borderRadius: 12, marginBottom: 12,
              background: lastCorrect
                ? 'rgba(16,185,129,0.08)'
                : 'rgba(239,68,68,0.08)',
              border: `1px solid ${lastCorrect ? '#10b981' : '#ef4444'}`,
            }}
          >
            <div
              data-testid="phrasal-verb-feedback-result"
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontWeight: 700, fontSize: 16,
                color: lastCorrect ? '#10b981' : '#ef4444',
                marginBottom: 8,
              }}
            >
              {lastCorrect ? <Check size={20} /> : <X size={20} />}
              {lastCorrect ? 'Correct!' : 'Not quite'}
            </div>
            <div style={{ fontSize: 14, marginBottom: 4, color: 'var(--text-secondary)' }}>
              Answer
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
              <span style={{ color: '#8b5cf6' }}>{current.particle}</span>
              {current.accepted && current.accepted.length > 0 && (
                <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
                  {' '}(also: {current.accepted.join(', ')})
                </span>
              )}
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
              {current.example_full}
            </div>
          </div>
          <button
            data-testid="phrasal-verb-next"
            onClick={handleNext}
            style={{
              width: '100%', padding: '12px 16px', background: '#8b5cf6',
              color: 'white', border: 'none', borderRadius: 10,
              fontWeight: 600, fontSize: 15, cursor: 'pointer',
            }}
          >
            {index + 1 >= items.length ? 'See summary' : 'Next'}
          </button>
        </div>
      )}

      {phase === 'summary' && (
        <div data-testid="phrasal-verb-summary">
          <div
            style={{
              padding: 20, textAlign: 'center', borderRadius: 12,
              border: '1px solid var(--border)', marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Session complete
            </div>
            <div
              data-testid="phrasal-verb-score"
              style={{ fontSize: 36, fontWeight: 800, color: '#8b5cf6' }}
            >
              {correctCount} / {results.length}
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
              {accuracyPct}% accuracy
            </div>
          </div>

          {results.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
                Review
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {results.map((r, i) => (
                  <div
                    key={`${r.item.id}-${i}`}
                    style={{
                      display: 'flex', justifyContent: 'space-between',
                      padding: '8px 12px', borderRadius: 8,
                      border: '1px solid var(--border)',
                      fontSize: 14,
                    }}
                  >
                    <span>
                      {r.correct ? '✅' : '❌'}{' '}
                      <strong>{r.item.verb}</strong> {r.item.particle}
                    </span>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      you: <em>{r.user_answer || '—'}</em>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              data-testid="phrasal-verb-restart"
              onClick={() => {
                setPhase('select');
                setResults([]);
                setItems([]);
                setIndex(0);
                setAnswer('');
              }}
              style={{
                flex: 1, padding: '12px 14px', borderRadius: 10,
                border: '1px solid var(--border)', background: 'transparent',
                color: 'inherit', cursor: 'pointer', fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <RotateCcw size={16} /> New drill
            </button>
            {hasMissed && (
              <button
                data-testid="phrasal-verb-retry-missed"
                onClick={() => startDrill({ retryMissedOnly: true })}
                style={{
                  flex: 1, padding: '12px 14px', borderRadius: 10,
                  border: 'none', background: '#8b5cf6', color: 'white',
                  cursor: 'pointer', fontWeight: 600,
                }}
              >
                Retry missed only
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
