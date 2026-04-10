import { useState, useCallback, useEffect, useRef } from 'react';
import { Mic, MicOff, RotateCcw, Volume2 } from 'lucide-react';
import { getResponseDrillPrompts, evaluateResponseDrill } from '../../api';
import type { ResponseDrillPrompt, ResponseDrillEvaluation } from '../../api';

interface Props {
  speechRecognition: {
    isListening: boolean;
    transcript: string;
    startListening: () => void;
    stopListening: () => void;
  };
}

interface DrillResult {
  prompt: ResponseDrillPrompt;
  userResponse: string;
  evaluation: ResponseDrillEvaluation;
}

type Phase = 'loading' | 'prompt' | 'recording' | 'evaluating' | 'result' | 'summary';

const RECORD_LIMIT = 15;

function ScoreBar({ label, score }: { label: string; score: number }) {
  const pct = (score / 10) * 100;
  const color = score >= 7 ? 'var(--success, #22c55e)' : score >= 5 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)';
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600, color }}>{score.toFixed(1)}</span>
      </div>
      <div style={{ height: 6, background: 'var(--border, #e5e7eb)', borderRadius: 3 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

export function ResponseDrill({ speechRecognition }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [prompts, setPrompts] = useState<ResponseDrillPrompt[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [error, setError] = useState('');
  const [results, setResults] = useState<DrillResult[]>([]);
  const [currentEval, setCurrentEval] = useState<ResponseDrillEvaluation | null>(null);
  const [timer, setTimer] = useState(RECORD_LIMIT);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadPrompts = useCallback(async () => {
    setPhase('loading');
    setError('');
    try {
      const data = await getResponseDrillPrompts('intermediate', 6);
      setPrompts(data.prompts);
      setCurrentIndex(0);
      setResults([]);
      setPhase('prompt');
    } catch {
      setError('Failed to load prompts.');
      setPhase('loading');
    }
  }, []);

  useEffect(() => { loadPrompts(); }, [loadPrompts]);

  const speak = useCallback((text: string) => {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  }, []);

  const startRecording = useCallback(() => {
    setTimer(RECORD_LIMIT);
    speechRecognition.startListening();
    setPhase('recording');
    timerRef.current = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) {
          speechRecognition.stopListening();
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [speechRecognition]);

  const stopAndEvaluate = useCallback(async () => {
    speechRecognition.stopListening();
    if (timerRef.current) clearInterval(timerRef.current);
    setPhase('evaluating');

    const prompt = prompts[currentIndex];
    const userResponse = speechRecognition.transcript || '(no response)';
    try {
      const evaluation = await evaluateResponseDrill({
        situation: prompt.situation,
        speaker_says: prompt.speaker_says,
        user_response: userResponse,
      });
      setCurrentEval(evaluation);
      setResults(prev => [...prev, { prompt, userResponse, evaluation }]);
      setPhase('result');
    } catch {
      setError('Evaluation failed.');
      setPhase('prompt');
    }
  }, [speechRecognition, prompts, currentIndex]);

  useEffect(() => {
    if (phase === 'recording' && timer === 0 && speechRecognition.transcript) {
      stopAndEvaluate();
    }
  }, [timer, phase, speechRecognition.transcript, stopAndEvaluate]);

  const handleNext = useCallback(() => {
    setCurrentEval(null);
    if (currentIndex < prompts.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setPhase('prompt');
    } else {
      setPhase('summary');
    }
  }, [currentIndex, prompts.length]);

  const currentPrompt = prompts[currentIndex];

  if (phase === 'loading') {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 32 }}>
        {error ? (
          <>
            <p style={{ color: 'var(--danger)' }}>{error}</p>
            <button className="btn btn-primary" onClick={loadPrompts}>Retry</button>
          </>
        ) : (
          <p>Loading prompts…</p>
        )}
      </div>
    );
  }

  if (phase === 'summary') {
    const avgScore = results.length > 0
      ? results.reduce((s, r) => s + r.evaluation.overall_score, 0) / results.length
      : 0;
    return (
      <div className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
        <h3 style={{ marginBottom: 16 }}>💬 Drill Complete!</h3>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 36, fontWeight: 700, color: avgScore >= 7 ? 'var(--success)' : avgScore >= 5 ? 'var(--warning)' : 'var(--danger)' }}>
            {avgScore.toFixed(1)}/10
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Average Score</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {results.map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 8, background: 'var(--bg-secondary, #f9fafb)', border: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13 }}>{r.prompt.situation}</span>
              <span style={{ fontWeight: 600, color: r.evaluation.overall_score >= 7 ? 'var(--success)' : r.evaluation.overall_score >= 5 ? 'var(--warning)' : 'var(--danger)' }}>
                {r.evaluation.overall_score.toFixed(1)}
              </span>
            </div>
          ))}
        </div>
        <button className="btn btn-primary" onClick={loadPrompts} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <RotateCcw size={16} /> New Drill
        </button>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>💬 Response Drill</h3>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {currentIndex + 1}/{prompts.length}
        </span>
      </div>

      <div style={{ padding: 16, background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8, marginBottom: 16, border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)', marginBottom: 4, textTransform: 'uppercase' }}>
          {currentPrompt?.situation}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <button className="btn-touch" onClick={() => speak(currentPrompt?.speaker_says || '')} aria-label="Listen" style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', marginTop: 2 }}>
            <Volume2 size={16} />
          </button>
          <p style={{ margin: 0, fontSize: 15, fontStyle: 'italic', color: 'var(--text-primary)' }}>
            "{currentPrompt?.speaker_says}"
          </p>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
          Expected: {currentPrompt?.expected_response_type}
        </div>
      </div>

      {phase === 'prompt' && (
        <button className="btn btn-primary" onClick={startRecording} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Mic size={18} /> Respond ({RECORD_LIMIT}s)
        </button>
      )}

      {phase === 'recording' && (
        <div>
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 24, fontWeight: 700, color: timer <= 5 ? 'var(--danger)' : 'var(--primary)' }}>{timer}s</span>
          </div>
          {speechRecognition.transcript && (
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', fontStyle: 'italic', marginBottom: 12 }}>
              "{speechRecognition.transcript}"
            </p>
          )}
          <button className="btn btn-danger" onClick={stopAndEvaluate} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <MicOff size={18} /> Done
          </button>
        </div>
      )}

      {phase === 'evaluating' && (
        <div style={{ textAlign: 'center', padding: 16 }}>
          <p>Evaluating your response…</p>
        </div>
      )}

      {phase === 'result' && currentEval && (
        <div>
          <ScoreBar label="Appropriateness" score={currentEval.appropriateness_score} />
          <ScoreBar label="Grammar" score={currentEval.grammar_score} />
          <ScoreBar label="Naturalness" score={currentEval.naturalness_score} />
          <ScoreBar label="Overall" score={currentEval.overall_score} />
          {currentEval.feedback && (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 12 }}>{currentEval.feedback}</p>
          )}
          {currentEval.model_response && (
            <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)', marginBottom: 4 }}>Model Response:</div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <button className="btn-touch" onClick={() => speak(currentEval.model_response)} aria-label="Listen to model" style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)' }}>
                  <Volume2 size={14} />
                </button>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)' }}>"{currentEval.model_response}"</p>
              </div>
            </div>
          )}
          <button className="btn btn-primary" onClick={handleNext} style={{ width: '100%', marginTop: 16 }}>
            {currentIndex < prompts.length - 1 ? 'Next Prompt →' : 'View Summary'}
          </button>
        </div>
      )}
    </div>
  );
}
