import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Volume2, RefreshCw } from 'lucide-react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import {
  generateSentenceEcho,
  scoreSentenceEcho,
  getSentenceEchoTrend,
  type SentenceEchoSentence,
  type SentenceEchoScoreResult,
  type SentenceEchoTrendPoint,
} from '../api';

export const SPAN_LADDER: readonly number[] = [6, 9, 12, 15, 18];
export const PASS_THRESHOLD = 0.9;
export const MAX_PLAYS_PER_SENTENCE = 2;
export const MAX_SENTENCES_PER_SESSION = 8;

const WORD_RE = /[a-z0-9']+/g;

export function tokenize(text: string): string[] {
  return (text || '').toLowerCase().match(WORD_RE) || [];
}

/** Token-level Levenshtein distance. */
export function tokenLevenshtein(a: string[], b: string[]): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur.push(Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function wordAccuracy(target: string, heard: string): number {
  const t = tokenize(target);
  if (!t.length) return 0;
  const h = tokenize(heard);
  const dist = tokenLevenshtein(t, h);
  return Math.max(0, Math.min(1, 1 - dist / t.length));
}

/** For each target token, mark whether it appears in the heard tokens. */
export interface DiffMark {
  word: string;
  ok: boolean;
}
export function diffTokens(target: string, heard: string): DiffMark[] {
  const tTokens = tokenize(target);
  const hSet = new Set(tokenize(heard));
  return tTokens.map((w) => ({ word: w, ok: hSet.has(w) }));
}

export function nextSpan(current: number, passed: boolean): number {
  if (!passed) return current;
  for (const r of SPAN_LADDER) {
    if (r > current) return r;
  }
  return current;
}

interface AttemptRow {
  span: number;
  accuracy: number;
  passed: boolean;
  target: string;
  heard: string;
}

type Phase = 'loading' | 'ready' | 'playing' | 'input' | 'scoring' | 'feedback' | 'summary' | 'error';

function Sparkline({ points }: { points: SentenceEchoTrendPoint[] }) {
  if (!points.length) {
    return (
      <div data-testid="se-sparkline-empty" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        No history yet — finish a session to start your trend.
      </div>
    );
  }
  const w = 240;
  const h = 48;
  const maxY = Math.max(18, ...points.map((p) => p.max_span));
  const stepX = points.length > 1 ? w / (points.length - 1) : 0;
  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = h - (p.max_span / maxY) * (h - 4) - 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      data-testid="se-sparkline"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: 'block' }}
      role="img"
      aria-label="14-day memory span trend"
    >
      <path d={path} fill="none" stroke="#6366f1" strokeWidth={2} />
    </svg>
  );
}

