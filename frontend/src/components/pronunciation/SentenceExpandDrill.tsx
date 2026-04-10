import { useState, useCallback, useEffect, useRef } from 'react';
import { Mic, MicOff, RotateCcw } from 'lucide-react';
import { getSentenceExpandSeeds, evaluateSentenceExpand } from '../../api';
import type { SentenceExpandSeed, SentenceExpandEvaluation } from '../../api';

interface Props {
  speechRecognition: {
    isListening: boolean;
    transcript: string;
    startListening: () => void;
    stopListening: () => void;
  };
}

interface DrillResult {
  seed: SentenceExpandSeed;
  expanded: string;
  evaluation: SentenceExpandEvaluation;
}

type Phase = 'loading' | 'prompt' | 'speaking' | 'evaluating' | 'result' | 'summary';

const RECORD_LIMIT = 20;

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

export function SentenceExpandDrill({ speechRecognition }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [seeds, setSeeds] = useState<SentenceExpandSeed[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [error, setError] = useState('');
  const [results, setResults] = useState<DrillResult[]>([]);
  const [currentEval, setCurrentEval] = useState<SentenceExpandEvaluation | null>(null);
  const [timer, setTimer] = useState(RECORD_LIMIT);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadSeeds = useCallback(async () => {
    setPhase('loading');
    setError('');
    try {
      const data = await getSentenceExpandSeeds('intermediate', 5);
      setSeeds(data.seeds);
      setCurrentIndex(0);
      setResults([]);
      setPhase('prompt');
    } catch {
      setError('Failed to load seeds.');
    }
  }, []);

  useEffect(() => { loadSeeds(); }, [loadSeeds]);

  const startRecording = useCallback(() => {
    setTimer(RECORD_LIMIT);
    speechRecognition.startListening();
    setPhase('speaking');
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

    const seed = seeds[currentIndex];
    const expanded = speechRecognition.transcript || seed.seed;
    try {
      const evaluation = await evaluateSentenceExpand({ seed: seed.seed, expanded });
      setCurrentEval(evaluation);
      setResults(prev => [...prev, { seed, expanded, evaluation }]);
      setPhase('result');
    } catch {
      setError('Evaluation failed.');
      setPhase('prompt');
    }
  }, [speechRecognition, seeds, currentIndex]);

  useEffect(() => {
    if (phase === 'speaking' && timer === 0 && speechRecognition.transcript) {
      stopAndEvaluate();
    }
  }, [timer, phase, speechRecognition.transcript, stopAndEvaluate]);

  const handleNext = useCallback(() => {
    setCurrentEval(null);
    if (currentIndex < seeds.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setPhase('prompt');
    } else {
      setPhase('summary');
    }
  }, [currentIndex, seeds.length]);

  const currentSeed = seeds[currentIndex];

  if (phase === 'loading') {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 32 }}>
        {error ? (
          <>
            <p style={{ color: 'var(--danger)' }}>{error}</p>
            <button className="btn btn-primary" onClick={loadSeeds}>Retry</button>
          </>
        ) : (
          <p>Loading seeds…</p>
        )}
      </div>
    );
  }

  if (phase === 'summary') {
    const avgScore = results.length > 0
      ? results.reduce((s, r) => s + r.evaluation.overall_score, 0) / results.length
      : 0;
    const totalWordsAdded = results.reduce((s, r) => s + r.evaluation.word_count_added, 0);
    return (
      <div className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
        <h3 style={{ marginBottom: 16 }}>📝 Expansion Complete!</h3>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 32, marginBottom: 20 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: avgScore >= 7 ? 'var(--success)' : avgScore >= 5 ? 'var(--warning)' : 'var(--danger)' }}>
              {avgScore.toFixed(1)}/10
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Average Score</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--primary)' }}>+{totalWordsAdded}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Words Added</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {results.map((r, i) => (
            <div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--bg-secondary, #f9fafb)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>"{r.seed.seed}"</span>
                <span style={{ fontWeight: 600, color: r.evaluation.overall_score >= 7 ? 'var(--success)' : r.evaluation.overall_score >= 5 ? 'var(--warning)' : 'var(--danger)' }}>
                  {r.evaluation.overall_score.toFixed(1)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>→ "{r.expanded}" (+{r.evaluation.word_count_added} words)</div>
            </div>
          ))}
        </div>
        <button className="btn btn-primary" onClick={loadSeeds} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <RotateCcw size={16} /> New Drill
        </button>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>📝 Sentence Expand</h3>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{currentIndex + 1}/{seeds.length}</span>
      </div>

      <div style={{ padding: 20, background: 'var(--bg-secondary, #f9fafb)', borderRadius: 12, marginBottom: 16, textAlign: 'center', border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>Expand this sentence:</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
          "{currentSeed?.seed}"
        </div>
        <div style={{ fontSize: 13, color: 'var(--primary)', fontStyle: 'italic' }}>
          💡 {currentSeed?.context}
        </div>
      </div>

      {phase === 'prompt' && (
        <button className="btn btn-primary" onClick={startRecording} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Mic size={18} /> Speak Your Expansion ({RECORD_LIMIT}s)
        </button>
      )}

      {phase === 'speaking' && (
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
        <div style={{ textAlign: 'center', padding: 16 }}><p>Evaluating…</p></div>
      )}

      {phase === 'result' && currentEval && (
        <div>
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--primary)' }}>+{currentEval.word_count_added} words added</span>
          </div>
          <ScoreBar label="Grammar" score={currentEval.grammar_score} />
          <ScoreBar label="Creativity" score={currentEval.creativity_score} />
          <ScoreBar label="Complexity" score={currentEval.complexity_score} />
          <ScoreBar label="Overall" score={currentEval.overall_score} />
          {currentEval.feedback && (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 12 }}>{currentEval.feedback}</p>
          )}
          {currentEval.model_expansion && (
            <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)', marginBottom: 4 }}>Model Expansion:</div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)' }}>"{currentEval.model_expansion}"</p>
            </div>
          )}
          <button className="btn btn-primary" onClick={handleNext} style={{ width: '100%', marginTop: 16 }}>
            {currentIndex < seeds.length - 1 ? 'Next Seed →' : 'View Summary'}
          </button>
        </div>
      )}
    </div>
  );
}
