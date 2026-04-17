import { useState, useCallback, useEffect, useRef } from 'react';
import { Zap, Mic, Square, RefreshCw, ChevronRight } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import {
  getRapidFireQuestions,
  evaluateRapidFire,
  type RapidFireQuestionsResponse,
  type RapidFireEvaluateResponse,
  type RapidFireResponseItem,
} from '../api';

type Phase = 'idle' | 'listening' | 'answering' | 'evaluating' | 'done';

const QUESTION_COUNT = 5;
const SECONDS_PER_QUESTION = 8;

interface CollectedResponse {
  question: string;
  transcript: string;
  duration_seconds: number;
}

export default function QuickRapidFireCard() {
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });
  const tts = useSpeechSynthesis();

  const [data, setData] = useState<RapidFireQuestionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [currentQ, setCurrentQ] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(SECONDS_PER_QUESTION);
  const [responses, setResponses] = useState<CollectedResponse[]>([]);
  const [result, setResult] = useState<RapidFireEvaluateResponse | null>(null);
  const [initialized, setInitialized] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const responsesRef = useRef<CollectedResponse[]>([]);
  const currentQRef = useRef(0);
  const dataRef = useRef<RapidFireQuestionsResponse | null>(null);
  const phaseRef = useRef<Phase>('idle');

  // Keep refs in sync
  useEffect(() => { responsesRef.current = responses; }, [responses]);
  useEffect(() => { currentQRef.current = currentQ; }, [currentQ]);
  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const fetchQuestions = useCallback(async () => {
    setLoading(true);
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const res = await getRapidFireQuestions(difficulty);
      setData(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      fetchQuestions();
    }
  }, [initialized, fetchQuestions]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'quick-practice-difficulty') {
        setPhase('idle');
        setResult(null);
        setResponses([]);
        setCurrentQ(0);
        fetchQuestions();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [fetchQuestions]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const doEvaluate = useCallback(async (collected: CollectedResponse[]) => {
    setPhase('evaluating');
    const d = dataRef.current;
    if (!d || collected.length === 0) {
      setPhase('idle');
      return;
    }
    try {
      const questions = collected.map(r => r.question);
      const apiResponses: RapidFireResponseItem[] = collected.map(r => ({
        question: r.question,
        transcript: r.transcript || '',
        duration_seconds: r.duration_seconds,
      }));
      const evalResult = await evaluateRapidFire(questions, apiResponses);
      setResult(evalResult);
      setPhase('done');
    } catch {
      setPhase('idle');
    }
  }, []);

  const captureAndAdvance = useCallback(() => {
    stopTimer();
    speech.stop();
    const elapsed = Math.max(0.5, (Date.now() - startTimeRef.current) / 1000);
    const transcript = speech.transcript || speech.interimTranscript || '';
    const d = dataRef.current;
    const qi = currentQRef.current;

    if (!d) return;

    const newResponse: CollectedResponse = {
      question: d.questions[qi]?.question ?? '',
      transcript,
      duration_seconds: Math.round(elapsed * 10) / 10,
    };

    const updated = [...responsesRef.current, newResponse];
    setResponses(updated);

    const nextQ = qi + 1;
    if (nextQ >= QUESTION_COUNT || nextQ >= d.questions.length) {
      // All done — evaluate
      doEvaluate(updated);
    } else {
      // Next question: read it via TTS, then record
      setCurrentQ(nextQ);
      speech.reset();
      setPhase('listening');
      tts.speak(d.questions[nextQ].question);
    }
  }, [speech, tts, stopTimer, doEvaluate]);

  const startAnswering = useCallback(() => {
    setSecondsLeft(SECONDS_PER_QUESTION);
    startTimeRef.current = Date.now();
    setPhase('answering');
    speech.reset();
    speech.start();

    timerRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          captureAndAdvance();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [speech, captureAndAdvance]);

  // When TTS finishes during 'listening' phase, transition to answering
  useEffect(() => {
    if (phase === 'listening' && !tts.isSpeaking) {
      const timeout = setTimeout(() => {
        if (phaseRef.current === 'listening') {
          startAnswering();
        }
      }, 400);
      return () => clearTimeout(timeout);
    }
  }, [phase, tts.isSpeaking, startAnswering]);

  const handleStart = useCallback(() => {
    if (!data || data.questions.length === 0) return;
    setResponses([]);
    setCurrentQ(0);
    setResult(null);
    speech.reset();
    setPhase('listening');
    tts.speak(data.questions[0].question);
  }, [data, speech, tts]);

  const handleSkip = useCallback(() => {
    captureAndAdvance();
  }, [captureAndAdvance]);

  const handleNewDrill = useCallback(() => {
    stopTimer();
    speech.stop();
    speech.reset();
    setPhase('idle');
    setResult(null);
    setResponses([]);
    setCurrentQ(0);
    fetchQuestions();
  }, [fetchQuestions, speech, stopTimer]);

  useEffect(() => {
    return () => stopTimer();
  }, [stopTimer]);

  if (!speech.isSupported || !tts.isSupported) return null;

  const scoreColor = (s: number) => s >= 7 ? '#22c55e' : s >= 5 ? '#f59e0b' : '#ef4444';

  const progressPct = phase === 'done' ? 100 : ((currentQ + (phase === 'answering' ? 0.5 : 0)) / QUESTION_COUNT) * 100;

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Zap size={20} color="#f59e0b" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Rapid-Fire Q&amp;A</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading questions…</p>
      ) : !data ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No questions available.</p>
      ) : phase === 'idle' ? (
        <div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
            Answer 5 rapid questions in a row — {SECONDS_PER_QUESTION}s each! Train your conversational reflexes.
          </p>
          <button onClick={handleStart} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Zap size={16} /> Start Rapid-Fire
          </button>
        </div>
      ) : phase === 'listening' ? (
        <div>
          {/* Progress bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
              Q{currentQ + 1}/{QUESTION_COUNT}
            </span>
            <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3 }}>
              <div style={{ width: `${progressPct}%`, height: '100%', background: '#f59e0b', borderRadius: 3, transition: 'width 0.3s' }} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'pulse 1.5s infinite',
            }}>
              <Zap size={18} color="white" />
            </div>
            <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>
              Listening to question…
            </span>
          </div>
          {data.questions[currentQ] && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontStyle: 'italic' }}>
              Topic: {data.questions[currentQ].topic_hint}
            </p>
          )}
        </div>
      ) : phase === 'answering' ? (
        <div>
          {/* Progress bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
              Q{currentQ + 1}/{QUESTION_COUNT}
            </span>
            <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3 }}>
              <div style={{ width: `${progressPct}%`, height: '100%', background: '#f59e0b', borderRadius: 3, transition: 'width 0.3s' }} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center',
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
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={handleSkip} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <ChevronRight size={14} /> Skip
            </button>
            <button onClick={captureAndAdvance} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Square size={14} /> Done
            </button>
          </div>
        </div>
      ) : phase === 'evaluating' ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3 }}>
              <div style={{ width: '100%', height: '100%', background: '#f59e0b', borderRadius: 3 }} />
            </div>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Evaluating all responses…</p>
        </div>
      ) : (
        /* done phase */
        <div>
          {/* Overall scores */}
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Overall', score: result?.overall_score ?? 0 },
              { label: 'Speed', score: result?.overall_response_speed_score ?? 0 },
              { label: 'Fluency', score: result?.overall_fluency_score ?? 0 },
            ].map(({ label, score }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: scoreColor(score) }}>{score}/10</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Summary */}
          {result?.summary_feedback && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>
              {result.summary_feedback}
            </p>
          )}

          {/* Per-question results */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
            {result?.per_question.map((pq, i) => (
              <div key={i} style={{
                padding: '0.5rem',
                background: 'var(--bg-secondary)',
                borderRadius: 6,
              }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)', marginBottom: '0.25rem' }}>
                  Q{i + 1}: {responses[i]?.question ?? ''}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                  Your answer: <em>"{responses[i]?.transcript || '(no response)'}"</em>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                  <span style={{ color: scoreColor(pq.relevance_score) }}>Rel: {pq.relevance_score}</span>
                  <span style={{ color: scoreColor(pq.grammar_score) }}>Gram: {pq.grammar_score}</span>
                  <span style={{ color: scoreColor(pq.fluency_score) }}>Flu: {pq.fluency_score}</span>
                </div>
                {pq.feedback && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{pq.feedback}</div>
                )}
                {pq.model_answer && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic', marginTop: '0.15rem' }}>
                    Example: "{pq.model_answer}"
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => { setResult(null); setResponses([]); setCurrentQ(0); setPhase('idle'); }} className="btn btn-secondary">
              Try Again
            </button>
            <button onClick={handleNewDrill} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <RefreshCw size={14} /> New Questions
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