export default function SentenceEcho() {
  const { speak, isSupported } = useSpeechSynthesis();
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [span, setSpan] = useState<number>(SPAN_LADDER[0]);
  const [current, setCurrent] = useState<SentenceEchoSentence | null>(null);
  const [playsLeft, setPlaysLeft] = useState<number>(MAX_PLAYS_PER_SENTENCE);
  const [heard, setHeard] = useState<string>('');
  const [feedback, setFeedback] = useState<SentenceEchoScoreResult | null>(null);
  const [history, setHistory] = useState<AttemptRow[]>([]);
  const [trend, setTrend] = useState<SentenceEchoTrendPoint[]>([]);
  const [bestSpanOverall, setBestSpanOverall] = useState<number>(0);
  const sessionDoneRef = useRef(false);

  // Compute summary metrics from local session.
  const summary = useMemo(() => {
    if (!history.length) {
      return { memorySpan: 0, avgAccuracy: 0, sentences: 0 };
    }
    const passedSpans = history.filter((h) => h.passed).map((h) => h.span);
    return {
      memorySpan: passedSpans.length ? Math.max(...passedSpans) : 0,
      avgAccuracy: history.reduce((s, h) => s + h.accuracy, 0) / history.length,
      sentences: history.length,
    };
  }, [history]);

  const loadTrend = useCallback(async () => {
    try {
      const res = await getSentenceEchoTrend(14);
      setTrend(res.points);
      setBestSpanOverall(res.best_span);
    } catch {
      // non-fatal
    }
  }, []);

  const fetchSentence = useCallback(async (newSpan: number) => {
    setPhase('loading');
    setError(null);
    setHeard('');
    setFeedback(null);
    setPlaysLeft(MAX_PLAYS_PER_SENTENCE);
    try {
      const s = await generateSentenceEcho(newSpan, 'intermediate');
      setCurrent(s);
      setPhase('ready');
    } catch (e) {
      setError((e as Error).message || 'Failed to load sentence.');
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    loadTrend();
    fetchSentence(SPAN_LADDER[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPlay = useCallback(() => {
    if (!current || playsLeft <= 0) return;
    setPhase('playing');
    setPlaysLeft((n) => Math.max(0, n - 1));
    try {
      speak(current.sentence, 'en-US');
    } catch {
      // ignore TTS errors
    }
    // After a short hold, allow input.
    setTimeout(() => setPhase('input'), 250);
  }, [current, playsLeft, speak]);

  const onSubmit = useCallback(async () => {
    if (!current) return;
    setPhase('scoring');
    try {
      const res = await scoreSentenceEcho(current.sentence, heard, span);
      setFeedback(res);
      setHistory((h) => [
        ...h,
        {
          span,
          accuracy: res.accuracy,
          passed: res.passed,
          target: current.sentence,
          heard,
        },
      ]);
      setBestSpanOverall((b) => Math.max(b, res.best_span));
      setPhase('feedback');
    } catch (e) {
      setError((e as Error).message || 'Failed to score.');
      setPhase('error');
    }
  }, [current, heard, span]);

  const onNext = useCallback(async () => {
    if (!feedback || sessionDoneRef.current) return;
    const total = history.length;
    const isAtTop = span === SPAN_LADDER[SPAN_LADDER.length - 1];
    const failedAtTop = isAtTop && !feedback.passed;
    if (total >= MAX_SENTENCES_PER_SESSION || failedAtTop) {
      sessionDoneRef.current = true;
      await loadTrend();
      setPhase('summary');
      return;
    }
    const newSpan = feedback.next_span;
    setSpan(newSpan);
    await fetchSentence(newSpan);
  }, [feedback, history.length, span, fetchSentence, loadTrend]);

  const onRestart = useCallback(() => {
    sessionDoneRef.current = false;
    setHistory([]);
    setSpan(SPAN_LADDER[0]);
    setFeedback(null);
    fetchSentence(SPAN_LADDER[0]);
  }, [fetchSentence]);

  const diffMarks = useMemo(() => {
    if (!current || !feedback) return [];
    return diffTokens(current.sentence, heard);
  }, [current, feedback, heard]);

  return (
    <div data-testid="sentence-echo-page" style={{ padding: '1rem', maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <Link
          to="/"
          aria-label="Back to home"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)', textDecoration: 'none' }}
        >
          <ArrowLeft size={18} /> Home
        </Link>
        <h2 style={{ margin: 0, flex: 1 }}>Sentence Echo</h2>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }} data-testid="se-best-span">
          Best span: {bestSpanOverall}
        </span>
      </div>

      <div data-testid="se-ladder" style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {SPAN_LADDER.map((s) => {
          const passedRung = history.some((h) => h.span === s && h.passed);
          const active = s === span;
          return (
            <span
              key={s}
              data-testid={`se-rung-${s}`}
              data-active={active ? '1' : '0'}
              data-passed={passedRung ? '1' : '0'}
              style={{
                padding: '4px 10px', borderRadius: 999, fontSize: 12,
                border: '1px solid var(--border)',
                background: passedRung ? '#10b981' : active ? '#6366f1' : 'transparent',
                color: passedRung || active ? '#fff' : 'inherit',
                fontWeight: 600,
              }}
            >
              {s}
            </span>
          );
        })}
      </div>

      {phase === 'loading' && (
        <div data-testid="se-loading" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
          Loading…
        </div>
      )}

      {phase === 'error' && (
        <div data-testid="se-error" style={{ padding: 16, background: 'var(--danger-bg, #fee)', borderRadius: 8 }}>
          {error || 'Something went wrong.'}
          <button onClick={() => fetchSentence(span)} style={{ marginLeft: 8 }}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}

      {(phase === 'ready' || phase === 'playing' || phase === 'input' || phase === 'scoring') && current && (
        <div data-testid="se-card" style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12 }}>
          <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
            Span: <strong>{span}</strong> words · Sentence {history.length + 1} of {MAX_SENTENCES_PER_SESSION}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <button
              type="button"
              data-testid="se-play"
              onClick={onPlay}
              disabled={!isSupported || playsLeft <= 0 || phase === 'scoring'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 8,
                background: '#6366f1', color: '#fff', border: 'none',
                cursor: playsLeft > 0 ? 'pointer' : 'not-allowed',
                opacity: playsLeft > 0 ? 1 : 0.5,
              }}
            >
              <Volume2 size={16} /> Play ({playsLeft} left)
            </button>
            {!isSupported && (
              <span style={{ fontSize: 12, color: 'var(--danger, #ef4444)' }}>
                Speech synthesis not supported in this browser.
              </span>
            )}
          </div>
          <textarea
            data-testid="se-input"
            value={heard}
            onChange={(e) => setHeard(e.target.value)}
            placeholder="Type exactly what you heard…"
            rows={2}
            style={{
              width: '100%', padding: 8, fontSize: 14,
              border: '1px solid var(--border)', borderRadius: 8,
              background: 'var(--input-bg, #fff)', color: 'inherit',
            }}
            disabled={phase === 'scoring'}
          />
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button
              type="button"
              data-testid="se-submit"
              onClick={onSubmit}
              disabled={!heard.trim() || phase === 'scoring'}
              style={{
                padding: '8px 14px', borderRadius: 8, border: 'none',
                background: '#10b981', color: '#fff',
                cursor: heard.trim() ? 'pointer' : 'not-allowed',
                opacity: heard.trim() ? 1 : 0.5,
              }}
            >
              Submit
            </button>
          </div>
        </div>
      )}

      {phase === 'feedback' && feedback && current && (
        <div data-testid="se-feedback" style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12 }}>
          <div style={{ marginBottom: 8 }}>
            <strong style={{ color: feedback.passed ? '#10b981' : '#ef4444' }}>
              {feedback.passed ? '✓ Passed' : '✗ Try again at this span'}
            </strong>
            <span style={{ marginLeft: 12, fontSize: 13 }}>
              Accuracy: <strong data-testid="se-accuracy">{Math.round(feedback.accuracy * 100)}%</strong>
            </span>
          </div>
          <div data-testid="se-diff" style={{ marginBottom: 8, lineHeight: 1.7 }}>
            {diffMarks.map((m, i) => (
              <span
                key={i}
                style={{
                  marginRight: 6,
                  padding: '1px 4px', borderRadius: 4,
                  background: m.ok ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                  color: m.ok ? '#10b981' : '#ef4444',
                  fontWeight: 600,
                }}
              >
                {m.word}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
            Target: {current.sentence}
            {current.ipa_hint && <div>Hint: {current.ipa_hint}</div>}
          </div>
          <button
            type="button"
            data-testid="se-next"
            onClick={onNext}
            style={{
              padding: '8px 14px', borderRadius: 8, border: 'none',
              background: '#6366f1', color: '#fff', cursor: 'pointer',
            }}
          >
            Next sentence
          </button>
        </div>
      )}

      {phase === 'summary' && (
        <div data-testid="se-summary" style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12 }}>
          <h3 style={{ marginTop: 0 }}>Session complete</h3>
          <div style={{ marginBottom: 8 }}>
            Memory span: <strong data-testid="se-memory-span">{summary.memorySpan}</strong> words
          </div>
          <div style={{ marginBottom: 8 }}>
            Average accuracy: <strong>{Math.round(summary.avgAccuracy * 100)}%</strong>
            {' '}over {summary.sentences} sentence{summary.sentences === 1 ? '' : 's'}
          </div>
          <div style={{ margin: '12px 0' }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
              14-day memory span trend
            </div>
            <Sparkline points={trend} />
          </div>
          <button
            type="button"
            data-testid="se-restart"
            onClick={onRestart}
            style={{
              padding: '8px 14px', borderRadius: 8, border: 'none',
              background: '#10b981', color: '#fff', cursor: 'pointer',
            }}
          >
            Start new session
          </button>
        </div>
      )}
    </div>
  );
}
