import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, X, RotateCcw, Volume2, Mic, MicOff } from 'lucide-react';
import {
  startWhQuestionDrill,
  gradeWhQuestion,
  type WhQuestionItem,
  type WhQuestionGradeResponse,
  type WhWord,
} from '../api';

type Phase = 'intro' | 'loading' | 'drill' | 'feedback' | 'summary' | 'error';

interface AttemptRecord {
  item: WhQuestionItem;
  user_question: string;
  correctness: boolean;
  wh_word_matches: boolean;
  grammar_ok: boolean;
  feedback: string;
  corrected: string;
}

const DEFAULT_COUNT = 5;

const WH_WORDS: WhWord[] = ['who', 'what', 'when', 'where', 'why', 'how'];

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

type SpeechRecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export default function WhQuestionDrill() {
  const [phase, setPhase] = useState<Phase>('intro');
  const [errorMsg, setErrorMsg] = useState('');
  const [items, setItems] = useState<WhQuestionItem[]>([]);
  const [index, setIndex] = useState(0);
  const [userQuestion, setUserQuestion] = useState('');
  const [listening, setListening] = useState(false);
  const [lastResult, setLastResult] = useState<WhQuestionGradeResponse | null>(null);
  const [results, setResults] = useState<AttemptRecord[]>([]);
  const recogRef = useRef<ReturnType<SpeechRecognitionCtor> | null>(null);

  const current = items[index] || null;

  const startDrill = useCallback(async (startItems?: WhQuestionItem[]) => {
    setErrorMsg('');
    setIndex(0);
    setUserQuestion('');
    setLastResult(null);
    setResults([]);
    if (startItems && startItems.length > 0) {
      setItems(startItems);
      setPhase('drill');
      return;
    }
    setPhase('loading');
    try {
      const data = await startWhQuestionDrill(DEFAULT_COUNT);
      if (!data.items || data.items.length === 0) {
        setErrorMsg('No items returned.');
        setPhase('error');
        return;
      }
      setItems(data.items);
      setPhase('drill');
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to load drill');
      setPhase('error');
    }
  }, []);

  // Auto-speak each item when it enters the drill phase.
  useEffect(() => {
    if (phase === 'drill' && current) {
      speak(current.answer_sentence);
    }
  }, [phase, current]);

  const stopListening = useCallback(() => {
    const r = recogRef.current;
    if (r) {
      try {
        r.stop();
      } catch {
        /* ignore */
      }
    }
    setListening(false);
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setErrorMsg('Speech recognition is not supported in this browser.');
      return;
    }
    try {
      const rec = new Ctor();
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.continuous = false;
      rec.onresult = (ev) => {
        const transcript = (ev.results?.[0]?.[0]?.transcript || '').trim();
        if (transcript) setUserQuestion(transcript);
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      recogRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, []);

  useEffect(() => () => stopListening(), [stopListening]);

  const handleSubmit = useCallback(async () => {
    if (!current || !userQuestion.trim()) return;
    try {
      const res = await gradeWhQuestion({
        item_id: current.id,
        answer_sentence: current.answer_sentence,
        target_wh: current.target_wh,
        user_question: userQuestion.trim(),
      });
      setLastResult(res);
      setResults((prev) => [
        ...prev,
        {
          item: current,
          user_question: userQuestion.trim(),
          correctness: res.correctness,
          wh_word_matches: res.wh_word_matches,
          grammar_ok: res.grammar_ok,
          feedback: res.feedback,
          corrected: res.corrected,
        },
      ]);
      setPhase('feedback');
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to grade attempt');
      setPhase('error');
    }
  }, [current, userQuestion]);

  const handleNext = useCallback(() => {
    if (index + 1 >= items.length) {
      setPhase('summary');
    } else {
      setIndex(index + 1);
      setUserQuestion('');
      setLastResult(null);
      setPhase('drill');
    }
  }, [index, items.length]);

  const overallPct = useMemo(() => {
    if (results.length === 0) return 0;
    const n = results.filter((r) => r.correctness).length;
    return Math.round((n / results.length) * 100);
  }, [results]);

  const byWh = useMemo(() => {
    const acc: Record<string, { total: number; correct: number }> = {};
    for (const r of results) {
      const wh = r.item.target_wh;
      if (!acc[wh]) acc[wh] = { total: 0, correct: 0 };
      acc[wh].total += 1;
      if (r.correctness) acc[wh].correct += 1;
    }
    return acc;
  }, [results]);

  const missed = useMemo(
    () => results.filter((r) => !r.correctness).map((r) => r.item),
    [results],
  );

  const retryMissed = useCallback(() => {
    if (missed.length === 0) return;
    startDrill(missed);
  }, [missed, startDrill]);

  return (
    <div
      data-testid="wh-question-page"
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
        data-testid="wh-question-title"
        style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}
      >
        ❓ WH-Question Formation
      </h1>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
        Listen to a short answer, then SPEAK the WH-question that elicits it —
        Jeopardy-style. Targets auxiliaries, word order, and wh-word choice.
      </p>

      {phase === 'intro' && (
        <div data-testid="wh-question-intro">
          <div
            style={{
              padding: 16, border: '1px solid var(--border)', borderRadius: 12,
              marginBottom: 16, background: 'var(--bg-card, transparent)',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Example</div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 6 }}>
              You hear: <i>"She left at 7 a.m. because she had a meeting."</i>
            </div>
            <div style={{ fontSize: 14 }}>
              You say: <b>"Why did she leave at 7 a.m.?"</b>
            </div>
          </div>
          <button
            data-testid="wh-question-start"
            onClick={() => startDrill()}
            style={{
              width: '100%', padding: '12px 16px',
              background: '#0ea5e9', color: 'white', border: 'none',
              borderRadius: 10, fontWeight: 600, fontSize: 15, cursor: 'pointer',
            }}
          >
            Start drill ({DEFAULT_COUNT} items)
          </button>
        </div>
      )}

      {phase === 'loading' && (
        <div data-testid="wh-question-loading" style={{ padding: 24, textAlign: 'center' }}>
          Loading…
        </div>
      )}

      {phase === 'error' && (
        <div
          data-testid="wh-question-error"
          style={{
            padding: 16, border: '1px solid #ef4444', borderRadius: 10,
            background: 'rgba(239,68,68,0.08)', color: '#ef4444',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Oops</div>
          <div style={{ fontSize: 14 }}>{errorMsg}</div>
          <button
            onClick={() => setPhase('intro')}
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
        <div data-testid="wh-question-drill">
          <div
            data-testid="wh-question-progress"
            style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}
          >
            {index + 1} / {items.length}
          </div>

          <div
            style={{
              padding: 16, border: '1px solid var(--border)', borderRadius: 12,
              marginBottom: 12, background: 'var(--bg-card, transparent)',
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Answer statement
            </div>
            <div
              data-testid="wh-question-answer"
              style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}
            >
              {current.answer_sentence}
            </div>
            <button
              data-testid="wh-question-listen"
              onClick={() => speak(current.answer_sentence)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', border: '1px solid var(--border)',
                background: 'transparent', color: 'inherit',
                borderRadius: 8, cursor: 'pointer', fontSize: 13,
              }}
            >
              <Volume2 size={14} /> Listen
            </button>
            {current.hint && (
              <div
                data-testid="wh-question-hint"
                style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}
              >
                💡 Hint: {current.hint}
              </div>
            )}
          </div>

          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="wh-question-input"
              style={{ fontSize: 13, color: 'var(--text-secondary)' }}
            >
              Your WH-question:
            </label>
            <input
              id="wh-question-input"
              data-testid="wh-question-input"
              type="text"
              value={userQuestion}
              onChange={(e) => setUserQuestion(e.target.value)}
              placeholder={`Start with "${current.target_wh}"…`}
              style={{
                width: '100%', padding: '10px 12px', marginTop: 6,
                border: '1px solid var(--border)', borderRadius: 8,
                background: 'var(--bg-input, transparent)', color: 'inherit',
                fontSize: 15,
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button
              data-testid="wh-question-mic"
              onClick={listening ? stopListening : startListening}
              aria-pressed={listening}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '10px 14px',
                border: '1px solid var(--border)',
                background: listening ? '#ef4444' : 'transparent',
                color: listening ? 'white' : 'inherit',
                borderRadius: 8, cursor: 'pointer', fontSize: 14,
              }}
            >
              {listening ? <MicOff size={16} /> : <Mic size={16} />}
              {listening ? 'Stop' : 'Speak'}
            </button>
            <button
              data-testid="wh-question-submit"
              onClick={handleSubmit}
              disabled={!userQuestion.trim()}
              style={{
                flex: 1, padding: '10px 14px',
                background: userQuestion.trim() ? '#0ea5e9' : 'var(--border)',
                color: 'white', border: 'none', borderRadius: 8,
                fontWeight: 600, fontSize: 14,
                cursor: userQuestion.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              Submit
            </button>
          </div>
        </div>
      )}

      {phase === 'feedback' && current && lastResult && (
        <div data-testid="wh-question-feedback">
          <div
            style={{
              padding: 16, border: '1px solid var(--border)', borderRadius: 12,
              marginBottom: 12,
              background: lastResult.correctness
                ? 'rgba(34,197,94,0.08)'
                : 'rgba(239,68,68,0.06)',
            }}
          >
            <div
              data-testid="wh-question-feedback-result"
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontWeight: 700, fontSize: 18, marginBottom: 8,
                color: lastResult.correctness ? '#22c55e' : '#ef4444',
              }}
            >
              {lastResult.correctness ? <Check size={20} /> : <X size={20} />}
              {lastResult.correctness ? 'Correct!' : 'Not quite'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Your question:
            </div>
            <div
              data-testid="wh-question-user-attempt"
              style={{ fontSize: 15, marginBottom: 8 }}
            >
              {results[results.length - 1]?.user_question}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Suggested question:
            </div>
            <div
              data-testid="wh-question-corrected"
              style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}
            >
              {lastResult.corrected || `${current.target_wh}…?`}
            </div>
            <div
              data-testid="wh-question-feedback-text"
              style={{ fontSize: 14 }}
            >
              {lastResult.feedback}
            </div>
          </div>
          <button
            data-testid="wh-question-next"
            onClick={handleNext}
            style={{
              width: '100%', padding: '12px 16px',
              background: '#0ea5e9', color: 'white', border: 'none',
              borderRadius: 10, fontWeight: 600, fontSize: 15, cursor: 'pointer',
            }}
          >
            {index + 1 >= items.length ? 'See summary' : 'Next'}
          </button>
        </div>
      )}

      {phase === 'summary' && (
        <div data-testid="wh-question-summary">
          <div
            style={{
              padding: 16, border: '1px solid var(--border)', borderRadius: 12,
              marginBottom: 12, background: 'var(--bg-card, transparent)',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
              Session summary
            </div>
            <div
              data-testid="wh-question-overall-accuracy"
              style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}
            >
              {overallPct}% correct
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {WH_WORDS.map((wh) => {
                const b = byWh[wh];
                if (!b || b.total === 0) return null;
                const pct = Math.round((b.correct / b.total) * 100);
                return (
                  <div key={wh} data-testid={`wh-question-bar-${wh}`}>
                    <div
                      style={{
                        display: 'flex', justifyContent: 'space-between',
                        fontSize: 13, marginBottom: 4,
                      }}
                    >
                      <span>{wh}</span>
                      <span>
                        {b.correct} / {b.total} ({pct}%)
                      </span>
                    </div>
                    <div
                      style={{
                        height: 8, background: 'var(--border)', borderRadius: 4,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`, height: '100%',
                          background: pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {missed.length > 0 && (
              <button
                data-testid="wh-question-retry-missed"
                onClick={retryMissed}
                style={{
                  flex: 1, padding: '10px 14px',
                  background: '#f59e0b', color: 'white', border: 'none',
                  borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                <RotateCcw size={14} /> Retry missed ({missed.length})
              </button>
            )}
            <button
              data-testid="wh-question-new-session"
              onClick={() => startDrill()}
              style={{
                flex: 1, padding: '10px 14px',
                background: '#0ea5e9', color: 'white', border: 'none',
                borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer',
              }}
            >
              New session
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
