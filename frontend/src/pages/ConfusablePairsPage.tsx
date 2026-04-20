import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, X, RotateCcw, Volume2 } from 'lucide-react';
import {
  startConfusablePairsSession,
  answerConfusablePairsItem,
  fetchConfusablePairsSummary,
  type ConfusablePairItem,
  type ConfusablePairsSummaryResponse,
} from '../api';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';

type Phase = 'select' | 'loading' | 'drill' | 'summary' | 'error';

interface AttemptRecord {
  item: ConfusablePairItem;
  choice: string;
  correct: boolean;
  correct_word: string;
  example_sentence: string;
  explanation: string;
}

const DEFAULT_COUNT = 8;

const DIFFICULTIES: { id: 'easy' | 'medium' | 'hard'; label: string; emoji: string; desc: string }[] = [
  { id: 'easy', emoji: '🌱', label: 'Easy', desc: 'Clear context clues.' },
  { id: 'medium', emoji: '🌿', label: 'Medium', desc: 'Everyday confusable pairs.' },
  { id: 'hard', emoji: '🌳', label: 'Hard', desc: 'Trickier pairs (lay/lie, etc.).' },
];

function renderSentence(text: string, filled: string | null): React.ReactNode {
  const parts = text.split('____');
  return (
    <>
      {parts.map((piece, i) => (
        <span key={i}>
          {piece}
          {i < parts.length - 1 && (
            <span
              data-testid="confusable-pair-blank"
              style={{
                display: 'inline-block',
                minWidth: 72,
                padding: '2px 10px',
                margin: '0 4px',
                borderBottom: '2px solid var(--border)',
                fontWeight: 700,
                color: filled ? 'var(--text-primary)' : 'transparent',
                textAlign: 'center',
              }}
            >
              {filled || '____'}
            </span>
          )}
        </span>
      ))}
    </>
  );
}

