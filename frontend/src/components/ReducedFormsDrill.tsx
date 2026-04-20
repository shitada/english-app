import { useState, useEffect, useCallback, useRef } from 'react';
import { Volume2, Mic, ChevronRight, RefreshCw } from 'lucide-react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

interface ReducedFormItem {
  id: string;
  reduction_type: string;
  reduced_text: string;
  full_text: string;
  focus_chunks: string[];
}

interface RoundResponse {
  items: ReducedFormItem[];
}

interface AttemptResult {
  itemId: string;
  reductionType: string;
  expandCorrect: boolean;
  shadowAccuracy: number;
}

type Step = 'listen' | 'expand' | 'shadow';

function normalize(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shadowAccuracy(reduced: string, transcript: string): number {
  const refTokens = normalize(reduced).split(' ').filter(Boolean);
  const heard = new Set(normalize(transcript).split(' ').filter(Boolean));
  if (refTokens.length === 0) return 0;
  let hits = 0;
  for (const t of refTokens) if (heard.has(t)) hits++;
  return Math.round((hits / refTokens.length) * 100);
}

export default function ReducedFormsDrill() {
  const tts = useSpeechSynthesis();
  const speech = useSpeechRecognition();

  const [items, setItems] = useState<ReducedFormItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [step, setStep] = useState<Step>('listen');
  const [expandInput, setExpandInput] = useState('');
  const [expandResult, setExpandResult] = useState<null | boolean>(null);
  const [results, setResults] = useState<AttemptResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const wasListeningRef = useRef(false);

  const current = items[idx];

  const loadRound = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/reduced-forms/round');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: RoundResponse = await res.json();
      setItems(data.items);
      setIdx(0);
      setStep('listen');
      setExpandInput('');
      setExpandResult(null);
      setResults([]);
      setStarted(true);
      setDone(false);
    } catch (e: any) {
      setError(e?.message || 'Failed to load round');
    } finally {
      setLoading(false);
    }
  }, []);

  const submitAttempt = useCallback(async (item: ReducedFormItem, userExpand: string, accuracy: number) => {
    try {
      const res = await fetch('/api/reduced-forms/attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: item.id,
          reduction_type: item.reduction_type,
          reduced_text: item.reduced_text,
          full_text: item.full_text,
          user_expand: userExpand,
          shadow_accuracy: accuracy,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return Boolean(data.expand_correct);
    } catch {
      return false;
    }
  }, []);

  // Watch for shadow recording finished
  useEffect(() => {
    if (wasListeningRef.current && !speech.isListening && current && step === 'shadow') {
      const acc = shadowAccuracy(current.reduced_text, speech.transcript);
      const result: AttemptResult = {
        itemId: current.id,
        reductionType: current.reduction_type,
        expandCorrect: expandResult === true,
        shadowAccuracy: acc,
      };
      setResults(prev => [...prev, result]);
      submitAttempt(current, expandInput, acc).catch(() => {});
      // advance
      if (idx + 1 >= items.length) {
        setDone(true);
      } else {
        setIdx(i => i + 1);
        setStep('listen');
        setExpandInput('');
        setExpandResult(null);
        speech.reset();
      }
    }
    wasListeningRef.current = speech.isListening;
  }, [speech.isListening, speech.transcript, step, current, idx, items.length, expandResult, expandInput, submitAttempt, speech]);

  const handleListen = useCallback(() => {
    if (!current) return;
    tts.speak(current.reduced_text);
  }, [current, tts]);

  const handleSubmitExpand = useCallback(() => {
    if (!current) return;
    const ok = normalize(expandInput) === normalize(
      current.full_text
        .replace(/\b(I'm)\b/gi, 'I am')
        .replace(/\b(don't)\b/gi, 'do not')
    ) || normalize(expandInput) === normalize(current.full_text);
    setExpandResult(ok);
  }, [current, expandInput]);

  const handleAdvanceFromExpand = useCallback(() => {
    setStep('shadow');
  }, []);

  const handleRecord = useCallback(() => {
    if (speech.isListening) {
      speech.stop();
    } else {
      speech.reset();
      speech.start();
    }
  }, [speech]);

  const overallAccuracy = results.length
    ? Math.round(
        results.reduce((s, r) => s + (r.expandCorrect ? 50 : 0) + r.shadowAccuracy / 2, 0) / results.length
      )
    : 0;

  if (!tts.isSupported || !speech.isSupported) {
    return (
      <div data-testid="reduced-forms-unsupported" style={{
        background: 'var(--card-bg, white)', borderRadius: 16, padding: 20,
        border: '1px solid var(--border)',
      }}>
        <h3 style={{ margin: 0 }}>🎙️ Reduced Forms</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          Your browser doesn't support speech features needed for this drill.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="reduced-forms-drill"
      style={{
        background: 'var(--card-bg, white)', borderRadius: 16, padding: 20,
        border: '1px solid var(--border)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: '1.3rem' }}>🎙️</span>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Reduced Forms</h3>
        {started && !done && (
          <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {idx + 1} / {items.length}
          </span>
        )}
      </div>

      {!started && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 12 }}>
            Hear connected speech (gonna, wanna, lemme…), expand it, then shadow the reduction.
          </p>
          <button
            data-testid="rf-start"
            onClick={loadRound}
            disabled={loading}
            style={{
              padding: '10px 24px', borderRadius: 8, cursor: 'pointer',
              border: 'none', background: 'var(--primary)', color: 'white',
              fontWeight: 600, opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Loading…' : 'Start Round'}
          </button>
          {error && <p style={{ color: '#ef4444', fontSize: '0.85rem' }}>{error}</p>}
        </div>
      )}

      {started && !done && current && (
        <div>
          {/* Progress dots */}
          <div data-testid="rf-progress" style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {items.map((_, i) => (
              <span
                key={i}
                style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: i < idx ? 'var(--primary)' : i === idx ? 'var(--primary)' : 'var(--border, #d1d5db)',
                  opacity: i === idx ? 1 : i < idx ? 0.6 : 0.4,
                }}
              />
            ))}
          </div>

          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
            type: <strong>{current.reduction_type}</strong> · step: <strong>{step}</strong>
          </div>

          {step === 'listen' && (
            <div data-testid="rf-step-listen">
              <button
                onClick={handleListen}
                data-testid="rf-play"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                  borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)',
                  background: 'var(--bg)', color: 'var(--text)', marginBottom: 10,
                }}
              >
                <Volume2 size={16} /> Listen
              </button>
              <button
                data-testid="rf-to-expand"
                onClick={() => setStep('expand')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                  borderRadius: 8, cursor: 'pointer', border: 'none',
                  background: 'var(--primary)', color: 'white', fontWeight: 600,
                }}
              >
                Got it <ChevronRight size={16} />
              </button>
            </div>
          )}

          {step === 'expand' && (
            <div data-testid="rf-step-expand">
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 0 }}>
                Type the full / written form of what you just heard.
              </p>
              <input
                data-testid="rf-expand-input"
                type="text"
                value={expandInput}
                onChange={e => setExpandInput(e.target.value)}
                placeholder="e.g. I am going to grab a coffee..."
                style={{
                  width: '100%', padding: '8px 10px', borderRadius: 6,
                  border: '1px solid var(--border, #d1d5db)', marginBottom: 8,
                  background: 'var(--bg)', color: 'var(--text)',
                }}
              />
              {expandResult === null ? (
                <button
                  data-testid="rf-expand-check"
                  onClick={handleSubmitExpand}
                  disabled={!expandInput.trim()}
                  style={{
                    padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
                    border: 'none', background: 'var(--primary)', color: 'white',
                    fontWeight: 600, opacity: expandInput.trim() ? 1 : 0.5,
                  }}
                >
                  Check
                </button>
              ) : (
                <div>
                  <div style={{
                    padding: 10, borderRadius: 8,
                    background: expandResult ? 'var(--success-bg, #d1fae5)' : 'var(--error-bg, #fee2e2)',
                    color: expandResult ? '#065f46' : '#991b1b',
                    marginBottom: 8, fontSize: '0.9rem',
                  }}>
                    {expandResult ? '✅ Correct!' : '❌ Not quite.'}
                    <div style={{ fontSize: '0.8rem', marginTop: 4 }}>
                      Full form: <em>{current.full_text}</em>
                    </div>
                  </div>
                  <button
                    data-testid="rf-to-shadow"
                    onClick={handleAdvanceFromExpand}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                      borderRadius: 8, cursor: 'pointer', border: 'none',
                      background: 'var(--primary)', color: 'white', fontWeight: 600,
                    }}
                  >
                    Shadow it <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 'shadow' && (
            <div data-testid="rf-step-shadow">
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 0 }}>
                Now record yourself saying the <strong>reduced</strong> version naturally:
              </p>
              <p style={{ fontStyle: 'italic', color: 'var(--text)', margin: '4px 0 12px' }}>
                "{current.reduced_text}"
              </p>
              <button
                data-testid="rf-record"
                onClick={handleRecord}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                  borderRadius: 8, cursor: 'pointer', border: 'none',
                  background: speech.isListening ? '#ef4444' : 'var(--primary)',
                  color: 'white', fontWeight: 600,
                }}
              >
                <Mic size={16} /> {speech.isListening ? 'Stop' : 'Record'}
              </button>
              {speech.isListening && (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 6 }}>
                  🎙️ {speech.interimTranscript || speech.transcript || 'Listening…'}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {done && (
        <div data-testid="rf-summary">
          <h4 style={{ margin: '4px 0 8px' }}>Round complete!</h4>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: 0 }}>
            Overall: <strong>{overallAccuracy}%</strong>
          </p>
          <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: '0.85rem' }}>
            {results.map((r, i) => (
              <li key={i}>
                <code>{r.reductionType}</code> — expand {r.expandCorrect ? '✅' : '❌'}, shadow {r.shadowAccuracy}%
              </li>
            ))}
          </ul>
          <button
            data-testid="rf-restart"
            onClick={loadRound}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
              borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)',
              background: 'var(--bg)', color: 'var(--text)',
            }}
          >
            <RefreshCw size={14} /> New Round
          </button>
        </div>
      )}
    </div>
  );
}
