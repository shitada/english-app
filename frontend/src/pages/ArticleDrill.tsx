import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, X, RotateCcw } from 'lucide-react';
import {
  fetchArticleSession,
  submitArticleSession,
  type ArticleAnswer,
  type ArticleDifficulty,
  type ArticleItem,
  type ArticleSubmitResponse,
} from '../api';

type Phase = 'select' | 'loading' | 'drill' | 'feedback' | 'summary' | 'error';

interface ChipOption {
  value: ArticleAnswer;
  label: string;
}

const CHIPS: ChipOption[] = [
  { value: 'a', label: 'a' },
  { value: 'an', label: 'an' },
  { value: 'the', label: 'the' },
  { value: 'none', label: '—' },
];

const DIFFICULTIES: { id: ArticleDifficulty; label: string; emoji: string; desc: string }[] = [
  { id: 'easy', emoji: '🌱', label: 'Easy', desc: 'Basic a/an/the rules' },
  { id: 'medium', emoji: '🌿', label: 'Medium', desc: 'Instruments, places by purpose, abstracts' },
  { id: 'hard', emoji: '🔥', label: 'Hard', desc: 'Nationality plurals, correlative the, tricky vowel sounds' },
];

function parseTemplate(template: string): Array<{ kind: 'text'; text: string } | { kind: 'blank'; index: number }> {
  const parts: Array<{ kind: 'text'; text: string } | { kind: 'blank'; index: number }> = [];
  const regex = /__(\d+)__/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(template)) !== null) {
    if (match.index > last) {
      parts.push({ kind: 'text', text: template.slice(last, match.index) });
    }
    parts.push({ kind: 'blank', index: Number(match[1]) });
    last = match.index + match[0].length;
  }
  if (last < template.length) {
    parts.push({ kind: 'text', text: template.slice(last) });
  }
  return parts;
}

function displayAnswer(ans: string | undefined | null): string {
  if (!ans) return '';
  if (ans === 'none') return '—';
  return ans;
}

