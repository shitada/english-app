import { useState, useCallback, useEffect, useRef } from 'react';
import { BookOpen, Mic, RefreshCw, Square } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { getSummarizeRespondPrompt, evaluateSummarizeRespond, type SummarizeRespondPromptResponse, type SummarizeRespondEvaluateResponse } from '../api';

const SUMMARY_SECONDS = 15;
const RESPONSE_SECONDS = 30;

type Phase = 'idle' | 'reading' | 'recording_summary' | 'recording_response' | 'evaluating' | 'done';

export default function QuickSummarizeRespondCard() {
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });
  const tts = useSpeechSynthesis();

  const [prompt, setPrompt] = useState<SummarizeRespondPromptResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<SummarizeRespondEvaluateResponse | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(SUMMARY_SECONDS);
  const [summaryTranscript, setSummaryTranscript] = useState('');
  const [initialized, setInitialized] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const phaseRef = useRef<Phase>('idle');

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fetchPrompt = useCallback(async () => {
    setLoading(true);
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const res = await getSummarizeRespondPrompt(difficulty);
      setPrompt(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      fetchPrompt();
    }
  }, [initialized, fetchPrompt]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'quick-practice-difficulty') {
        setPhase('idle');
        setResult(null);
        setSummaryTranscript('');
        fetchPrompt();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [fetchPrompt]);

  const finishResponse = useCallback(async () => {
    stopTimer();
    speech.stop();
    setPhase('evaluating');

    const elapsed = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
    const responseText = speech.transcript || speech.interimTranscript || '';

    if (!prompt || !summaryTranscript.trim() || !responseText.trim()) {
      setPhase('idle');
      return;
    }

    try {
      const res = await evaluateSummarizeRespond({
        passage: prompt.passage,
        key_argument: prompt.key_argument,
        user_summary: summaryTranscript,
        user_response: responseText,
        duration_seconds: elapsed,
      });
      setResult(res);
      setPhase('done');
    } catch {
      setPhase('idle');
    }
  }, [prompt, summaryTranscript, speech, stopTimer]);

  const finishResponseRef = useRef(finishResponse);
  finishResponseRef.current = finishResponse;

  const startResponse = useCallback(async () => {
    speech.reset();
    setSecondsLeft(RESPONSE_SECONDS);
    setPhase('recording_response');

    await speech.start();

    timerRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          finishResponseRef.current();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [speech]);

  const finishSummary = useCallback(() => {
    stopTimer();
    speech.stop();
    const t = speech.transcript || speech.interimTranscript || '';
    setSummaryTranscript(t);

    if (!t.trim()) {
      setPhase('idle');
      return;
    }

    startResponse();
  }, [speech, stopTimer, startResponse]);

  const finishSummaryRef = useRef(finishSummary);
  finishSummaryRef.current = finishSummary;

  const handleStartReading = useCallback(() => {
    if (!prompt) return;
    setResult(null);
    setSummaryTranscript('');
    setPhase('reading');
  }, [prompt]);

  const handleStartSummary = useCallback(async () => {
    if (!prompt) return;
    speech.reset();
    setSecondsLeft(SUMMARY_SECONDS);
    startTimeRef.current = Date.now();
    setPhase('recording_summary');

    await speech.start();

    timerRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          finishSummaryRef.current();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [prompt, speech]);

  const handleNewPassage = useCallback(() => {
    stopTimer();
    tts.stop();
    speech.reset();
    setPhase('idle');
    setResult(null);
    setSummaryTranscript('');
    fetchPrompt();
  }, [fetchPrompt, speech, tts, stopTimer]);

  useEffect(() => {
    return () => {
      stopTimer();
      tts.stop();
    };
  }, [stopTimer, tts]);

  if (!speech.isSupported) return null;

  const scoreColor = (s: number) => s >= 7 ? '#22c55e' : s >= 5 ? '#f59e0b' : '#ef4444';

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <BookOpen size={20} color="#7c3aed" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Summarize & Respond</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading passage…</p>
      ) : !prompt ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No passage available.</p>
      ) : phase === 'idle' ? (
        <div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 0.25rem' }}>
            📖 Topic: <strong>{prompt.topic}</strong>
          </p>
          <div style={{
            background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8,
            padding: '0.75rem', marginBottom: '0.75rem',
            fontSize: '0.9rem', color: 'var(--text)', lineHeight: 1.6,
            borderLeft: '3px solid #7c3aed',
          }}>
            {prompt.passage}
          </div>
          <div style={{
            background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8,
            padding: '0.5rem 0.75rem', marginBottom: '0.75rem',
            fontSize: '0.8rem', color: 'var(--text-secondary)',
          }}>
            <strong>How it works:</strong> Read the passage → Summarize the main point (15s) → Give your response (30s)
          </div>
          <button onClick={handleStartReading} className="btn btn-primary" data-testid="sumresp-start-btn">
            <BookOpen size={16} /> Start Reading
          </button>
        </div>
      ) : phase === 'reading' ? (
        <div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
            padding: '0.2rem 0.5rem', borderRadius: 12,
            background: '#7c3aed18', marginBottom: '0.5rem',
          }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#7c3aed' }}>📖 Read the Passage</span>
          </div>
          <div style={{
            background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8,
            padding: '0.75rem', marginBottom: '0.75rem',
            fontSize: '0.95rem', color: 'var(--text)', lineHeight: 1.7,
            borderLeft: '3px solid #7c3aed',
          }}>
            {prompt.passage}
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 0.5rem', fontStyle: 'italic' }}>
            When ready, tap "Summarize" to record your one-sentence summary.
          </p>
          <button onClick={handleStartSummary} className="btn btn-primary" data-testid="sumresp-summarize-btn">
            <Mic size={16} /> Summarize ({SUMMARY_SECONDS}s)
          </button>
        </div>
      ) : phase === 'recording_summary' ? (
        <div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
            padding: '0.2rem 0.5rem', borderRadius: 12,
            background: '#3b82f618', marginBottom: '0.5rem',
          }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#3b82f6' }}>Phase 1 — Summarize</span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 0.5rem', fontStyle: 'italic' }}>
            Summarize the author's main point in one sentence.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'pulse 1.5s infinite',
            }}>
              <Mic size={18} color="white" />
            </div>
            <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
              {secondsLeft}s
            </span>
          </div>
          {(speech.transcript || speech.interimTranscript) && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontStyle: 'italic', margin: '0 0 0.5rem' }}>
              {speech.transcript}{speech.interimTranscript && <span style={{ opacity: 0.5 }}> {speech.interimTranscript}</span>}
            </p>
          )}
          <button onClick={finishSummary} className="btn btn-secondary" data-testid="sumresp-summary-stop-btn" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Square size={14} /> Done — Now Respond
          </button>
        </div>
      ) : phase === 'recording_response' ? (
        <div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
            padding: '0.2rem 0.5rem', borderRadius: 12,
            background: '#7c3aed18', marginBottom: '0.5rem',
          }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#7c3aed' }}>Phase 2 — Respond</span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 0.5rem', fontStyle: 'italic' }}>
            Give your own response or reaction in 2-3 sentences.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'pulse 1.5s infinite',
            }}>
              <Mic size={18} color="white" />
            </div>
            <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
              {secondsLeft}s
            </span>
          </div>
          {(speech.transcript || speech.interimTranscript) && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontStyle: 'italic', margin: '0 0 0.5rem' }}>
              {speech.transcript}{speech.interimTranscript && <span style={{ opacity: 0.5 }}> {speech.interimTranscript}</span>}
            </p>
          )}
          <button onClick={() => finishResponseRef.current()} className="btn btn-secondary" data-testid="sumresp-response-stop-btn" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Square size={14} /> Done
          </button>
        </div>
      ) : phase === 'evaluating' ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Evaluating your summary & response…</p>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Summary', score: result?.summary_accuracy_score ?? 0 },
              { label: 'Coherence', score: result?.response_coherence_score ?? 0 },
              { label: 'Grammar', score: result?.grammar_score ?? 0 },
              { label: 'Vocab', score: result?.vocabulary_score ?? 0 },
              { label: 'Overall', score: result?.overall_score ?? 0 },
            ].map(({ label, score }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: scoreColor(score) }}>{score}/10</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{label}</div>
              </div>
            ))}
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
            {result?.feedback}
          </p>
          {result?.model_summary && (
            <div style={{
              background: 'var(--bg-secondary, #f9fafb)', borderRadius: '0.5rem',
              padding: '0.5rem 0.75rem', marginBottom: '0.5rem',
              borderLeft: '3px solid #3b82f6',
            }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                Model Summary
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text)', margin: 0 }}>
                {result.model_summary}
              </p>
            </div>
          )}
          {result?.model_response && (
            <div style={{
              background: 'var(--bg-secondary, #f9fafb)', borderRadius: '0.5rem',
              padding: '0.5rem 0.75rem', marginBottom: '0.75rem',
              borderLeft: '3px solid #7c3aed',
            }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                Model Response
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text)', margin: 0 }}>
                {result.model_response}
              </p>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => { setResult(null); setSummaryTranscript(''); setPhase('idle'); }} className="btn btn-secondary">
              Try Again
            </button>
            <button onClick={handleNewPassage} className="btn btn-primary" data-testid="sumresp-next-btn">
              <RefreshCw size={14} /> New Passage
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
