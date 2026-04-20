import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, X, ChefHat, RotateCcw } from 'lucide-react';
import {
  getCollocationChefSession,
  submitCollocationChefAttempt,
  type CollocationChefItem,
  type CollocationDifficulty,
} from '../api';

type Phase = 'select' | 'loading' | 'drill' | 'summary' | 'error';

interface AttemptResult {
  item: CollocationChefItem;
  chosen_verb: string;
  is_correct: boolean;
  response_ms: number;
}

const DIFFICULTIES: CollocationDifficulty[] = ['easy', 'medium', 'hard'];
const DEFAULT_COUNT = 8;

export default function CollocationChef() {
  const [phase, setPhase] = useState<Phase>('select');
  const [difficulty, setDifficulty] = useState<CollocationDifficulty>('easy');
  const [items, setItems] = useState<CollocationChefItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number>(0);
  const [results, setResults] = useState<AttemptResult[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  const current = items[idx];
  const showFeedback = chosen !== null;

  const startSession = useCallback(
    async (d: CollocationDifficulty, overrideItems?: CollocationChefItem[]) => {
      setPhase('loading');
      setErrorMsg('');
      try {
        let nextItems = overrideItems;
        if (!nextItems) {
          const res = await getCollocationChefSession(DEFAULT_COUNT, d);
          nextItems = res.items;
        }
        if (!nextItems || nextItems.length === 0) {
          setErrorMsg('No items were returned. Please try again.');
          setPhase('error');
          return;
        }
        setItems(nextItems);
        setIdx(0);
        setChosen(null);
        setResults([]);
        setStartedAt(Date.now());
        setPhase('drill');
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    },
    []
  );

  const handleChoose = useCallback(
    async (verb: string) => {
      if (!current || chosen !== null) return;
      const elapsed = Math.max(0, Date.now() - startedAt);
      const isCorrect = verb.toLowerCase() === current.correct_verb.toLowerCase();
      setChosen(verb);
      const sentence = `${current.sentence_before} ___ ${current.sentence_after}`;
      try {
        await submitCollocationChefAttempt({
          item_id: current.id,
          sentence,
          correct_verb: current.correct_verb,
          chosen_verb: verb,
          is_correct: isCorrect,
          response_ms: elapsed,
        });
      } catch {
        // non-fatal: still advance
      }
      setResults((rs) => [
        ...rs,
        { item: current, chosen_verb: verb, is_correct: isCorrect, response_ms: elapsed },
      ]);
    },
    [current, chosen, startedAt]
  );

  const handleNext = useCallback(() => {
    if (idx + 1 >= items.length) {
      setPhase('summary');
      return;
    }
    setIdx(idx + 1);
    setChosen(null);
    setStartedAt(Date.now());
  }, [idx, items.length]);

  // Keyboard 1..4 selects a chip; Enter advances when feedback is showing.
  useEffect(() => {
    if (phase !== 'drill' || !current) return;
    const handler = (e: KeyboardEvent) => {
      if (showFeedback && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        handleNext();
        return;
      }
      const n = parseInt(e.key, 10);
      if (!Number.isNaN(n) && n >= 1 && n <= current.verb_choices.length && !showFeedback) {
        e.preventDefault();
        handleChoose(current.verb_choices[n - 1]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [phase, current, showFeedback, handleChoose, handleNext]);

  const retryWrong = useCallback(() => {
    const wrongItems = results.filter((r) => !r.is_correct).map((r) => r.item);
    if (wrongItems.length === 0) return;
    startSession(difficulty, wrongItems);
  }, [results, difficulty, startSession]);

  const summary = useMemo(() => {
    const total = results.length;
    const correct = results.filter((r) => r.is_correct).length;
    const accuracy = total ? correct / total : 0;
    const perVerb: Record<string, { total: number; correct: number }> = {};
    for (const r of results) {
      const v = r.item.correct_verb.toLowerCase();
      const b = perVerb[v] || { total: 0, correct: 0 };
      b.total += 1;
      if (r.is_correct) b.correct += 1;
      perVerb[v] = b;
    }
    const perVerbPct = Object.entries(perVerb).map(([verb, { total: t, correct: c }]) => ({
      verb,
      accuracy: t ? c / t : 0,
      total: t,
    }));
    perVerbPct.sort((a, b) => a.accuracy - b.accuracy || a.verb.localeCompare(b.verb));
    const weakest = perVerbPct.find((v) => v.accuracy < 1);
    return { total, correct, accuracy, perVerbPct, weakest };
  }, [results]);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1rem' }}>
      <Link
        to="/"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: '1rem',
          textDecoration: 'none', color: 'var(--text-secondary)', fontSize: 14,
        }}
      >
        <ArrowLeft size={16} /> Back to Home
      </Link>

      <h1
        data-testid="collocation-chef-title"
        style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}
      >
        <ChefHat size={28} color="#f59e0b" />
        Collocation Chef
      </h1>
      <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>
        Pick the right verb — make, do, take, have, give… — for each collocation.
      </p>

      {phase === 'select' && (
        <section
          data-testid="collocation-chef-select"
          className="card"
          style={{
            padding: '1.25rem', border: '1px solid var(--border)',
            borderRadius: 12, marginTop: '1rem',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Choose a difficulty</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                data-testid={`collocation-chef-difficulty-${d}`}
                onClick={() => setDifficulty(d)}
                style={{
                  padding: '8px 14px', borderRadius: 8,
                  border: `1px solid ${difficulty === d ? '#f59e0b' : 'var(--border)'}`,
                  background: difficulty === d ? 'rgba(245, 158, 11, 0.12)' : 'transparent',
                  color: 'inherit', cursor: 'pointer', textTransform: 'capitalize',
                  fontWeight: difficulty === d ? 600 : 400,
                }}
              >
                {d}
              </button>
            ))}
          </div>
          <button
            data-testid="collocation-chef-start"
            onClick={() => startSession(difficulty)}
            style={{
              padding: '10px 18px', borderRadius: 8, border: 'none',
              background: '#f59e0b', color: 'white', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Start session ({DEFAULT_COUNT} items)
          </button>
        </section>
      )}

      {phase === 'loading' && (
        <div data-testid="collocation-chef-loading" style={{ padding: '2rem', textAlign: 'center' }}>
          Loading…
        </div>
      )}

      {phase === 'error' && (
        <div
          data-testid="collocation-chef-error"
          style={{
            padding: '1rem', color: '#b91c1c',
            background: 'rgba(239, 68, 68, 0.1)', borderRadius: 8, marginTop: '1rem',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Something went wrong</div>
          <div style={{ fontSize: 13 }}>{errorMsg}</div>
          <button
            onClick={() => setPhase('select')}
            style={{
              marginTop: 12, padding: '6px 12px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'inherit', cursor: 'pointer',
            }}
          >
            Back
          </button>
        </div>
      )}

      {phase === 'drill' && current && (
        <section data-testid="collocation-chef-drill" style={{ marginTop: '1rem' }}>
          <div
            data-testid="collocation-chef-progress"
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8,
            }}
          >
            <span>Item {idx + 1} / {items.length}</span>
            <span style={{ textTransform: 'capitalize' }}>{current.difficulty}</span>
          </div>
          <div
            aria-hidden
            style={{
              height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden',
              marginBottom: 16,
            }}
          >
            <div
              data-testid="collocation-chef-progress-bar"
              style={{
                height: '100%', width: `${((idx) / items.length) * 100}%`,
                background: '#f59e0b', transition: 'width 200ms ease',
              }}
            />
          </div>

          <div
            data-testid="collocation-chef-sentence"
            style={{
              padding: '1.25rem', border: '1px solid var(--border)', borderRadius: 12,
              fontSize: 18, lineHeight: 1.6, marginBottom: 16,
            }}
          >
            {current.sentence_before}{' '}
            <span
              style={{
                display: 'inline-block', minWidth: 80, padding: '0 10px',
                borderBottom: '2px solid #f59e0b',
                color: showFeedback ? (chosen && chosen.toLowerCase() === current.correct_verb.toLowerCase() ? '#059669' : '#dc2626') : 'inherit',
                fontWeight: 600,
              }}
            >
              {showFeedback ? current.correct_verb : '____'}
            </span>{' '}
            <span style={{ fontWeight: 600 }}>{current.noun_phrase}</span>{' '}
            {current.sentence_after}
          </div>

          <div
            data-testid="collocation-chef-chips"
            style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 10, marginBottom: 16,
            }}
          >
            {current.verb_choices.map((verb, i) => {
              const isCorrect = verb.toLowerCase() === current.correct_verb.toLowerCase();
              const isChosen = chosen === verb;
              let bg = 'transparent';
              let border = 'var(--border)';
              if (showFeedback) {
                if (isCorrect) {
                  bg = 'rgba(16, 185, 129, 0.15)'; border = '#059669';
                } else if (isChosen) {
                  bg = 'rgba(239, 68, 68, 0.15)'; border = '#dc2626';
                }
              }
              return (
                <button
                  key={verb}
                  data-testid={`collocation-chef-chip-${verb}`}
                  onClick={() => handleChoose(verb)}
                  disabled={showFeedback}
                  style={{
                    padding: '12px 10px', borderRadius: 10,
                    border: `2px solid ${border}`, background: bg,
                    color: 'inherit', fontSize: 16, fontWeight: 600,
                    cursor: showFeedback ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  <span style={{ fontSize: 11, opacity: 0.6 }}>{i + 1}</span>
                  <span>{verb}</span>
                </button>
              );
            })}
          </div>

          {showFeedback && (
            <div
              data-testid="collocation-chef-feedback"
              style={{
                padding: '1rem', borderRadius: 10,
                background:
                  chosen && chosen.toLowerCase() === current.correct_verb.toLowerCase()
                    ? 'rgba(16, 185, 129, 0.1)'
                    : 'rgba(239, 68, 68, 0.1)',
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontWeight: 600, marginBottom: 6,
                  color:
                    chosen && chosen.toLowerCase() === current.correct_verb.toLowerCase()
                      ? '#059669'
                      : '#dc2626',
                }}
              >
                {chosen && chosen.toLowerCase() === current.correct_verb.toLowerCase()
                  ? <><Check size={18} /> Correct — <em>{current.correct_verb}</em></>
                  : <><X size={18} /> Answer: <em>{current.correct_verb}</em></>}
              </div>
              <div style={{ fontSize: 14, marginBottom: 6 }}>{current.hint}</div>
              {current.related_collocations.length > 0 && (
                <div
                  data-testid="collocation-chef-related"
                  style={{ fontSize: 13, color: 'var(--text-secondary)' }}
                >
                  Related: {current.related_collocations.join(' · ')}
                </div>
              )}
            </div>
          )}

          {showFeedback && (
            <button
              data-testid="collocation-chef-next"
              onClick={handleNext}
              style={{
                padding: '10px 18px', borderRadius: 8, border: 'none',
                background: '#f59e0b', color: 'white', fontWeight: 600, cursor: 'pointer',
              }}
            >
              {idx + 1 >= items.length ? 'See summary' : 'Next'}
            </button>
          )}
        </section>
      )}

      {phase === 'summary' && (
        <section
          data-testid="collocation-chef-summary"
          style={{
            marginTop: '1rem', padding: '1.25rem', border: '1px solid var(--border)',
            borderRadius: 12,
          }}
        >
          <div data-testid="collocation-chef-score" style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            {summary.correct} / {summary.total} correct ({Math.round(summary.accuracy * 100)}%)
          </div>
          {summary.weakest && (
            <div
              data-testid="collocation-chef-weakest"
              style={{
                padding: '8px 12px', background: 'rgba(245, 158, 11, 0.1)',
                borderRadius: 8, marginBottom: 12, fontSize: 14,
              }}
            >
              Focus next: <strong>{summary.weakest.verb}</strong> ({Math.round(summary.weakest.accuracy * 100)}%)
            </div>
          )}

          <div data-testid="collocation-chef-per-verb" style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Accuracy by verb</div>
            {summary.perVerbPct.map((row) => (
              <div
                key={row.verb}
                data-testid={`collocation-chef-bar-${row.verb}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
                  marginBottom: 4,
                }}
              >
                <span style={{ width: 70 }}>{row.verb}</span>
                <div style={{ flex: 1, background: 'var(--border)', borderRadius: 4, height: 10 }}>
                  <div
                    style={{
                      width: `${row.accuracy * 100}%`, background: '#f59e0b',
                      height: '100%', borderRadius: 4, transition: 'width 200ms ease',
                    }}
                  />
                </div>
                <span style={{ width: 48, textAlign: 'right' }}>{Math.round(row.accuracy * 100)}%</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
            {results.some((r) => !r.is_correct) && (
              <button
                data-testid="collocation-chef-retry-wrong"
                onClick={retryWrong}
                style={{
                  padding: '10px 16px', borderRadius: 8, border: '1px solid var(--border)',
                  background: 'transparent', color: 'inherit', fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                }}
              >
                <RotateCcw size={16} /> Retry wrong ({results.filter((r) => !r.is_correct).length})
              </button>
            )}
            <button
              data-testid="collocation-chef-next-session"
              onClick={() => startSession(difficulty)}
              style={{
                padding: '10px 16px', borderRadius: 8, border: 'none',
                background: '#f59e0b', color: 'white', fontWeight: 600, cursor: 'pointer',
              }}
            >
              Next session
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
