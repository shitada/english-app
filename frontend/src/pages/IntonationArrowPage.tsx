import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Volume2, RotateCcw, Check, X } from 'lucide-react';
import {
  fetchIntonationArrowSession,
  postIntonationArrowAttempt,
  type IntonationItem,
  type IntonationPattern,
} from '../api';

type Phase = 'idle' | 'loading' | 'drill' | 'summary' | 'error';

interface AttemptRecord {
  item: IntonationItem;
  chosen: IntonationPattern;
  correct: boolean;
}

const PATTERN_LABELS: Record<IntonationPattern, { arrow: string; label: string; aria: string }> = {
  rising: { arrow: '↗', label: 'Rising', aria: 'Rising intonation — pitch goes up at the end' },
  falling: { arrow: '↘', label: 'Falling', aria: 'Falling intonation — pitch goes down at the end' },
  rise_fall: { arrow: '↗↘', label: 'Rise-Fall', aria: 'Rise-fall intonation — pitch rises then falls' },
};

const PATTERNS: IntonationPattern[] = ['rising', 'falling', 'rise_fall'];

const SESSION_SIZE = 8;
const MAX_REPLAYS = 2;

function speak(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* noop */
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}

export default function IntonationArrowPage() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [items, setItems] = useState<IntonationItem[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<IntonationPattern | null>(null);
  const [replays, setReplays] = useState(0);
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [feedback, setFeedback] = useState<{ correct: boolean; pattern: IntonationPattern; explanation: string } | null>(null);
  const [retryWrongOnly, setRetryWrongOnly] = useState<IntonationItem[] | null>(null);
  const startTimeRef = useRef<number>(0);

  const currentItem = items[index] || null;

  const loadSession = useCallback(async (retryItems?: IntonationItem[]) => {
    setPhase('loading');
    setErrorMsg('');
    setAttempts([]);
    setIndex(0);
    setSelected(null);
    setReplays(0);
    setFeedback(null);
    try {
      let sessionItems: IntonationItem[];
      if (retryItems && retryItems.length > 0) {
        sessionItems = retryItems;
      } else {
        const resp = await fetchIntonationArrowSession(SESSION_SIZE);
        sessionItems = resp.items;
      }
      if (!sessionItems.length) {
        throw new Error('No items returned');
      }
      setItems(sessionItems);
      setPhase('drill');
      startTimeRef.current = Date.now();
      // Auto-play first item
      setTimeout(() => speak(sessionItems[0].text), 350);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to start session');
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try { window.speechSynthesis.cancel(); } catch { /* noop */ }
      }
    };
  }, []);

  const handleReplay = useCallback(() => {
    if (!currentItem) return;
    if (replays >= MAX_REPLAYS) return;
    setReplays((r) => r + 1);
    speak(currentItem.text);
  }, [currentItem, replays]);

  const handleChoose = useCallback(async (pattern: IntonationPattern) => {
    if (!currentItem || selected) return;
    setSelected(pattern);
    const latency = Math.max(0, Date.now() - startTimeRef.current);
    const isCorrect = pattern === currentItem.pattern;
    try {
      const resp = await postIntonationArrowAttempt({
        item_id: currentItem.id,
        chosen: pattern,
        correct: isCorrect,
        latency_ms: latency,
      });
      setFeedback({ correct: resp.correct, pattern: resp.pattern, explanation: resp.explanation });
      setAttempts((prev) => [...prev, { item: currentItem, chosen: pattern, correct: resp.correct }]);
    } catch {
      setFeedback({ correct: isCorrect, pattern: currentItem.pattern, explanation: currentItem.explanation });
      setAttempts((prev) => [...prev, { item: currentItem, chosen: pattern, correct: isCorrect }]);
    }
  }, [currentItem, selected]);

  const handleNext = useCallback(() => {
    if (index + 1 >= items.length) {
      setPhase('summary');
      return;
    }
    const nextIdx = index + 1;
    setIndex(nextIdx);
    setSelected(null);
    setReplays(0);
    setFeedback(null);
    startTimeRef.current = Date.now();
    setTimeout(() => speak(items[nextIdx].text), 300);
  }, [index, items]);

  const wrongItems = useMemo(() => attempts.filter((a) => !a.correct).map((a) => a.item), [attempts]);

  const perPatternSummary = useMemo(() => {
    const buckets: Record<IntonationPattern, { total: number; correct: number }> = {
      rising: { total: 0, correct: 0 },
      falling: { total: 0, correct: 0 },
      rise_fall: { total: 0, correct: 0 },
    };
    for (const a of attempts) {
      const p = a.item.pattern;
      buckets[p].total += 1;
      if (a.correct) buckets[p].correct += 1;
    }
    return PATTERNS.map((p) => ({
      pattern: p,
      total: buckets[p].total,
      correct: buckets[p].correct,
      accuracy: buckets[p].total > 0 ? buckets[p].correct / buckets[p].total : 0,
    }));
  }, [attempts]);

  const overallCorrect = attempts.filter((a) => a.correct).length;

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------
  if (phase === 'idle') {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '1rem' }}>
        <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', textDecoration: 'none', marginBottom: 16 }}>
          <ArrowLeft size={16} /> Home
        </Link>
        <h1 data-testid="intonation-arrow-title" style={{ fontSize: 28, marginBottom: 8 }}>↗↘ Intonation Arrow</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
          Listen to a short English sentence and tap the arrow that matches its final intonation —
          Rising (↗), Falling (↘), or Rise-Fall (↗↘).
        </p>
        <button
          data-testid="intonation-arrow-start"
          onClick={() => { setRetryWrongOnly(null); loadSession(); }}
          style={{
            padding: '12px 28px', borderRadius: 10,
            background: '#8b5cf6', color: 'white', fontWeight: 600,
            border: 'none', cursor: 'pointer', fontSize: 16,
          }}
        >
          Start drill
        </button>
      </div>
    );
  }

  if (phase === 'loading') {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem', textAlign: 'center' }}>
        <p>Loading session…</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem' }}>
        <p style={{ color: 'var(--danger, #dc2626)' }}>Error: {errorMsg}</p>
        <button onClick={() => loadSession()} style={{ padding: '8px 16px' }}>Retry</button>
      </div>
    );
  }

  if (phase === 'summary') {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '1rem' }} data-testid="intonation-arrow-summary">
        <h2 style={{ fontSize: 24, marginBottom: 12 }}>Session complete</h2>
        <p data-testid="intonation-arrow-score" style={{ fontSize: 20, marginBottom: 20 }}>
          Score: <strong>{overallCorrect} / {attempts.length}</strong>
        </p>
        <div data-testid="intonation-arrow-per-pattern" style={{ marginBottom: 20 }}>
          {perPatternSummary.map((ps) => (
            <div key={ps.pattern} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '8px 12px', borderBottom: '1px solid var(--border)',
            }}>
              <span>{PATTERN_LABELS[ps.pattern].arrow} {PATTERN_LABELS[ps.pattern].label}</span>
              <span>{ps.total > 0 ? `${ps.correct}/${ps.total} (${Math.round(ps.accuracy * 100)}%)` : '—'}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            data-testid="intonation-arrow-retry"
            onClick={() => { setRetryWrongOnly(null); loadSession(); }}
            style={{ padding: '10px 20px', borderRadius: 8, background: '#8b5cf6', color: 'white', border: 'none', fontWeight: 600, cursor: 'pointer' }}
          >
            <RotateCcw size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            New session
          </button>
          {wrongItems.length > 0 && (
            <button
              data-testid="intonation-arrow-retry-wrong"
              onClick={() => { setRetryWrongOnly(wrongItems); loadSession(wrongItems); }}
              style={{ padding: '10px 20px', borderRadius: 8, background: '#ef4444', color: 'white', border: 'none', fontWeight: 600, cursor: 'pointer' }}
            >
              Retry wrong only ({wrongItems.length})
            </button>
          )}
        </div>
      </div>
    );
  }

  // phase === 'drill'
  if (!currentItem) return null;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1rem' }} data-testid="intonation-arrow-drill">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Link to="/" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>
          <ArrowLeft size={16} /> Home
        </Link>
        <span data-testid="intonation-arrow-progress" style={{ color: 'var(--text-secondary)' }}>
          {index + 1} / {items.length}{retryWrongOnly ? ' (retry)' : ''}
        </span>
      </div>

      <div className="card" style={{
        padding: '1.5rem', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <button
            data-testid="intonation-arrow-listen"
            onClick={() => speak(currentItem.text)}
            aria-label="Listen to utterance"
            style={{ padding: '10px 16px', borderRadius: 8, background: '#0ea5e9', color: 'white', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <Volume2 size={18} /> Listen
          </button>
          <button
            data-testid="intonation-arrow-replay"
            onClick={handleReplay}
            disabled={replays >= MAX_REPLAYS || !!selected}
            aria-label={`Replay (${MAX_REPLAYS - replays} left)`}
            style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--bg-elevated, #f1f5f9)', color: 'var(--text-primary)', border: '1px solid var(--border)', cursor: replays >= MAX_REPLAYS ? 'not-allowed' : 'pointer', opacity: replays >= MAX_REPLAYS ? 0.5 : 1 }}
          >
            <RotateCcw size={16} /> Replay ({MAX_REPLAYS - replays})
          </button>
        </div>
        {selected && (
          <p data-testid="intonation-arrow-text" style={{ fontSize: 18, lineHeight: 1.5, marginTop: 12 }}>
            “{currentItem.text}”
          </p>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {PATTERNS.map((p) => {
          const isSelected = selected === p;
          const isAnswer = feedback && p === feedback.pattern;
          let bg = 'var(--bg-elevated, #f1f5f9)';
          let color = 'var(--text-primary)';
          let border = '1px solid var(--border)';
          if (selected) {
            if (isAnswer) { bg = '#22c55e'; color = 'white'; border = '1px solid #16a34a'; }
            else if (isSelected && !feedback?.correct) { bg = '#ef4444'; color = 'white'; border = '1px solid #dc2626'; }
          }
          return (
            <button
              key={p}
              data-testid={`intonation-arrow-chip-${p}`}
              aria-label={PATTERN_LABELS[p].aria}
              disabled={!!selected}
              onClick={() => handleChoose(p)}
              style={{
                padding: '16px 12px', borderRadius: 10, background: bg, color,
                border, fontWeight: 600, fontSize: 16, cursor: selected ? 'default' : 'pointer',
              }}
            >
              <div style={{ fontSize: 28, lineHeight: 1 }}>{PATTERN_LABELS[p].arrow}</div>
              <div style={{ fontSize: 14, marginTop: 4 }}>{PATTERN_LABELS[p].label}</div>
            </button>
          );
        })}
      </div>

      {feedback && (
        <div data-testid="intonation-arrow-feedback" style={{
          marginTop: 20, padding: '14px 16px', borderRadius: 10,
          background: feedback.correct ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
          border: `1px solid ${feedback.correct ? '#22c55e' : '#ef4444'}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, marginBottom: 6 }}>
            {feedback.correct ? <Check size={18} color="#16a34a" /> : <X size={18} color="#dc2626" />}
            {feedback.correct ? 'Correct' : 'Not quite'} — target: {PATTERN_LABELS[feedback.pattern].arrow} {PATTERN_LABELS[feedback.pattern].label}
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{feedback.explanation}</div>
          <button
            data-testid="intonation-arrow-next"
            onClick={handleNext}
            style={{ marginTop: 12, padding: '8px 18px', borderRadius: 8, background: '#8b5cf6', color: 'white', border: 'none', fontWeight: 600, cursor: 'pointer' }}
          >
            {index + 1 >= items.length ? 'See results' : 'Next'}
          </button>
        </div>
      )}
    </div>
  );
}
