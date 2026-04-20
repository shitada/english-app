import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, X, RotateCcw, Volume2 } from 'lucide-react';
import {
  fetchTagQuestionSession,
  postTagQuestionAttempt,
  type TagQuestionItem,
  type TagQuestionDifficulty,
  type TagIntonation,
  type TagQuestionAttemptResult,
} from '../api';

type Phase = 'select' | 'loading' | 'drill' | 'feedback' | 'summary' | 'error';

interface AttemptRecord {
  item: TagQuestionItem;
  user_tag: string;
  user_intonation: TagIntonation | '';
  tag_correct: boolean;
  intonation_correct: boolean;
  score: number;
  feedback: string;
}

const DEFAULT_COUNT = 8;

const TAG_CHIPS = [
  "isn't",
  "aren't",
  "don't",
  "doesn't",
  "didn't",
  "won't",
  "can't",
  "shouldn't",
];

const DIFFICULTIES: {
  id: TagQuestionDifficulty;
  label: string;
  emoji: string;
  desc: string;
}[] = [
  { id: 'beginner', emoji: '🌱', label: 'Beginner', desc: "You're coming, aren't you?" },
  { id: 'intermediate', emoji: '🌿', label: 'Intermediate', desc: "Let's leave, shall we?" },
  { id: 'advanced', emoji: '🌳', label: 'Advanced', desc: "Hardly anyone showed up, did they?" },
];

