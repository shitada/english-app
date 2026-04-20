import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, X, RotateCcw } from 'lucide-react';
import {
  fetchPrepositionSession,
  postPrepositionAttempt,
  fetchPrepositionStats,
  type PrepositionItem,
  type PrepositionLevel,
  type PrepositionStatsResponse,
} from '../api';

type Phase = 'select' | 'loading' | 'drill' | 'summary' | 'error';

interface AttemptRecord {
  item: PrepositionItem;
  chosen: string;
  correct: boolean;
}

const DEFAULT_COUNT = 8;

const LEVELS: {
  id: PrepositionLevel | 'mixed';
  label: string;
  emoji: string;
  desc: string;
}[] = [
  { id: 'mixed', emoji: '🎯', label: 'Mixed', desc: 'All levels mixed together' },
  { id: 'beginner', emoji: '🌱', label: 'Beginner', desc: 'time / place basics' },
  { id: 'intermediate', emoji: '🌿', label: 'Intermediate', desc: 'collocations + phrasals' },
];

function renderSentence(text: string, blankValue: string | null): React.ReactNode {
  const parts = text.split('___');
  return (
    <>
      {parts.map((piece, i) => (
        <span key={i}>
          {piece}
          {i < parts.length - 1 && (
            <span
              data-testid="preposition-blank"
              style={{
                display: 'inline-block',
                minWidth: 64,
                padding: '2px 10px',
                margin: '0 4px',
                borderBottom: '2px solid var(--border)',
                fontWeight: 700,
                color: blankValue ? 'var(--text-primary)' : 'transparent',
                textAlign: 'center',
              }}
            >
              {blankValue || '___'}
            </span>
          )}
        </span>
      ))}
    </>
  );
}

