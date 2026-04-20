import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle,
  Headphones,
  Home as HomeIcon,
  RefreshCw,
  Volume2,
  XCircle,
} from 'lucide-react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import {
  api,
  type ConnectedSpeechItem,
  type ConnectedSpeechCategoryStat,
} from '../api';

type Phase = 'select' | 'loading' | 'listen' | 'answer' | 'feedback' | 'summary' | 'error';
type Difficulty = 'easy' | 'medium' | 'hard';

interface AnswerRecord {
  item: ConnectedSpeechItem;
  userAnswer: string;
  correct: boolean;
  normalizedExpected: string;
  normalizedUser: string;
  timeMs: number;
}

const SESSION_SIZE = 8;
const MAX_REPLAYS = 3;

const CATEGORY_LABEL: Record<string, string> = {
  gonna: 'gonna (going to)',
  wanna: 'wanna (want to)',
  gotta: 'gotta (have got to)',
  hafta: 'hafta (have to)',
  whatcha: 'whatcha (what are you)',
  didja: 'didja (did you)',
  lemme: 'lemme (let me)',
  kinda: 'kinda (kind of)',
  sorta: 'sorta (sort of)',
  yaknow: 'yaknow (you know)',
  other: 'other (dunno, coulda, ...)',
};

function catLabel(c: string): string {
  return CATEGORY_LABEL[c] ?? c;
}

