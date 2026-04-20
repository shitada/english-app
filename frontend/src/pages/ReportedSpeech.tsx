import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, X, RotateCcw, Volume2, Eye, EyeOff } from 'lucide-react';
import {
  createReportedSpeechSession,
  gradeReportedSpeech,
  type ReportedSpeechItem,
  type ReportedSpeechGradeResponse,
  type ReportedSpeechFocusTag,
} from '../api';

type Phase = 'intro' | 'loading' | 'drill' | 'feedback' | 'summary' | 'error';

interface AttemptResult {
  item: ReportedSpeechItem;
  user_answer: string;
  grade: ReportedSpeechGradeResponse;
}

const SESSION_SIZE = 5;

const FOCUS_TAG_DISPLAY: Record<ReportedSpeechFocusTag, string> = {
  backshift: 'Backshift',
  pronoun: 'Pronoun shift',
  time_adverb: 'Time adverb',
  question: 'Reported question',
  command: 'Reported command',
};

const FOCUS_TAG_COLOR: Record<ReportedSpeechFocusTag, string> = {
  backshift: '#6366f1',
  pronoun: '#0ea5e9',
  time_adverb: '#f59e0b',
  question: '#ec4899',
  command: '#10b981',
};

function speak(text: string) {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export default function ReportedSpeech() {
  const [phase, setPhase] = useState<Phase>('intro');
  const [errorMsg, setErrorMsg] = useState('');
  const [items, setItems] = useState<ReportedSpeechItem[]>([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [results, setResults] = useState<AttemptResult[]>([]);
  const [lastGrade, setLastGrade] = useState<ReportedSpeechGradeResponse | null>(null);
  const [revealReference, setRevealReference] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const current = items[index] || null;

  const loadSession = useCallback(async (weakTag?: ReportedSpeechFocusTag) => {
    setPhase('loading');
    setErrorMsg('');
    setAnswer('');
    setIndex(0);
    setResults([]);
    setLastGrade(null);
    setRevealReference(false);
    try {
      const data = await createReportedSpeechSession(SESSION_SIZE);
      let chosen = data.items;
      if (weakTag) {
        const filtered = data.items.filter((it) => it.focus_tags.includes(weakTag));
        if (filtered.length >= 1) {
          chosen = filtered.concat(
            data.items.filter((it) => !it.focus_tags.includes(weakTag)),
          ).slice(0, SESSION_SIZE);
        }
      }
      setItems(chosen);
      setPhase('drill');
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to load drill');
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    if (phase === 'drill' && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [phase, index]);

  const submitAnswer = async () => {
    if (!current) return;
    const trimmed = answer.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const grade = await gradeReportedSpeech({
        item_id: current.id,
        direct: current.direct,
        reference: current.reference,
        accepted_variants: current.accepted_variants,
        focus_tags: current.focus_tags,
        user_answer: trimmed,
      });
      const result: AttemptResult = { item: current, user_answer: trimmed, grade };
      setLastGrade(grade);
      setResults((prev) => [...prev, result]);
      setPhase('feedback');
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to grade attempt');
      setPhase('error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submitAnswer();
    }
  };

  const nextItem = () => {
    if (index + 1 >= items.length) {
      setPhase('summary');
      return;
    }
    setIndex((i) => i + 1);
    setAnswer('');
    setLastGrade(null);
    setRevealReference(false);
    setPhase('drill');
  };

  const byTag = useMemo(() => {
    const buckets: Record<string, { total: number; correct: number }> = {};
    for (const r of results) {
      for (const tag of r.item.focus_tags) {
        const b = buckets[tag] || { total: 0, correct: 0 };
        b.total += 1;
        if (r.grade.correct) b.correct += 1;
        buckets[tag] = b;
      }
    }
    return buckets;
  }, [results]);

  const weakestTag = useMemo<ReportedSpeechFocusTag | null>(() => {
    let worst: { tag: ReportedSpeechFocusTag; acc: number } | null = null;
    for (const [tag, info] of Object.entries(byTag)) {
      if (info.total === 0) continue;
      const acc = info.correct / info.total;
      if (!worst || acc < worst.acc) {
        worst = { tag: tag as ReportedSpeechFocusTag, acc };
      }
    }
    return worst && worst.acc < 0.7 ? worst.tag : null;
  }, [byTag]);

  const totalCorrect = results.filter((r) => r.grade.correct).length;
  const totalScore = results.reduce((sum, r) => sum + r.grade.score, 0);
  const avgScore = results.length > 0 ? Math.round(totalScore / results.length) : 0;

  return (
    <div
      data-testid="reported-speech-page"
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '1rem',
        background: 'var(--bg-card)',
        color: 'var(--text-primary)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Link to="/" aria-label="Back to home" style={{ display: 'flex', color: 'var(--text-secondary)' }}>
          <ArrowLeft size={20} />
        </Link>
        <h2 data-testid="reported-speech-title" style={{ margin: 0, flex: 1 }}>
          🗣️ Reported Speech Drill
        </h2>
        {(phase === 'drill' || phase === 'feedback') && items.length > 0 && (
          <div
            data-testid="reported-speech-progress-dots"
            style={{ display: 'flex', gap: 4 }}
            aria-label={`Item ${index + 1} of ${items.length}`}
          >
            {items.map((_, i) => {
              const done = i < results.length;
              const correct = done ? results[i].grade.correct : false;
              const isCurrent = i === index;
              return (
                <span
                  key={i}
                  data-testid={`reported-speech-dot-${i}`}
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    background: done
                      ? correct
                        ? '#10b981'
                        : '#ef4444'
                      : isCurrent
                      ? 'var(--primary, #3b82f6)'
                      : 'var(--border)',
                    display: 'inline-block',
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      {phase === 'intro' && (
        <div
          data-testid="reported-speech-intro"
          className="card"
          style={{
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '1rem',
            marginBottom: 16,
            background: 'var(--bg-card)',
          }}
        >
          <p style={{ marginTop: 0 }}>
            Transform <b>direct quotes</b> into natural <b>reported (indirect) speech</b>.
            Watch the backshift, pronoun shift, time-adverb shift, and question/command structure.
          </p>
          <button
            data-testid="reported-speech-start"
            onClick={() => loadSession()}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--primary, #3b82f6)',
              color: 'white',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Start 5 items
          </button>
        </div>
      )}

      {phase === 'loading' && (
        <div data-testid="reported-speech-loading" style={{ padding: '2rem', textAlign: 'center' }}>
          Loading session…
        </div>
      )}

      {phase === 'error' && (
        <div
          data-testid="reported-speech-error"
          style={{
            padding: '1rem',
            border: '1px solid #ef4444',
            borderRadius: 8,
            color: '#ef4444',
            marginBottom: 12,
          }}
        >
          {errorMsg || 'Something went wrong.'}
          <div style={{ marginTop: 8 }}>
            <button onClick={() => loadSession()}>Retry</button>
          </div>
        </div>
      )}

      {(phase === 'drill' || phase === 'feedback') && current && (
        <div
          data-testid="reported-speech-drill"
          className="card"
          style={{
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '1rem',
            marginBottom: 16,
            background: 'var(--bg-card)',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {current.focus_tags.map((tag) => (
              <span
                key={tag}
                data-testid={`reported-speech-tag-${tag}`}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: FOCUS_TAG_COLOR[tag] + '22',
                  color: FOCUS_TAG_COLOR[tag],
                  border: `1px solid ${FOCUS_TAG_COLOR[tag]}66`,
                }}
              >
                {FOCUS_TAG_DISPLAY[tag]}
              </span>
            ))}
          </div>

          <div
            data-testid="reported-speech-direct"
            style={{
              fontSize: 17,
              lineHeight: 1.5,
              padding: '12px 14px',
              borderRadius: 8,
              background: 'rgba(59,130,246,0.08)',
              border: '1px solid rgba(59,130,246,0.25)',
              marginBottom: 8,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <button
              data-testid="reported-speech-tts"
              aria-label="Play direct speech"
              onClick={() => speak(current.direct)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--primary, #3b82f6)',
                padding: 0,
                marginTop: 2,
              }}
            >
              <Volume2 size={20} />
            </button>
            <span>{current.direct}</span>
          </div>

          <div
            data-testid="reported-speech-hint"
            style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}
          >
            {current.context_hint}
          </div>

          <textarea
            ref={textareaRef}
            data-testid="reported-speech-input"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={phase === 'feedback'}
            placeholder="Type the reported-speech version…"
            rows={3}
            style={{
              width: '100%',
              padding: 10,
              borderRadius: 8,
              border: '1px solid var(--border)',
              fontSize: 15,
              fontFamily: 'inherit',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />

          {phase === 'drill' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button
                data-testid="reported-speech-submit"
                onClick={() => void submitAnswer()}
                disabled={!answer.trim() || submitting}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: answer.trim() && !submitting ? 'var(--primary, #3b82f6)' : 'var(--border)',
                  color: 'white',
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: answer.trim() && !submitting ? 'pointer' : 'not-allowed',
                }}
              >
                {submitting ? 'Grading…' : 'Submit'}
              </button>
              <button
                data-testid="reported-speech-reveal"
                onClick={() => setRevealReference((v) => !v)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {revealReference ? <EyeOff size={14} /> : <Eye size={14} />}
                {revealReference ? 'Hide reference' : 'Peek reference'}
              </button>
            </div>
          )}

          {revealReference && phase === 'drill' && (
            <div
              data-testid="reported-speech-reference-peek"
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 8,
                background: 'rgba(245,158,11,0.12)',
                border: '1px solid rgba(245,158,11,0.4)',
                fontSize: 14,
              }}
            >
              {current.reference}
            </div>
          )}

          {phase === 'feedback' && lastGrade && (
            <div
              data-testid="reported-speech-feedback"
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 8,
                background: lastGrade.correct
                  ? 'rgba(16, 185, 129, 0.12)'
                  : 'rgba(239, 68, 68, 0.12)',
                border: `1px solid ${lastGrade.correct ? '#10b981' : '#ef4444'}`,
              }}
            >
              <div
                data-testid="reported-speech-feedback-result"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontWeight: 600,
                  color: lastGrade.correct ? '#10b981' : '#ef4444',
                  marginBottom: 6,
                }}
              >
                {lastGrade.correct ? <Check size={18} /> : <X size={18} />}
                {lastGrade.correct ? 'Correct!' : 'Not quite'}
                <span style={{ marginLeft: 'auto', fontWeight: 700 }}>
                  {lastGrade.score}/100
                </span>
              </div>

              <div
                data-testid="reported-speech-score-bar"
                style={{
                  height: 8,
                  borderRadius: 4,
                  background: 'var(--border, #e5e7eb)',
                  overflow: 'hidden',
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    width: `${lastGrade.score}%`,
                    height: '100%',
                    background: lastGrade.score >= 80
                      ? '#10b981'
                      : lastGrade.score >= 60
                      ? '#f59e0b'
                      : '#ef4444',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>

              <div style={{ fontSize: 13, marginBottom: 8 }}>
                {lastGrade.feedback}
              </div>

              {lastGrade.diff_highlights.length > 0 && (
                <div
                  data-testid="reported-speech-diff-highlights"
                  style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}
                >
                  {lastGrade.diff_highlights.map((d, i) => {
                    const colors: Record<string, string> = {
                      missing: '#f59e0b',
                      wrong: '#ef4444',
                      extra: '#8b5cf6',
                    };
                    const c = colors[d.kind] || '#6b7280';
                    return (
                      <span
                        key={i}
                        data-testid={`reported-speech-diff-${d.kind}`}
                        style={{
                          fontSize: 12,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: c + '22',
                          color: c,
                          border: `1px solid ${c}66`,
                        }}
                      >
                        {d.kind === 'missing' ? '+ ' : d.kind === 'extra' ? '− ' : '! '}
                        {d.text}
                      </span>
                    );
                  })}
                </div>
              )}

              <div
                data-testid="reported-speech-reference"
                style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}
              >
                Reference: <i>{current.reference}</i>
              </div>

              <div style={{ textAlign: 'right' }}>
                <button
                  data-testid="reported-speech-next"
                  onClick={nextItem}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'var(--primary, #3b82f6)',
                    color: 'white',
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: 'pointer',
                  }}
                >
                  {index + 1 >= items.length ? 'Finish' : 'Next →'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {phase === 'summary' && (
        <div
          data-testid="reported-speech-summary"
          className="card"
          style={{
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '1.25rem',
            background: 'var(--bg-card)',
          }}
        >
          <h3 style={{ marginTop: 0 }}>Session complete! 🎉</h3>
          <div
            data-testid="reported-speech-score-summary"
            style={{ fontSize: 28, fontWeight: 700, margin: '8px 0' }}
          >
            {totalCorrect} / {results.length}
            <span style={{ fontSize: 14, color: 'var(--text-secondary)', marginLeft: 10 }}>
              avg {avgScore}/100
            </span>
          </div>

          <div style={{ marginTop: 12, marginBottom: 16 }}>
            {Object.entries(byTag).map(([tag, info]) => {
              const pct = info.total > 0 ? Math.round((info.correct / info.total) * 100) : 0;
              const t = tag as ReportedSpeechFocusTag;
              return (
                <div
                  key={tag}
                  data-testid={`reported-speech-bar-${tag}`}
                  style={{ marginBottom: 10 }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 13,
                      marginBottom: 4,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span>{FOCUS_TAG_DISPLAY[t] || tag}</span>
                    <span>
                      {info.correct} / {info.total} ({pct}%)
                    </span>
                  </div>
                  <div
                    style={{
                      background: 'var(--border, #e5e7eb)',
                      borderRadius: 4,
                      height: 10,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        background:
                          pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 18, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              data-testid="reported-speech-restart"
              onClick={() => loadSession()}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--primary, #3b82f6)',
                color: 'white',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <RotateCcw size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              New session
            </button>
            {weakestTag && (
              <button
                data-testid="reported-speech-practice-weakest"
                onClick={() => loadSession(weakestTag)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Practice weakest tag: {FOCUS_TAG_DISPLAY[weakestTag]}
              </button>
            )}
            <Link
              to="/"
              data-testid="reported-speech-home"
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                textDecoration: 'none',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
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