export default function PrepositionDrill() {
  const [phase, setPhase] = useState<Phase>('select');
  const [level, setLevel] = useState<PrepositionLevel | 'mixed'>('mixed');
  const [errorMsg, setErrorMsg] = useState('');

  const [items, setItems] = useState<PrepositionItem[]>([]);
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ correct: boolean; explanation: string; answer: string } | null>(
    null,
  );
  const [results, setResults] = useState<AttemptRecord[]>([]);
  const [stats, setStats] = useState<PrepositionStatsResponse | null>(null);

  const current = items[index] || null;

  const startDrill = useCallback(
    async (
      sel?: PrepositionLevel | 'mixed',
      useOnly?: PrepositionItem[],
    ) => {
      const target = sel || level;
      setErrorMsg('');
      setPhase('loading');
      setIndex(0);
      setChosen(null);
      setFeedback(null);
      setResults([]);
      setStats(null);
      try {
        if (useOnly && useOnly.length > 0) {
          setItems(useOnly);
          setPhase('drill');
          return;
        }
        const data = await fetchPrepositionSession(
          DEFAULT_COUNT,
          target === 'mixed' ? undefined : target,
        );
        if (!data.items || data.items.length === 0) {
          setErrorMsg('No items returned.');
          setPhase('error');
          return;
        }
        setItems(data.items);
        setPhase('drill');
      } catch (err) {
        setErrorMsg((err as Error).message || 'Failed to load session');
        setPhase('error');
      }
    },
    [level],
  );

  const handleChoose = useCallback(
    async (opt: string) => {
      if (!current || chosen !== null) return;
      setChosen(opt);
      try {
        const res = await postPrepositionAttempt({
          item_id: current.id,
          chosen: opt,
        });
        setFeedback({ correct: res.correct, explanation: res.explanation, answer: res.answer });
        setResults((r) => [
          ...r,
          { item: current, chosen: opt, correct: res.correct },
        ]);
      } catch (err) {
        setErrorMsg((err as Error).message || 'Attempt failed');
      }
    },
    [current, chosen],
  );

  const handleNext = useCallback(async () => {
    if (index + 1 >= items.length) {
      // show summary
      try {
        const s = await fetchPrepositionStats();
        setStats(s);
      } catch {
        /* ignore */
      }
      setPhase('summary');
      return;
    }
    setIndex((i) => i + 1);
    setChosen(null);
    setFeedback(null);
  }, [index, items.length]);

  const missedItems = useMemo(
    () => results.filter((r) => !r.correct).map((r) => r.item),
    [results],
  );

  const retryMissed = useCallback(() => {
    if (missedItems.length === 0) return;
    startDrill(undefined, missedItems);
  }, [missedItems, startDrill]);

  const accuracyPct = useMemo(() => {
    if (results.length === 0) return 0;
    const correct = results.filter((r) => r.correct).length;
    return Math.round((correct / results.length) * 100);
  }, [results]);

  const perCategory = useMemo(() => {
    const map = new Map<string, { attempts: number; correct: number }>();
    for (const r of results) {
      const cat = r.item.category;
      const cur = map.get(cat) || { attempts: 0, correct: 0 };
      cur.attempts += 1;
      if (r.correct) cur.correct += 1;
      map.set(cat, cur);
    }
    return Array.from(map.entries()).map(([cat, v]) => ({
      category: cat,
      attempts: v.attempts,
      correct: v.correct,
      accuracy: v.attempts > 0 ? v.correct / v.attempts : 0,
    }));
  }, [results]);

  // ==============================
  // Render
  // ==============================

  if (phase === 'select') {
    return (
      <div className="container" style={{ maxWidth: 720, padding: '1rem' }}>
        <Link
          to="/"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', textDecoration: 'none', marginBottom: 12 }}
        >
          <ArrowLeft size={16} /> Back
        </Link>
        <h1 data-testid="preposition-title" style={{ fontSize: 24, marginBottom: 8 }}>
          🔤 Preposition Cloze Drill
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
          Fill the blank with the right preposition — 4–6 chip options, instant explanation.
        </p>

        <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
          {LEVELS.map((lv) => (
            <button
              key={lv.id}
              data-testid={`preposition-level-${lv.id}`}
              onClick={() => setLevel(lv.id)}
              className="card"
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                border: level === lv.id ? '2px solid #0ea5e9' : '1px solid var(--border)',
                background: level === lv.id ? 'rgba(14,165,233,0.08)' : 'transparent',
                borderRadius: 12, cursor: 'pointer', textAlign: 'left', color: 'inherit',
              }}
            >
              <span style={{ fontSize: 24 }}>{lv.emoji}</span>
              <div>
                <div style={{ fontWeight: 600 }}>{lv.label}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{lv.desc}</div>
              </div>
            </button>
          ))}
        </div>

        <button
          data-testid="preposition-start"
          onClick={() => startDrill()}
          style={{
            padding: '10px 18px', borderRadius: 8, background: '#0ea5e9',
            color: 'white', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer',
          }}
        >
          Start drill ({DEFAULT_COUNT} items)
        </button>
      </div>
    );
  }

  if (phase === 'loading') {
    return (
      <div className="container" style={{ maxWidth: 720, padding: '1rem' }}>
        <p>Loading…</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="container" style={{ maxWidth: 720, padding: '1rem' }}>
        <p style={{ color: 'crimson' }}>{errorMsg || 'Something went wrong.'}</p>
        <button onClick={() => setPhase('select')}>Back</button>
      </div>
    );
  }

  if (phase === 'drill' && current) {
    return (
      <div className="container" data-testid="preposition-drill" style={{ maxWidth: 720, padding: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Link
            to="/"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', textDecoration: 'none' }}
          >
            <ArrowLeft size={16} /> Back
          </Link>
          <div data-testid="preposition-progress" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {index + 1} / {items.length}
          </div>
        </div>

        <div
          className="card"
          style={{
            padding: '1.25rem', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {current.category} · {current.level}
          </div>
          <div data-testid="preposition-sentence" style={{ fontSize: 20, lineHeight: 1.5, marginBottom: 12 }}>
            {renderSentence(current.sentence_with_blank, chosen)}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {current.options.map((opt) => {
            const isChosen = chosen === opt;
            const isAnswer = feedback && opt === feedback.answer;
            const showFeedback = chosen !== null;
            let bg = 'transparent';
            let border = '1px solid var(--border)';
            let color = 'inherit';
            if (showFeedback) {
              if (isAnswer) {
                bg = 'rgba(34,197,94,0.12)';
                border = '2px solid #22c55e';
                color = '#15803d';
              } else if (isChosen) {
                bg = 'rgba(239,68,68,0.12)';
                border = '2px solid #ef4444';
                color = '#b91c1c';
              }
            }
            return (
              <button
                key={opt}
                data-testid={`preposition-option-${opt}`}
                onClick={() => handleChoose(opt)}
                disabled={chosen !== null}
                style={{
                  padding: '8px 16px', borderRadius: 999, cursor: chosen ? 'default' : 'pointer',
                  fontSize: 15, fontWeight: 600, background: bg, border, color,
                  minWidth: 72,
                }}
              >
                {opt}
              </button>
            );
          })}
        </div>

        {feedback && (
          <div
            data-testid="preposition-feedback"
            style={{
              padding: '12px 14px', borderRadius: 10, marginBottom: 12,
              border: feedback.correct ? '1px solid #22c55e' : '1px solid #ef4444',
              background: feedback.correct ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontWeight: 600 }}>
              {feedback.correct ? <Check size={18} color="#22c55e" /> : <X size={18} color="#ef4444" />}
              <span data-testid="preposition-feedback-result">
                {feedback.correct ? 'Correct!' : `Answer: ${feedback.answer}`}
              </span>
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{feedback.explanation}</div>
          </div>
        )}

        {feedback && (
          <button
            data-testid="preposition-next"
            onClick={handleNext}
            style={{
              padding: '8px 18px', borderRadius: 8, background: '#0ea5e9',
              color: 'white', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
            }}
          >
            {index + 1 >= items.length ? 'Finish' : 'Next'}
          </button>
        )}
      </div>
    );
  }

  // summary
  return (
    <div className="container" data-testid="preposition-summary" style={{ maxWidth: 720, padding: '1rem' }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>📊 Summary</h1>
      <div
        className="card"
        style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 16 }}
      >
        <div data-testid="preposition-accuracy" style={{ fontSize: 32, fontWeight: 700 }}>{accuracyPct}%</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {results.filter((r) => r.correct).length} / {results.length} correct
        </div>
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 8 }}>By category</h2>
      <div data-testid="preposition-per-category" style={{ display: 'grid', gap: 6, marginBottom: 16 }}>
        {perCategory.map((c) => (
          <div
            key={c.category}
            style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8,
            }}
          >
            <span style={{ textTransform: 'capitalize' }}>{c.category}</span>
            <span>
              {c.correct} / {c.attempts} ({Math.round(c.accuracy * 100)}%)
            </span>
          </div>
        ))}
      </div>

      {stats && stats.confused_pairs.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>Most confused pairs (recent)</h2>
          <div data-testid="preposition-confused-pairs" style={{ display: 'grid', gap: 6, marginBottom: 16 }}>
            {stats.confused_pairs.map((p, i) => (
              <div
                key={`${p.correct}-${p.chosen}-${i}`}
                style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8,
                }}
              >
                <span>
                  <strong>{p.correct}</strong> was confused with <strong>{p.chosen}</strong>
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>×{p.count}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {missedItems.length > 0 && (
          <button
            data-testid="preposition-retry-missed"
            onClick={retryMissed}
            style={{
              padding: '8px 16px', borderRadius: 8, background: '#f59e0b',
              color: 'white', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <RotateCcw size={14} /> Retry missed ({missedItems.length})
          </button>
        )}
        <button
          data-testid="preposition-new-session"
          onClick={() => setPhase('select')}
          style={{
            padding: '8px 16px', borderRadius: 8, background: '#0ea5e9',
            color: 'white', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
          }}
        >
          New session
        </button>
      </div>
    </div>
  );
}