export default function ConnectedSpeechPage() {
  const tts = useSpeechSynthesis();
  const [phase, setPhase] = useState<Phase>('select');
  const [difficulty, setDifficulty] = useState<Difficulty | ''>('');
  const [items, setItems] = useState<ConnectedSpeechItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [input, setInput] = useState('');
  const [playCount, setPlayCount] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [feedback, setFeedback] = useState<AnswerRecord | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [categoryStats, setCategoryStats] = useState<ConnectedSpeechCategoryStat[]>([]);

  const current = items[idx];

  const speakCurrent = useCallback(
    (text: string) => {
      tts.speak(text, 'en-US', 0.95);
    },
    [tts],
  );

  const startSession = useCallback(
    async (diff: Difficulty | '') => {
      setPhase('loading');
      setErrorMsg('');
      setAnswers([]);
      setIdx(0);
      setInput('');
      setPlayCount(0);
      setFeedback(null);
      try {
        const data = await api.getConnectedSpeechSession(
          diff || undefined,
          SESSION_SIZE,
        );
        if (!data.items.length) {
          setErrorMsg('No items available for that difficulty.');
          setPhase('error');
          return;
        }
        setItems(data.items);
        setPhase('listen');
        setStartedAt(Date.now());
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load session');
        setPhase('error');
      }
    },
    [],
  );

  // Auto-play once when we reach a listen phase for a new item.
  useEffect(() => {
    if (phase === 'listen' && current) {
      setPlayCount(1);
      speakCurrent(current.reduced);
      setStartedAt(Date.now());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, idx]);

  const onReplay = useCallback(() => {
    if (!current || playCount >= MAX_REPLAYS) return;
    setPlayCount((p) => p + 1);
    speakCurrent(current.reduced);
  }, [current, playCount, speakCurrent]);

  const submitAnswer = useCallback(async () => {
    if (!current) return;
    const userAnswer = input.trim();
    if (!userAnswer) return;
    const timeMs = Math.max(0, Date.now() - startedAt);
    try {
      const res = await api.submitConnectedSpeechAttempt({
        reduced: current.reduced,
        expanded: current.expanded,
        user_answer: userAnswer,
        category: current.category,
        time_ms: timeMs,
      });
      const rec: AnswerRecord = {
        item: current,
        userAnswer,
        correct: res.correct,
        normalizedExpected: res.normalized_expected,
        normalizedUser: res.normalized_user,
        timeMs,
      };
      setAnswers((prev) => [...prev, rec]);
      setFeedback(rec);
      setPhase('feedback');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to grade answer');
      setPhase('error');
    }
  }, [current, input, startedAt]);

  const nextItem = useCallback(() => {
    const nextIdx = idx + 1;
    setInput('');
    setFeedback(null);
    setPlayCount(0);
    if (nextIdx >= items.length) {
      // End of session — fetch stats for the summary.
      (async () => {
        try {
          const stats = await api.getConnectedSpeechStats();
          setCategoryStats(stats.stats);
        } catch {
          setCategoryStats([]);
        }
        setPhase('summary');
      })();
    } else {
      setIdx(nextIdx);
      setPhase('listen');
    }
  }, [idx, items.length]);

  const retryMissed = useCallback(() => {
    const missed = answers.filter((a) => !a.correct).map((a) => a.item);
    if (!missed.length) return;
    setItems(missed);
    setIdx(0);
    setAnswers([]);
    setInput('');
    setPlayCount(0);
    setFeedback(null);
    setPhase('listen');
  }, [answers]);

  const accuracy = useMemo(() => {
    if (!answers.length) return 0;
    const c = answers.filter((a) => a.correct).length;
    return Math.round((c / answers.length) * 100);
  }, [answers]);

  const perCategoryBreakdown = useMemo(() => {
    const by = new Map<string, { attempts: number; correct: number }>();
    for (const a of answers) {
      const key = a.item.category;
      const cur = by.get(key) ?? { attempts: 0, correct: 0 };
      cur.attempts += 1;
      if (a.correct) cur.correct += 1;
      by.set(key, cur);
    }
    return Array.from(by.entries())
      .map(([category, { attempts, correct }]) => ({
        category,
        attempts,
        correct,
        accuracy: attempts ? correct / attempts : 0,
      }))
      .sort((a, b) => b.attempts - a.attempts);
  }, [answers]);

  return (
    <div className="page" style={{ maxWidth: 780, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1rem' }}>
        <Link to="/" className="btn" aria-label="Home" data-testid="connected-speech-home-link">
          <HomeIcon size={18} />
        </Link>
        <h1 style={{ margin: 0, fontSize: 22 }}>
          <Headphones size={22} style={{ verticalAlign: -4 }} /> Connected Speech Decoder
        </h1>
      </div>

      {phase === 'select' && (
        <div className="card" style={{ padding: '1.25rem', borderRadius: 12 }}>
          <p style={{ marginTop: 0 }}>
            Listen to a casual, reduced-form phrase (gonna, wanna, whatcha, lemme, didja, kinda...)
            and type the fully-expanded standard form.
          </p>
          <div style={{ marginTop: '0.75rem', marginBottom: '0.75rem' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Difficulty</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['', 'easy', 'medium', 'hard'] as const).map((d) => (
                <button
                  key={d || 'mixed'}
                  type="button"
                  data-testid={`cs-difficulty-${d || 'mixed'}`}
                  onClick={() => setDifficulty(d)}
                  className="btn"
                  style={{
                    padding: '6px 14px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: difficulty === d ? 'var(--primary, #3b82f6)' : 'transparent',
                    color: difficulty === d ? 'white' : 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  {d || 'mixed'}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            data-testid="cs-start-button"
            onClick={() => startSession(difficulty)}
            className="btn btn-primary"
            style={{
              marginTop: 12,
              padding: '10px 18px',
              borderRadius: 8,
              background: '#14b8a6',
              color: 'white',
              border: 'none',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Start Session
          </button>
        </div>
      )}

      {phase === 'loading' && <p>Loading…</p>}

      {phase === 'error' && (
        <div className="card" style={{ padding: '1rem', borderRadius: 12 }}>
          <p style={{ color: 'var(--danger, #ef4444)' }}>{errorMsg || 'Something went wrong.'}</p>
          <button
            type="button"
            className="btn"
            data-testid="cs-error-back"
            onClick={() => setPhase('select')}
          >
            <ArrowLeft size={16} /> Back
          </button>
        </div>
      )}

      {(phase === 'listen' || phase === 'answer') && current && (
        <div className="card" style={{ padding: '1.25rem', borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
            Item {idx + 1} / {items.length} · {catLabel(current.category)} · {current.difficulty}
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <button
              type="button"
              data-testid="cs-replay-button"
              onClick={onReplay}
              disabled={playCount >= MAX_REPLAYS}
              className="btn"
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: playCount >= MAX_REPLAYS ? 'var(--muted, #e5e7eb)' : 'var(--primary, #3b82f6)',
                color: playCount >= MAX_REPLAYS ? 'var(--text-secondary)' : 'white',
                cursor: playCount >= MAX_REPLAYS ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              <Volume2 size={16} style={{ verticalAlign: -3 }} /> Play ({playCount} / {MAX_REPLAYS})
            </button>
          </div>
          <label
            htmlFor="cs-answer-input"
            style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}
          >
            Type the fully-expanded standard form:
          </label>
          <input
            id="cs-answer-input"
            data-testid="cs-answer-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitAnswer();
            }}
            placeholder="e.g. I am going to call her later."
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              fontSize: 15,
              boxSizing: 'border-box',
            }}
            autoFocus
          />
          <div style={{ marginTop: '0.75rem', display: 'flex', gap: 8 }}>
            <button
              type="button"
              data-testid="cs-submit-button"
              onClick={submitAnswer}
              disabled={!input.trim()}
              className="btn btn-primary"
              style={{
                padding: '10px 18px',
                borderRadius: 8,
                background: '#14b8a6',
                color: 'white',
                border: 'none',
                fontWeight: 600,
                cursor: input.trim() ? 'pointer' : 'not-allowed',
                opacity: input.trim() ? 1 : 0.6,
              }}
            >
              Submit
            </button>
          </div>
        </div>
      )}

      {phase === 'feedback' && feedback && (
        <div className="card" style={{ padding: '1.25rem', borderRadius: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.5rem' }}>
            {feedback.correct ? (
              <>
                <CheckCircle size={22} color="#10b981" />
                <strong style={{ color: '#10b981' }}>Correct!</strong>
              </>
            ) : (
              <>
                <XCircle size={22} color="#ef4444" />
                <strong style={{ color: '#ef4444' }}>Not quite</strong>
              </>
            )}
          </div>
          <div style={{ fontSize: 14, marginBottom: 4 }}>
            <strong>Reduced form:</strong> {feedback.item.reduced}
          </div>
          <div style={{ fontSize: 14, marginBottom: 4 }}>
            <strong>Expanded:</strong> {feedback.item.expanded}
          </div>
          <div style={{ fontSize: 14, marginBottom: 4 }}>
            <strong>Your answer:</strong> {feedback.userAnswer}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
            Category: {catLabel(feedback.item.category)}
          </div>
          <button
            type="button"
            data-testid="cs-next-button"
            onClick={nextItem}
            className="btn btn-primary"
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              background: '#14b8a6',
              color: 'white',
              border: 'none',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {idx + 1 >= items.length ? 'See Summary' : 'Next'}
          </button>
        </div>
      )}

      {phase === 'summary' && (
        <div className="card" style={{ padding: '1.25rem', borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Session Summary</h2>
          <div style={{ fontSize: 28, fontWeight: 700, marginBottom: '0.5rem' }}>
            {accuracy}%{' '}
            <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-secondary)' }}>
              ({answers.filter((a) => a.correct).length} / {answers.length})
            </span>
          </div>

          {perCategoryBreakdown.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>By category</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {perCategoryBreakdown.map((row) => (
                  <div key={row.category} style={{ fontSize: 13 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span>{catLabel(row.category)}</span>
                      <span>{row.correct} / {row.attempts}</span>
                    </div>
                    <div
                      style={{
                        height: 6,
                        background: 'var(--border)',
                        borderRadius: 3,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.round(row.accuracy * 100)}%`,
                          height: '100%',
                          background: row.accuracy >= 0.7 ? '#10b981' : row.accuracy >= 0.4 ? '#f59e0b' : '#ef4444',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: '1.25rem' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>All items</div>
            <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
              {answers.map((a, i) => (
                <li key={i} style={{ fontSize: 13, marginBottom: 6 }}>
                  {a.correct ? '✅' : '❌'} <em>{a.item.reduced}</em> → <strong>{a.item.expanded}</strong>
                  {!a.correct && (
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {' '}
                      (you: "{a.userAnswer}")
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {categoryStats.length > 0 && (
            <div style={{ marginTop: '1rem', fontSize: 12, color: 'var(--text-secondary)' }}>
              Lifetime stats tracked across {categoryStats.reduce((n, s) => n + s.attempts, 0)} attempts.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: '1rem', flexWrap: 'wrap' }}>
            {answers.some((a) => !a.correct) && (
              <button
                type="button"
                data-testid="cs-retry-missed"
                onClick={retryMissed}
                className="btn"
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <RefreshCw size={14} style={{ verticalAlign: -2 }} /> Retry missed
              </button>
            )}
            <button
              type="button"
              data-testid="cs-new-session"
              onClick={() => setPhase('select')}
              className="btn btn-primary"
              style={{
                padding: '10px 16px',
                borderRadius: 8,
                background: '#14b8a6',
                color: 'white',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              New session
            </button>
            <Link
              to="/"
              data-testid="cs-home-link"
              className="btn"
              style={{
                padding: '10px 16px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                textDecoration: 'none',
                color: 'inherit',
                fontWeight: 600,
              }}
            >
              Home
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