function speak(text: string) {
  if (typeof window === 'undefined') return;
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.95;
  try {
    window.speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}

/** Build a spoken sentence preview including the tag and "?" for TTS. */
export function composeSpokenTagQuestion(item: TagQuestionItem): string {
  const stmt = (item.statement || '').trim().replace(/,+$/, '');
  const tag = (item.expected_tag || '').trim();
  return `${stmt}, ${tag}?`;
}

export default function TagQuestionDrill() {
  const [phase, setPhase] = useState<Phase>('select');
  const [difficulty, setDifficulty] = useState<TagQuestionDifficulty>('beginner');
  const [errorMsg, setErrorMsg] = useState('');
  const [items, setItems] = useState<TagQuestionItem[]>([]);
  const [index, setIndex] = useState(0);
  const [userTag, setUserTag] = useState('');
  const [userIntonation, setUserIntonation] = useState<TagIntonation | ''>('');
  const [lastResult, setLastResult] = useState<TagQuestionAttemptResult | null>(null);
  const [results, setResults] = useState<AttemptRecord[]>([]);

  const current = items[index] || null;

  const startDrill = useCallback(
    async (sel?: TagQuestionDifficulty) => {
      const target = sel || difficulty;
      setErrorMsg('');
      setPhase('loading');
      setIndex(0);
      setUserTag('');
      setUserIntonation('');
      setLastResult(null);
      setResults([]);
      try {
        const data = await fetchTagQuestionSession(target, DEFAULT_COUNT);
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
    [difficulty],
  );

  const handleSubmit = useCallback(async () => {
    if (!current || !userIntonation) return;
    try {
      const res = await postTagQuestionAttempt({
        statement: current.statement,
        expected_tag: current.expected_tag,
        expected_intonation: current.expected_intonation,
        user_tag: userTag,
        user_intonation: userIntonation,
      });
      setLastResult(res);
      setResults((prev) => [
        ...prev,
        {
          item: current,
          user_tag: userTag,
          user_intonation: userIntonation,
          tag_correct: res.tag_correct,
          intonation_correct: res.intonation_correct,
          score: res.score,
          feedback: res.feedback,
        },
      ]);
      setPhase('feedback');
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to submit attempt');
      setPhase('error');
    }
  }, [current, userTag, userIntonation]);

  const handleNext = useCallback(() => {
    if (index + 1 >= items.length) {
      setPhase('summary');
    } else {
      setIndex(index + 1);
      setUserTag('');
      setUserIntonation('');
      setLastResult(null);
      setPhase('drill');
    }
  }, [index, items.length]);

  const tagAccuracyPct = useMemo(() => {
    if (results.length === 0) return 0;
    const n = results.filter((r) => r.tag_correct).length;
    return Math.round((n / results.length) * 100);
  }, [results]);

  const intonationAccuracyPct = useMemo(() => {
    if (results.length === 0) return 0;
    const n = results.filter((r) => r.intonation_correct).length;
    return Math.round((n / results.length) * 100);
  }, [results]);

  const missed = useMemo(
    () => results.filter((r) => !(r.tag_correct && r.intonation_correct)),
    [results],
  );

  // Submit on Enter during drill phase when intonation is chosen.
  useEffect(() => {
    if (phase !== 'drill') return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && userTag.trim() && userIntonation) {
        handleSubmit();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [phase, userTag, userIntonation, handleSubmit]);

  return (
    <div
      data-testid="tag-question-page"
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
        data-testid="tag-question-title"
        style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}
      >
        🎚️ Tag Question Drill
      </h1>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
        Finish the question with the right tag and intonation — falling ↘ for
        confirming, rising ↗ for a real question.
      </p>

      {phase === 'select' && (
        <div data-testid="tag-question-select">
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            Choose a difficulty
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {DIFFICULTIES.map((d) => (
              <button
                key={d.id}
                data-testid={`tag-question-level-${d.id}`}
                onClick={() => setDifficulty(d.id)}
                style={{
                  textAlign: 'left', padding: '12px 14px',
                  borderRadius: 10,
                  border: difficulty === d.id
                    ? '2px solid #ec4899'
                    : '1px solid var(--border)',
                  background: difficulty === d.id ? 'rgba(236,72,153,0.08)' : 'transparent',
                  cursor: 'pointer', color: 'inherit',
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {d.emoji} {d.label}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {d.desc}
                </div>
              </button>
            ))}
          </div>
          <button
            data-testid="tag-question-start"
            onClick={() => startDrill(difficulty)}
            style={{
              marginTop: 16, width: '100%', padding: '12px 16px',
              background: '#ec4899', color: 'white', border: 'none',
              borderRadius: 10, fontWeight: 600, fontSize: 15, cursor: 'pointer',
            }}
          >
            Start drill ({DEFAULT_COUNT} items)
          </button>
        </div>
      )}

      {phase === 'loading' && (
        <div data-testid="tag-question-loading" style={{ padding: 24, textAlign: 'center' }}>
          Loading…
        </div>
      )}

      {phase === 'error' && (
        <div
          data-testid="tag-question-error"
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
        <div data-testid="tag-question-drill">
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Item {index + 1} of {items.length} · {current.difficulty}
          </div>

          <div
            style={{
              padding: 16, border: '1px solid var(--border)', borderRadius: 12,
              marginBottom: 12, background: 'var(--bg-card, transparent)',
            }}
          >
            <div
              data-testid="tag-question-statement"
              style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}
            >
              {current.statement} <span style={{ color: '#ec4899' }}>____?</span>
            </div>
            {current.context_hint && (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                💡 {current.context_hint}
              </div>
            )}
          </div>

          <label style={{ fontSize: 14, fontWeight: 600, display: 'block', marginBottom: 6 }}>
            Your tag
          </label>
          <input
            data-testid="tag-question-input"
            type="text"
            autoFocus
            value={userTag}
            onChange={(e) => setUserTag(e.target.value)}
            placeholder="e.g. aren't you"
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 10,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'inherit', fontSize: 16, boxSizing: 'border-box',
            }}
          />
          <div
            style={{
              display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8,
            }}
          >
            {TAG_CHIPS.map((chip) => (
              <button
                key={chip}
                data-testid={`tag-question-chip-${chip.replace("'", '')}`}
                onClick={() => {
                  const cur = userTag.trim();
                  // Replace first token if it looks like an auxiliary already chosen
                  const rest = cur.split(/\s+/).slice(1).join(' ');
                  setUserTag(rest ? `${chip} ${rest}` : `${chip} `);
                }}
                style={{
                  padding: '6px 10px', borderRadius: 999,
                  border: '1px solid var(--border)', background: 'transparent',
                  color: 'inherit', cursor: 'pointer', fontSize: 13,
                }}
              >
                {chip}
              </button>
            ))}
          </div>

          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 14, marginBottom: 6 }}>
            Intonation
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              data-testid="tag-question-intonation-falling"
              onClick={() => setUserIntonation('falling')}
              style={{
                flex: 1, padding: '12px 10px', borderRadius: 10,
                border: userIntonation === 'falling'
                  ? '2px solid #ec4899'
                  : '1px solid var(--border)',
                background: userIntonation === 'falling'
                  ? 'rgba(236,72,153,0.10)'
                  : 'transparent',
                color: 'inherit', cursor: 'pointer', fontWeight: 600,
              }}
            >
              ↘ Falling
              <div style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)' }}>
                confirming / small talk
              </div>
            </button>
            <button
              data-testid="tag-question-intonation-rising"
              onClick={() => setUserIntonation('rising')}
              style={{
                flex: 1, padding: '12px 10px', borderRadius: 10,
                border: userIntonation === 'rising'
                  ? '2px solid #ec4899'
                  : '1px solid var(--border)',
                background: userIntonation === 'rising'
                  ? 'rgba(236,72,153,0.10)'
                  : 'transparent',
                color: 'inherit', cursor: 'pointer', fontWeight: 600,
              }}
            >
              ↗ Rising
              <div style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)' }}>
                real question / request
              </div>
            </button>
          </div>

          <button
            data-testid="tag-question-submit"
            onClick={handleSubmit}
            disabled={!userTag.trim() || !userIntonation}
            style={{
              marginTop: 14, width: '100%', padding: '12px 16px',
              background: userTag.trim() && userIntonation ? '#ec4899' : 'var(--border)',
              color: 'white', border: 'none', borderRadius: 10,
              fontWeight: 600, fontSize: 15,
              cursor: userTag.trim() && userIntonation ? 'pointer' : 'not-allowed',
            }}
          >
            Check answer
          </button>
        </div>
      )}

      {phase === 'feedback' && current && lastResult && (
        <div data-testid="tag-question-feedback">
          <div
            style={{
              padding: 16, borderRadius: 12, marginBottom: 12,
              background: lastResult.tag_correct && lastResult.intonation_correct
                ? 'rgba(16,185,129,0.08)'
                : 'rgba(239,68,68,0.08)',
              border: `1px solid ${
                lastResult.tag_correct && lastResult.intonation_correct
                  ? '#10b981'
                  : '#ef4444'
              }`,
            }}
          >
            <div
              data-testid="tag-question-feedback-score"
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontWeight: 700, fontSize: 18,
                color: lastResult.tag_correct && lastResult.intonation_correct ? '#10b981' : '#ef4444',
                marginBottom: 8,
              }}
            >
              {lastResult.tag_correct && lastResult.intonation_correct ? (
                <Check size={20} />
              ) : (
                <X size={20} />
              )}
              Score: {lastResult.score}/100
            </div>

            <div style={{ fontSize: 14, marginBottom: 4 }}>
              <strong>Tag:</strong>{' '}
              <span style={{ color: lastResult.tag_correct ? '#10b981' : '#ef4444' }}>
                {lastResult.tag_correct ? '✓' : '✗'}
              </span>{' '}
              expected <em style={{ color: '#ec4899' }}>{current.expected_tag}</em>
            </div>
            <div style={{ fontSize: 14, marginBottom: 8 }}>
              <strong>Intonation:</strong>{' '}
              <span style={{ color: lastResult.intonation_correct ? '#10b981' : '#ef4444' }}>
                {lastResult.intonation_correct ? '✓' : '✗'}
              </span>{' '}
              expected{' '}
              <em style={{ color: '#ec4899' }}>
                {current.expected_intonation === 'rising' ? '↗ rising' : '↘ falling'}
              </em>
            </div>

            <div
              data-testid="tag-question-explanation"
              style={{
                fontSize: 14, color: 'var(--text-secondary)',
                borderLeft: '3px solid #ec4899', paddingLeft: 10, margin: '8px 0',
              }}
            >
              {current.explanation}
            </div>

            <button
              data-testid="tag-question-listen"
              onClick={() => speak(composeSpokenTagQuestion(current))}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 12px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'transparent',
                color: 'inherit', cursor: 'pointer', fontSize: 13,
              }}
            >
              <Volume2 size={14} /> Listen
            </button>
          </div>

          <button
            data-testid="tag-question-next"
            onClick={handleNext}
            style={{
              width: '100%', padding: '12px 16px', background: '#ec4899',
              color: 'white', border: 'none', borderRadius: 10,
              fontWeight: 600, fontSize: 15, cursor: 'pointer',
            }}
          >
            {index + 1 >= items.length ? 'See summary' : 'Next'}
          </button>
        </div>
      )}

      {phase === 'summary' && (
        <div data-testid="tag-question-summary">
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
              style={{
                display: 'flex', justifyContent: 'center', gap: 24, marginTop: 12,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div
                  data-testid="tag-question-tag-accuracy"
                  style={{ fontSize: 32, fontWeight: 800, color: '#ec4899' }}
                >
                  {tagAccuracyPct}%
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Tag accuracy
                </div>
              </div>
              <div>
                <div
                  data-testid="tag-question-intonation-accuracy"
                  style={{ fontSize: 32, fontWeight: 800, color: '#8b5cf6' }}
                >
                  {intonationAccuracyPct}%
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Intonation accuracy
                </div>
              </div>
            </div>
          </div>

          {missed.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
                Missed items
              </div>
              <div
                data-testid="tag-question-missed-list"
                style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                {missed.map((r, i) => (
                  <div
                    key={`${i}-${r.item.statement}`}
                    style={{
                      padding: '10px 12px', borderRadius: 10,
                      border: '1px solid var(--border)', fontSize: 14,
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      {r.item.statement}{' '}
                      <span style={{ color: '#ec4899' }}>{r.item.expected_tag}?</span>{' '}
                      <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
                        ({r.item.expected_intonation === 'rising' ? '↗' : '↘'})
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      {r.item.explanation}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              data-testid="tag-question-retry"
              onClick={() => startDrill(difficulty)}
              style={{
                flex: 1, padding: '12px 14px', borderRadius: 10,
                border: 'none', background: '#ec4899', color: 'white',
                cursor: 'pointer', fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <RotateCcw size={16} /> Retry
            </button>
            <Link
              data-testid="tag-question-home"
              to="/"
              style={{
                flex: 1, padding: '12px 14px', borderRadius: 10,
                border: '1px solid var(--border)', background: 'transparent',
                color: 'inherit', textDecoration: 'none', fontWeight: 600,
                textAlign: 'center',
              }}
            >
              Back to home
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
