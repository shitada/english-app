import { useState, useCallback, useEffect, useRef } from 'react';
import { Mic, MicOff, RotateCcw, Volume2 } from 'lucide-react';
import { getSentenceTransformExercises, evaluateSentenceTransform } from '../../api';
import type { SentenceTransformExercise, SentenceTransformEvaluation } from '../../api';

interface Props {
  speechRecognition: {
    isListening: boolean;
    transcript: string;
    startListening: () => void;
    stopListening: () => void;
  };
}

interface DrillResult {
  exercise: SentenceTransformExercise;
  userResponse: string;
  evaluation: SentenceTransformEvaluation;
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

export function SentenceTransformDrill({ speechRecognition }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [exercises, setExercises] = useState<SentenceTransformExercise[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [error, setError] = useState('');
  const [results, setResults] = useState<DrillResult[]>([]);
  const [currentEval, setCurrentEval] = useState<SentenceTransformEvaluation | null>(null);
  const [timer, setTimer] = useState(RECORD_LIMIT);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadExercises = useCallback(async () => {
    setPhase('loading');
    setError('');
    try {
      const data = await getSentenceTransformExercises('intermediate', 5);
      setExercises(data.exercises);
      setCurrentIndex(0);
      setResults([]);
      setPhase('prompt');
    } catch {
      setError('Failed to load exercises. Please try again.');
      setPhase('prompt');
    }
  }, []);

  useEffect(() => { loadExercises(); }, [loadExercises]);

  const startRecording = useCallback(() => {
    setTimer(RECORD_LIMIT);
    speechRecognition.startListening();
    setPhase('recording');
    timerRef.current = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) {
          speechRecognition.stopListening();
          clearInterval(timerRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [speechRecognition]);

  const stopRecording = useCallback(() => {
    speechRecognition.stopListening();
    if (timerRef.current) clearInterval(timerRef.current);
  }, [speechRecognition]);

  // Auto-evaluate when recording stops with transcript
  useEffect(() => {
    if (phase === 'recording' && !speechRecognition.isListening && speechRecognition.transcript) {
      const exercise = exercises[currentIndex];
      const userResponse = speechRecognition.transcript;
      setPhase('evaluating');

      evaluateSentenceTransform({
        original_sentence: exercise.original_sentence,
        transformation_type: exercise.transformation_type,
        expected_answer: exercise.expected_answer,
        user_response: userResponse,
      }).then(evalResult => {
        setCurrentEval(evalResult);
        setResults(prev => [...prev, { exercise, userResponse, evaluation: evalResult }]);
        setPhase('result');
      }).catch(() => {
        setError('Evaluation failed. Moving to next.');
        setPhase('result');
      });
    }
  }, [speechRecognition.isListening, speechRecognition.transcript, phase, exercises, currentIndex]);

  const nextExercise = useCallback(() => {
    setCurrentEval(null);
    setError('');
    if (currentIndex < exercises.length - 1) {
      setCurrentIndex(i => i + 1);
      setPhase('prompt');
    } else {
      setPhase('summary');
    }
  }, [currentIndex, exercises.length]);

  const current = exercises[currentIndex];

  if (phase === 'loading') {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div className="spinner" style={{ margin: '0 auto 12px' }} />
        <p style={{ color: 'var(--text-secondary)' }}>Generating transformation exercises…</p>
      </div>
    );
  }

  if (phase === 'summary') {
    const avgGrammar = results.length ? results.reduce((s, r) => s + r.evaluation.grammar_score, 0) / results.length : 0;
    const avgTransform = results.length ? results.reduce((s, r) => s + r.evaluation.transformation_score, 0) / results.length : 0;
    const avgNatural = results.length ? results.reduce((s, r) => s + r.evaluation.naturalness_score, 0) / results.length : 0;
    const avgOverall = results.length ? results.reduce((s, r) => s + r.evaluation.overall_score, 0) / results.length : 0;

    return (
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <h3 style={{ textAlign: 'center', marginBottom: 16 }}>🔄 Transform Drill — Summary</h3>
        <div style={{ background: 'var(--card-bg, #fff)', borderRadius: 12, padding: 20, border: '1px solid var(--border)', marginBottom: 16 }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 48, fontWeight: 700, color: avgOverall >= 7 ? 'var(--success)' : avgOverall >= 5 ? 'var(--warning)' : 'var(--danger)' }}>
              {avgOverall.toFixed(1)}
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Average Score</div>
          </div>
          <ScoreBar label="Grammar" score={avgGrammar} />
          <ScoreBar label="Transformation" score={avgTransform} />
          <ScoreBar label="Naturalness" score={avgNatural} />
        </div>

        {results.map((r, i) => (
          <div key={i} style={{ background: 'var(--card-bg)', borderRadius: 10, padding: 14, border: '1px solid var(--border)', marginBottom: 10 }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
              #{i + 1} · {r.exercise.transformation_type}
            </div>
            <div style={{ fontSize: 14, marginBottom: 4 }}>
              <strong>Original:</strong> {r.exercise.original_sentence}
            </div>
            <div style={{ fontSize: 14, marginBottom: 4, color: 'var(--text-secondary)' }}>
              You said: "{r.userResponse}"
            </div>
            <div style={{ fontSize: 14, color: 'var(--success, #22c55e)' }}>
              ✓ {r.evaluation.correct_version}
            </div>
            <div style={{ textAlign: 'right', fontWeight: 600, color: r.evaluation.overall_score >= 7 ? 'var(--success)' : 'var(--warning)' }}>
              {r.evaluation.overall_score.toFixed(1)}/10
            </div>
          </div>
        ))}

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button className="btn btn-primary" onClick={loadExercises} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <RotateCcw size={16} /> Practice Again
          </button>
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <p style={{ color: 'var(--text-secondary)' }}>No exercises available.</p>
        <button className="btn btn-primary" onClick={loadExercises}>Try Again</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>🔄 Sentence Transform</h3>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {currentIndex + 1} / {exercises.length}
        </span>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', background: '#fef2f2', color: '#b91c1c', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ background: 'var(--card-bg, #fff)', borderRadius: 12, padding: 20, border: '1px solid var(--border)', marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ padding: '2px 8px', borderRadius: 12, background: 'rgba(99,102,241,0.1)', color: 'var(--primary)', fontSize: 12, fontWeight: 600 }}>
            {current.transformation_type}
          </span>
        </div>

        <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 12, lineHeight: 1.4 }}>
          "{current.original_sentence}"
        </div>

        <div style={{ fontSize: 15, color: 'var(--primary, #6366f1)', fontWeight: 500, padding: '10px 14px', background: 'rgba(99,102,241,0.06)', borderRadius: 8, border: '1px solid rgba(99,102,241,0.15)' }}>
          📝 {current.instruction}
        </div>
      </div>

      {phase === 'prompt' && (
        <div style={{ textAlign: 'center' }}>
          <button className="btn btn-primary" onClick={startRecording} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 28px', fontSize: 16 }}>
            <Mic size={20} /> Speak Your Answer
          </button>
        </div>
      )}

      {phase === 'recording' && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 700, color: timer <= 5 ? 'var(--danger)' : 'var(--text)', marginBottom: 12 }}>
            {timer}s
          </div>
          <button className="btn btn-danger" onClick={stopRecording} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 28px' }}>
            <MicOff size={20} /> Stop
          </button>
          {speechRecognition.transcript && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 14, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              "{speechRecognition.transcript}"
            </div>
          )}
        </div>
      )}

      {phase === 'evaluating' && (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Evaluating your transformation…</p>
        </div>
      )}

      {phase === 'result' && currentEval && (
        <div>
          <div style={{ background: 'var(--card-bg)', borderRadius: 12, padding: 16, border: '1px solid var(--border)', marginBottom: 12 }}>
            <ScoreBar label="Grammar" score={currentEval.grammar_score} />
            <ScoreBar label="Transformation" score={currentEval.transformation_score} />
            <ScoreBar label="Naturalness" score={currentEval.naturalness_score} />
            <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: currentEval.overall_score >= 7 ? 'rgba(34,197,94,0.1)' : 'rgba(234,179,8,0.1)', textAlign: 'center', fontWeight: 600, fontSize: 18 }}>
              Overall: {currentEval.overall_score.toFixed(1)}/10
            </div>
          </div>

          {currentEval.feedback && (
            <div style={{ padding: '10px 14px', background: 'rgba(99,102,241,0.06)', borderRadius: 8, fontSize: 14, marginBottom: 12, border: '1px solid rgba(99,102,241,0.15)' }}>
              💡 {currentEval.feedback}
            </div>
          )}

          <div style={{ padding: '10px 14px', background: 'rgba(34,197,94,0.06)', borderRadius: 8, fontSize: 14, marginBottom: 16, border: '1px solid rgba(34,197,94,0.15)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Correct version:</div>
            <div style={{ fontWeight: 500, color: 'var(--success, #22c55e)' }}>✓ {currentEval.correct_version}</div>
          </div>

          <div style={{ textAlign: 'center' }}>
            <button className="btn btn-primary" onClick={nextExercise} style={{ padding: '10px 24px' }}>
              {currentIndex < exercises.length - 1 ? 'Next Exercise →' : 'View Summary'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