export default function ArticleDrill() {
  const [phase, setPhase] = useState<Phase>('select');
  const [difficulty, setDifficulty] = useState<ArticleDifficulty>('medium');
  const [sessionId, setSessionId] = useState<string>('');
  const [items, setItems] = useState<ArticleItem[]>([]);
  const [idx, setIdx] = useState(0);
  // answers[itemIndex][blankIndex(0-based)] = chosen chip
  const [answers, setAnswers] = useState<ArticleAnswer[][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ArticleSubmitResponse | null>(null);

  const current = items[idx];
  const currentAnswers = answers[idx] || [];
  const allFilled = current
    ? current.blanks.every((_, i) => !!currentAnswers[i])
    : false;

  const parsedTemplate = useMemo(
    () => (current ? parseTemplate(current.sentence_template) : []),
    [current],
  );

  const start = useCallback(async (diff: ArticleDifficulty) => {
    setDifficulty(diff);
    setPhase('loading');
    setError(null);
    setSummary(null);
    try {
      const resp = await fetchArticleSession(diff);
      setSessionId(resp.session_id);
      setItems(resp.items);
      setAnswers(resp.items.map((it) => it.blanks.map(() => '' as ArticleAnswer)));
      setIdx(0);
      setPhase('drill');
    } catch (err) {
      console.error(err);
      setError((err as Error).message || 'Failed to load session');
      setPhase('error');
    }
  }, []);

  const pickChip = useCallback(
    (blankIdx: number, value: ArticleAnswer) => {
      if (phase !== 'drill') return;
      setAnswers((prev) => {
        const next = prev.map((row) => row.slice());
        if (!next[idx]) next[idx] = [];
        next[idx][blankIdx] = value;
        return next;
      });
    },
    [idx, phase],
  );

  const submitCurrent = useCallback(() => {
    if (!allFilled) return;
    setPhase('feedback');
  }, [allFilled]);

  const nextItem = useCallback(async () => {
    if (idx < items.length - 1) {
      setIdx(idx + 1);
      setPhase('drill');
      return;
    }
    // Finished — submit whole session
    setPhase('loading');
    try {
      const payload = items.map((it, i) => ({
        id: it.id,
        sentence_template: it.sentence_template,
        blanks: it.blanks,
        user_answers: (answers[i] || []).map((a) => a || ''),
      }));
      const result = await submitArticleSession(difficulty, payload);
      setSummary(result);
      setPhase('summary');
    } catch (err) {
      console.error(err);
      setError((err as Error).message || 'Failed to submit session');
      setPhase('error');
    }
  }, [idx, items, answers, difficulty]);

  const retryAll = useCallback(() => {
    start(difficulty);
  }, [start, difficulty]);

  const retryMissed = useCallback(async () => {
    if (!summary) return retryAll();
    const missedItemIds = new Set(
      summary.per_blank_results.filter((r) => !r.correct).map((r) => r.item_id),
    );
    const missed = items.filter((it) => missedItemIds.has(it.id));
    if (missed.length === 0) return retryAll();
    setItems(missed);
    setAnswers(missed.map((it) => it.blanks.map(() => '' as ArticleAnswer)));
    setIdx(0);
    setSummary(null);
    setPhase('drill');
  }, [summary, items, retryAll]);

  // Keyboard 1..4 to choose chip for FIRST empty blank during drill phase
  useEffect(() => {
    if (phase !== 'drill' || !current) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter' && allFilled) {
        submitCurrent();
        return;
      }
      const idxNum = ['1', '2', '3', '4'].indexOf(e.key);
      if (idxNum < 0) return;
      const firstEmpty = current.blanks.findIndex(
        (_, i) => !currentAnswers[i],
      );
      if (firstEmpty < 0) return;
      pickChip(firstEmpty, CHIPS[idxNum].value);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, current, currentAnswers, allFilled, submitCurrent, pickChip]);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1rem' }}>
      <Link
        to="/"
        data-testid="article-drill-back"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          color: 'var(--text-secondary)', textDecoration: 'none', fontSize: 14,
          marginBottom: 12,
        }}
      >
        <ArrowLeft size={14} /> Home
      </Link>

      <h1 data-testid="article-drill-title" style={{ margin: '0 0 12px' }}>
        🔠 Article Drill
      </h1>
      <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>
        Tap <strong>a</strong> / <strong>an</strong> / <strong>the</strong> / <strong>—</strong> to fill each blank. 8 sentences, instant feedback.
      </p>

      {phase === 'select' && (
        <div data-testid="article-drill-select" style={{ display: 'grid', gap: 10, marginTop: 16 }}>
          {DIFFICULTIES.map((d) => (
            <button
              key={d.id}
              data-testid={`article-drill-difficulty-${d.id}`}
              onClick={() => start(d.id)}
              className="card"
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '1rem',
                textAlign: 'left', border: '1px solid var(--border)',
                borderRadius: 12, background: 'var(--card-bg)', cursor: 'pointer',
                color: 'inherit',
              }}
            >
              <span style={{ fontSize: 28 }}>{d.emoji}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{d.label}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{d.desc}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {phase === 'loading' && (
        <p data-testid="article-drill-loading" style={{ marginTop: 24 }}>Loading…</p>
      )}

      {phase === 'error' && (
        <div data-testid="article-drill-error" style={{ marginTop: 24 }}>
          <p style={{ color: 'var(--danger, #ef4444)' }}>
            {error || 'Something went wrong.'}
          </p>
          <button onClick={() => setPhase('select')}>Back</button>
        </div>
      )}

      {(phase === 'drill' || phase === 'feedback') && current && (
        <div data-testid="article-drill-card" style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
            <span data-testid="article-drill-progress">
              Question {idx + 1} / {items.length}
            </span>
            {' · '}
            <span>{difficulty}</span>
            {sessionId ? ` · ${sessionId.slice(0, 10)}` : ''}
          </div>

          <div
            className="card"
            style={{
              padding: '1rem', border: '1px solid var(--border)',
              borderRadius: 12, background: 'var(--card-bg)', lineHeight: 2,
              fontSize: 17,
            }}
          >
            {parsedTemplate.map((part, i) => {
              if (part.kind === 'text') {
                return <span key={`t-${i}`}>{part.text}</span>;
              }
              const blank = current.blanks.find((b) => b.index === part.index);
              const blankPos = current.blanks.findIndex((b) => b.index === part.index);
              const chosen = currentAnswers[blankPos] || '';
              const correctAns = blank?.answer;
              const showFeedback = phase === 'feedback';
              const isCorrect = showFeedback && chosen === correctAns;
              const isWrong = showFeedback && chosen !== correctAns;
              const bg = showFeedback
                ? isCorrect
                  ? 'rgba(34,197,94,0.18)'
                  : 'rgba(239,68,68,0.18)'
                : chosen
                  ? 'var(--accent-bg, #eef2ff)'
                  : 'transparent';
              const color = showFeedback
                ? isCorrect
                  ? 'var(--success, #16a34a)'
                  : 'var(--danger, #dc2626)'
                : 'var(--text-primary)';
              return (
                <span
                  key={`b-${i}`}
                  data-testid={`article-drill-blank-${part.index}`}
                  style={{
                    display: 'inline-block',
                    minWidth: 56,
                    padding: '2px 10px',
                    margin: '0 4px',
                    borderBottom: '2px solid var(--border)',
                    borderRadius: 6,
                    fontWeight: 700,
                    textAlign: 'center',
                    background: bg,
                    color,
                  }}
                >
                  {displayAnswer(chosen) || '___'}
                  {showFeedback && isWrong && (
                    <span style={{ marginLeft: 6, fontSize: 12, opacity: 0.8 }}>
                      ({displayAnswer(correctAns)})
                    </span>
                  )}
                </span>
              );
            })}
          </div>

          {phase === 'drill' && (
            <div style={{ marginTop: 12 }}>
              {current.blanks.map((blank, bi) => (
                <div
                  key={bi}
                  data-testid={`article-drill-chiprow-${blank.index}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    marginBottom: 8, flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', minWidth: 72 }}>
                    Blank {blank.index}:
                  </span>
                  {CHIPS.map((c, ci) => {
                    const selected = currentAnswers[bi] === c.value;
                    return (
                      <button
                        key={c.value}
                        data-testid={`article-drill-chip-${blank.index}-${c.value}`}
                        onClick={() => pickChip(bi, c.value)}
                        title={`${ci + 1}`}
                        style={{
                          padding: '6px 14px', borderRadius: 999,
                          border: selected ? '2px solid #14b8a6' : '1px solid var(--border)',
                          background: selected ? '#14b8a6' : 'var(--card-bg)',
                          color: selected ? 'white' : 'var(--text-primary)',
                          fontWeight: 600, cursor: 'pointer', fontSize: 15,
                        }}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              ))}

              <button
                data-testid="article-drill-submit"
                onClick={submitCurrent}
                disabled={!allFilled}
                style={{
                  marginTop: 12, padding: '8px 18px', borderRadius: 8,
                  background: allFilled ? '#14b8a6' : 'var(--border)',
                  color: allFilled ? 'white' : 'var(--text-secondary)',
                  border: 'none', fontWeight: 600,
                  cursor: allFilled ? 'pointer' : 'not-allowed',
                }}
              >
                Check
              </button>
            </div>
          )}

          {phase === 'feedback' && (
            <div data-testid="article-drill-feedback" style={{ marginTop: 12 }}>
              {current.blanks.map((blank, bi) => {
                const chosen = currentAnswers[bi] || '';
                const ok = chosen === blank.answer;
                return (
                  <div
                    key={bi}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      padding: '8px 10px', marginBottom: 6, borderRadius: 8,
                      background: ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                      border: `1px solid ${ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                    }}
                  >
                    {ok ? <Check size={16} color="#16a34a" /> : <X size={16} color="#dc2626" />}
                    <div style={{ fontSize: 13 }}>
                      <strong>Blank {blank.index}:</strong>{' '}
                      <span style={{ color: ok ? '#16a34a' : '#dc2626' }}>
                        {displayAnswer(blank.answer)}
                      </span>
                      {' — '}
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {blank.hint || blank.rule_category}
                      </span>
                    </div>
                  </div>
                );
              })}
              <button
                data-testid="article-drill-next"
                onClick={nextItem}
                style={{
                  marginTop: 8, padding: '8px 18px', borderRadius: 8,
                  background: '#14b8a6', color: 'white', border: 'none',
                  fontWeight: 600, cursor: 'pointer',
                }}
              >
                {idx < items.length - 1 ? 'Next →' : 'See Results'}
              </button>
            </div>
          )}
        </div>
      )}

      {phase === 'summary' && summary && (
        <div data-testid="article-drill-summary" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Session Complete</h2>
          <div
            className="card"
            style={{
              padding: '1rem', border: '1px solid var(--border)',
              borderRadius: 12, background: 'var(--card-bg)', marginBottom: 12,
            }}
          >
            <div data-testid="article-drill-score" style={{ fontSize: 22, fontWeight: 700 }}>
              {summary.correct_count} / {summary.total_count}
              <span style={{ fontSize: 14, marginLeft: 8, color: 'var(--text-secondary)' }}>
                ({Math.round(summary.accuracy * 100)}%)
              </span>
            </div>
          </div>

          <h3 style={{ marginBottom: 8 }}>By Rule Category</h3>
          <div data-testid="article-drill-categories" style={{ display: 'grid', gap: 6, marginBottom: 16 }}>
            {Object.entries(summary.category_breakdown).map(([cat, info]) => {
              const pct = info.total ? (info.correct / info.total) * 100 : 0;
              return (
                <div key={cat}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span>{cat}</span>
                    <span>
                      {info.correct} / {info.total}
                    </span>
                  </div>
                  <div style={{
                    height: 8, background: 'var(--border)', borderRadius: 4, marginTop: 2,
                  }}>
                    <div
                      style={{
                        width: `${pct}%`, height: '100%',
                        background: pct >= 80 ? '#22c55e' : pct >= 50 ? '#eab308' : '#ef4444',
                        borderRadius: 4,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              data-testid="article-drill-retry"
              onClick={retryAll}
              style={{
                padding: '8px 18px', borderRadius: 8, background: '#14b8a6',
                color: 'white', border: 'none', fontWeight: 600, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <RotateCcw size={14} /> Retry
            </button>
            {summary.per_blank_results.some((r) => !r.correct) && (
              <button
                data-testid="article-drill-retry-missed"
                onClick={retryMissed}
                style={{
                  padding: '8px 18px', borderRadius: 8, background: 'var(--card-bg)',
                  color: 'var(--text-primary)', border: '1px solid var(--border)',
                  fontWeight: 600, cursor: 'pointer',
                }}
              >
                Retry missed
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