export default function ConfusablePairsPage() {
  const [phase, setPhase] = useState<Phase>('select');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [errorMsg, setErrorMsg] = useState('');

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [items, setItems] = useState<ConfusablePairItem[]>([]);
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    correct: boolean;
    correct_word: string;
    explanation: string;
    example_sentence: string;
  } | null>(null);
  const [results, setResults] = useState<AttemptRecord[]>([]);
  const [summary, setSummary] = useState<ConfusablePairsSummaryResponse | null>(null);

  const { speak, isSupported } = useSpeechSynthesis();

  const current = items[index] || null;

  const startDrill = useCallback(
    async (pairKey?: string | null) => {
      setErrorMsg('');
      setPhase('loading');
      setIndex(0);
      setChosen(null);
      setFeedback(null);
      setResults([]);
      setSummary(null);
      try {
        const data = await startConfusablePairsSession({
          count: DEFAULT_COUNT,
          difficulty,
          pair_key: pairKey ?? null,
        });
        if (!data.items || data.items.length === 0) {
          setErrorMsg('No items returned.');
          setPhase('error');
          return;
        }
        setSessionId(data.session_id);
        setItems(data.items);
        setPhase('drill');
      } catch (err) {
        setErrorMsg((err as Error).message || 'Failed to load session');
        setPhase('error');
      }
    },
    [difficulty],
  );

  const handleChoose = useCallback(
    async (choice: string) => {
      if (!current || !sessionId || chosen !== null) return;
      setChosen(choice);
      try {
        const res = await answerConfusablePairsItem({
          session_id: sessionId,
          item_id: current.id,
          choice,
        });
        setFeedback(res);
        setResults((r) => [
          ...r,
          {
            item: current,
            choice,
            correct: res.correct,
            correct_word: res.correct_word,
            example_sentence: res.example_sentence,
            explanation: res.explanation,
          },
        ]);
        if (isSupported && res.example_sentence) {
          try {
            speak(res.example_sentence);
          } catch {
            /* ignore */
          }
        }
      } catch (err) {
        setErrorMsg((err as Error).message || 'Attempt failed');
      }
    },
    [current, sessionId, chosen, speak, isSupported],
  );

  const handleNext = useCallback(async () => {
    if (index + 1 >= items.length) {
      if (sessionId) {
        try {
          const s = await fetchConfusablePairsSummary(sessionId);
          setSummary(s);
        } catch {
          /* ignore */
        }
      }
      setPhase('summary');
      return;
    }
    setIndex((i) => i + 1);
    setChosen(null);
    setFeedback(null);
  }, [index, items.length, sessionId]);

  const accuracyPct = useMemo(() => {
    if (results.length === 0) return 0;
    const correct = results.filter((r) => r.correct).length;
    return Math.round((correct / results.length) * 100);
  }, [results]);

  const handlePlaySentence = useCallback(
    (text: string) => {
      if (!text || !isSupported) return;
      try {
        speak(text);
      } catch {
        /* ignore */
      }
    },
    [speak, isSupported],
  );

  if (phase === 'select') {
    return (
      <div className="container" style={{ maxWidth: 720, padding: '1rem' }}>
        <Link
          to="/"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', textDecoration: 'none', marginBottom: 12 }}
        >
          <ArrowLeft size={16} /> Back
        </Link>
        <h1
          data-testid="confusable-pairs-title"
          style={{ fontSize: 24, marginBottom: 8 }}
        >
          🔀 Confusable Word Pairs
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
          Pick the right word: affect/effect, borrow/lend, fewer/less, its/it&apos;s, and more.
        </p>

        <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
          {DIFFICULTIES.map((d) => (
            <button
              key={d.id}
              data-testid={`confusable-pairs-difficulty-${d.id}`}
              onClick={() => setDifficulty(d.id)}
              className="card"
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                border: difficulty === d.id ? '2px solid #6366f1' : '1px solid var(--border)',
                background: difficulty === d.id ? 'rgba(99,102,241,0.08)' : 'transparent',
                borderRadius: 12, cursor: 'pointer', textAlign: 'left', color: 'inherit',
              }}
            >
              <span style={{ fontSize: 24 }}>{d.emoji}</span>
              <div>
                <div style={{ fontWeight: 600 }}>{d.label}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{d.desc}</div>
              </div>
            </button>
          ))}
        </div>

        <button
          data-testid="confusable-pairs-start"
          onClick={() => startDrill(null)}
          style={{
            padding: '10px 18px', borderRadius: 8, background: '#6366f1',
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
        <p data-testid="confusable-pairs-loading">Loading…</p>
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
      <div
        className="container"
        data-testid="confusable-pairs-drill"
        style={{ maxWidth: 720, padding: '1rem' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Link
            to="/"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', textDecoration: 'none' }}
          >
            <ArrowLeft size={16} /> Back
          </Link>
          <div
            data-testid="confusable-pairs-progress"
            style={{ fontSize: 13, color: 'var(--text-secondary)' }}
          >
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
            {current.pair_key.replace(/_/g, ' / ')} · {current.difficulty}
          </div>
          <div
            data-testid="confusable-pairs-sentence"
            style={{ fontSize: 20, lineHeight: 1.5, marginBottom: 12 }}
          >
            {renderSentence(current.sentence_with_blank, chosen)}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          {current.options.map((opt) => {
            const isChosen = chosen === opt;
            const isCorrect = feedback && opt === feedback.correct_word;
            const showFeedback = chosen !== null;
            let bg = 'transparent';
            let border = '1px solid var(--border)';
            let color = 'inherit';
            if (showFeedback) {
              if (isCorrect) {
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
                data-testid={`confusable-pairs-option-${opt}`}
                onClick={() => handleChoose(opt)}
                disabled={chosen !== null}
                style={{
                  padding: '10px 22px', borderRadius: 999, cursor: chosen ? 'default' : 'pointer',
                  fontSize: 16, fontWeight: 600, background: bg, border, color,
                  minWidth: 96,
                }}
              >
                {opt}
              </button>
            );
          })}
        </div>

        {feedback && (
          <div
            data-testid="confusable-pairs-feedback"
            style={{
              padding: '12px 14px', borderRadius: 10, marginBottom: 12,
              border: feedback.correct ? '1px solid #22c55e' : '1px solid #ef4444',
              background: feedback.correct ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontWeight: 600 }}>
              {feedback.correct ? <Check size={18} color="#22c55e" /> : <X size={18} color="#ef4444" />}
              <span data-testid="confusable-pairs-feedback-result">
                {feedback.correct ? 'Correct!' : `Answer: ${feedback.correct_word}`}
              </span>
              {isSupported && (
                <button
                  data-testid="confusable-pairs-tts"
                  onClick={() => handlePlaySentence(feedback.example_sentence)}
                  aria-label="Play sentence"
                  title="Play sentence"
                  style={{
                    marginLeft: 'auto', background: 'transparent', border: '1px solid var(--border)',
                    borderRadius: 999, padding: 6, cursor: 'pointer', color: 'inherit',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Volume2 size={16} />
                </button>
              )}
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 4 }}>
              {feedback.explanation}
            </div>
            <div
              data-testid="confusable-pairs-example"
              style={{ fontSize: 14, fontStyle: 'italic', color: 'var(--text-secondary)' }}
            >
              {feedback.example_sentence}
            </div>
          </div>
        )}

        {feedback && (
          <button
            data-testid="confusable-pairs-next"
            onClick={handleNext}
            style={{
              padding: '8px 18px', borderRadius: 8, background: '#6366f1',
              color: 'white', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
            }}
          >
            {index + 1 >= items.length ? 'Finish' : 'Next'}
          </button>
        )}
      </div>
    );
  }

  const weakestPair = summary?.weakest_pair ?? null;
  const perPair = summary?.per_pair_accuracy ?? {};
  return (
    <div
      className="container"
      data-testid="confusable-pairs-summary"
      style={{ maxWidth: 720, padding: '1rem' }}
    >
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>📊 Summary</h1>
      <div
        className="card"
        style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 16 }}
      >
        <div
          data-testid="confusable-pairs-accuracy"
          style={{ fontSize: 32, fontWeight: 700 }}
        >
          {summary ? Math.round(((summary.correct || 0) / Math.max(1, summary.total)) * 100) : accuracyPct}%
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {summary?.correct ?? results.filter((r) => r.correct).length} / {summary?.total ?? results.length} correct
        </div>
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 8 }}>By pair</h2>
      <div
        data-testid="confusable-pairs-per-pair"
        style={{ display: 'grid', gap: 6, marginBottom: 16 }}
      >
        {Object.entries(perPair).map(([pk, acc]) => (
          <div
            key={pk}
            style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8,
            }}
          >
            <span style={{ textTransform: 'capitalize' }}>{pk.replace(/_/g, ' / ')}</span>
            <span>{Math.round((acc || 0) * 100)}%</span>
          </div>
        ))}
      </div>

      {weakestPair && (
        <div
          data-testid="confusable-pairs-weakest"
          style={{
            padding: '10px 14px', marginBottom: 12, borderRadius: 10,
            background: 'rgba(245,158,11,0.08)', border: '1px solid #f59e0b',
          }}
        >
          Weakest pair: <strong>{weakestPair.replace(/_/g, ' / ')}</strong>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {weakestPair && (
          <button
            data-testid="confusable-pairs-practice-weakest"
            onClick={() => startDrill(weakestPair)}
            style={{
              padding: '8px 16px', borderRadius: 8, background: '#f59e0b',
              color: 'white', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <RotateCcw size={14} /> Practice that pair again
          </button>
        )}
        <button
          data-testid="confusable-pairs-new-session"
          onClick={() => setPhase('select')}
          style={{
            padding: '8px 16px', borderRadius: 8, background: '#6366f1',
            color: 'white', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
          }}
        >
          New session
        </button>
      </div>
    </div>
  );
}
