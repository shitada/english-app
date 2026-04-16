import { useState, useCallback, useEffect, useRef } from 'react';
import { Users, Mic, RefreshCw, Square } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { getRolePlayScenario, evaluateRolePlay, type RolePlayScenarioResponse, type RolePlayEvaluateResponse } from '../api';

const MAX_SECONDS = 15;

type Phase = 'idle' | 'exchange_1_listen' | 'exchange_1_speak' | 'exchange_2_listen' | 'exchange_2_speak' | 'evaluating' | 'done';

export default function QuickRolePlayCard() {
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });

  const [scenario, setScenario] = useState<RolePlayScenarioResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<RolePlayEvaluateResponse | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(MAX_SECONDS);
  const [initialized, setInitialized] = useState(false);
  const [userResponses, setUserResponses] = useState<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const totalStartRef = useRef<number>(0);

  const fetchScenario = useCallback(async () => {
    setLoading(true);
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const res = await getRolePlayScenario(difficulty);
      setScenario(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      fetchScenario();
    }
  }, [initialized, fetchScenario]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'quick-practice-difficulty') {
        setPhase('idle');
        setResult(null);
        setUserResponses([]);
        fetchScenario();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [fetchScenario]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const playTTS = useCallback((text: string, onEnd: () => void) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    utterance.onend = onEnd;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, []);

  const startSpeakingPhase = useCallback(async () => {
    speech.reset();
    setSecondsLeft(MAX_SECONDS);
    startTimeRef.current = Date.now();
    await speech.start();
  }, [speech]);

  const handleFinishSpeaking = useCallback(async (exchangeIndex: number) => {
    stopTimer();
    speech.stop();

    const transcript = speech.transcript || speech.interimTranscript || '';
    if (!transcript.trim()) {
      setPhase('idle');
      return;
    }

    const newResponses = [...userResponses, transcript];
    setUserResponses(newResponses);

    if (exchangeIndex === 0 && scenario?.exchanges[1]) {
      setPhase('exchange_2_listen');
      playTTS(scenario.exchanges[1].partner_says, () => {
        setPhase('exchange_2_speak');
        startSpeakingPhase();
        timerRef.current = setInterval(() => {
          setSecondsLeft(prev => {
            if (prev <= 1) {
              handleFinishRef.current(1);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      });
    } else {
      setPhase('evaluating');
      if (!scenario) return;
      const elapsed = Math.max(1, Math.round((Date.now() - totalStartRef.current) / 1000));
      const exchanges = scenario.exchanges.map((ex, i) => ({
        partner_says: ex.partner_says,
        user_says: newResponses[i] || '',
      }));
      try {
        const res = await evaluateRolePlay(
          scenario.scenario, scenario.your_role, scenario.partner_role, exchanges, elapsed
        );
        setResult(res);
        setPhase('done');
      } catch {
        setPhase('idle');
      }
    }
  }, [scenario, speech, stopTimer, userResponses, playTTS, startSpeakingPhase]);

  const handleFinishRef = useRef(handleFinishSpeaking);
  handleFinishRef.current = handleFinishSpeaking;

  const handleStart = useCallback(() => {
    if (!scenario) return;
    setUserResponses([]);
    totalStartRef.current = Date.now();
    setPhase('exchange_1_listen');
    playTTS(scenario.exchanges[0].partner_says, () => {
      setPhase('exchange_1_speak');
      startSpeakingPhase();
      timerRef.current = setInterval(() => {
        setSecondsLeft(prev => {
          if (prev <= 1) {
            handleFinishRef.current(0);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    });
  }, [scenario, playTTS, startSpeakingPhase]);

  const handleNewScenario = useCallback(() => {
    window.speechSynthesis.cancel();
    setPhase('idle');
    setResult(null);
    setUserResponses([]);
    speech.reset();
    fetchScenario();
  }, [fetchScenario, speech]);

  useEffect(() => {
    return () => { stopTimer(); window.speechSynthesis.cancel(); };
  }, [stopTimer]);

  if (!speech.isSupported) return null;

  const scoreColor = (s: number) => s >= 7 ? '#22c55e' : s >= 5 ? '#f59e0b' : '#ef4444';
  const isListening = phase === 'exchange_1_listen' || phase === 'exchange_2_listen';
  const isSpeaking = phase === 'exchange_1_speak' || phase === 'exchange_2_speak';
  const exchangeNum = phase.includes('2') ? 2 : 1;

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Users size={20} color="#6366f1" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Role-Play</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading scenario…</p>
      ) : !scenario ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No scenario available.</p>
      ) : phase === 'idle' ? (
        <div>
          <p style={{ color: 'var(--text)', fontSize: '0.95rem', margin: '0 0 0.25rem', fontWeight: 700 }}>
            🎭 {scenario.scenario}
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 0.25rem' }}>
            You are: <strong>{scenario.your_role}</strong> · Partner: <strong>{scenario.partner_role}</strong>
          </p>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', margin: '0.5rem 0' }}>
            {scenario.key_phrases.map((p) => (
              <span key={p} style={{
                background: 'var(--bg-secondary, #f3f4f6)', color: 'var(--text-secondary)',
                borderRadius: '1rem', padding: '0.2rem 0.5rem', fontSize: '0.75rem',
              }}>
                💡 {p}
              </span>
            ))}
          </div>
          <button onClick={handleStart} className="btn btn-primary" style={{ width: '100%' }}>
            <Mic size={16} /> Start Role-Play (2 exchanges)
          </button>
        </div>
      ) : isListening ? (
        <div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 0.25rem' }}>
            Exchange {exchangeNum}/2 — {scenario.partner_role} is speaking…
          </p>
          <div style={{
            background: 'var(--bg-secondary, #f3f4f6)', borderRadius: '0.5rem',
            padding: '0.5rem 0.75rem', marginBottom: '0.5rem',
            borderLeft: '3px solid #6366f1',
          }}>
            <p style={{ fontSize: '0.9rem', color: 'var(--text)', margin: 0 }}>
              🗣️ "{scenario.exchanges[exchangeNum - 1].partner_says}"
            </p>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontStyle: 'italic' }}>
            Listening… Your turn is next.
          </p>
        </div>
      ) : isSpeaking ? (
        <div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 0.25rem' }}>
            Exchange {exchangeNum}/2 — Your turn!
          </p>
          <div style={{
            background: 'var(--bg-secondary, #f3f4f6)', borderRadius: '0.5rem',
            padding: '0.5rem 0.75rem', marginBottom: '0.5rem',
            borderLeft: '3px solid #6366f1', opacity: 0.7,
          }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text)', margin: 0 }}>
              {scenario.partner_role}: "{scenario.exchanges[exchangeNum - 1].partner_says}"
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center',
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
          <button onClick={() => handleFinishRef.current(exchangeNum - 1)} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Square size={14} /> Done
          </button>
        </div>
      ) : phase === 'evaluating' ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Evaluating your conversation…</p>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Appropriate', score: result?.appropriateness_score ?? 0 },
              { label: 'Grammar', score: result?.grammar_score ?? 0 },
              { label: 'Fluency', score: result?.fluency_score ?? 0 },
              { label: 'Vocab', score: result?.vocabulary_score ?? 0 },
              { label: 'Overall', score: result?.overall_score ?? 0 },
            ].map(({ label, score }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: scoreColor(score) }}>{score}/10</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{label}</div>
              </div>
            ))}
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
            {result?.feedback}
          </p>
          {result?.model_responses && result.model_responses.length > 0 && (
            <div style={{
              background: 'var(--bg-secondary, #f9fafb)', borderRadius: '0.5rem',
              padding: '0.5rem 0.75rem', marginBottom: '0.75rem',
              borderLeft: '3px solid #6366f1',
            }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                Model Responses
              </p>
              {result.model_responses.map((r, i) => (
                <p key={i} style={{ fontSize: '0.85rem', color: 'var(--text)', margin: '0.25rem 0' }}>
                  {i + 1}. {r}
                </p>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => { setResult(null); setUserResponses([]); setPhase('idle'); }} className="btn btn-secondary">
              Try Again
            </button>
            <button onClick={handleNewScenario} className="btn btn-primary">
              <RefreshCw size={14} /> New Scenario
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
