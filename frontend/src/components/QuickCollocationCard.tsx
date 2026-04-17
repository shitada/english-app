import { useState, useCallback, useEffect } from 'react';
import { RefreshCw, Link2 } from 'lucide-react';
import {
  getCollocationDrill,
  evaluateCollocation,
  type CollocationExercise,
  type CollocationEvaluateResponse,
} from '../api';

interface AnswerRecord {
  exercise: CollocationExercise;
  userChoice: string;
  isCorrect: boolean;
  explanation: string;
  exampleSentence: string;
}

export default function QuickCollocationCard() {
  const [exercises, setExercises] = useState<CollocationExercise[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'answering' | 'feedback' | 'summary'>('idle');
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [evalResult, setEvalResult] = useState<CollocationEvaluateResponse | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [shuffledOptions, setShuffledOptions] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);

  const fetchExercises = useCallback(async () => {
    setLoading(true);
    setPhase('idle');
    setCurrentIndex(0);
    setAnswers([]);
    setSelectedChoice(null);
    setEvalResult(null);
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const res = await getCollocationDrill(difficulty, 5);
      setExercises(res.exercises);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      fetchExercises();
    }
  }, [initialized, fetchExercises]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'quick-practice-difficulty') {
        fetchExercises();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [fetchExercises]);

  // Shuffle options when exercise changes
  useEffect(() => {
    if (exercises.length > 0 && currentIndex < exercises.length) {
      const ex = exercises[currentIndex];
      const opts = [ex.correct_collocation, ...ex.wrong_collocations];
      // Fisher-Yates shuffle
      for (let i = opts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [opts[i], opts[j]] = [opts[j], opts[i]];
      }
      setShuffledOptions(opts);
      setPhase('answering');
      setSelectedChoice(null);
      setEvalResult(null);
    }
  }, [exercises, currentIndex]);

  const handleSelect = useCallback(async (choice: string) => {
    if (phase !== 'answering' || !exercises[currentIndex]) return;
    setSelectedChoice(choice);
    setEvaluating(true);

    const ex = exercises[currentIndex];
    try {
      const res = await evaluateCollocation(ex.base_word, ex.correct_collocation, choice);
      setEvalResult(res);
    } catch {
      // Fallback: determine correctness locally
      const isCorrect = choice.trim().toLowerCase() === ex.correct_collocation.trim().toLowerCase();
      setEvalResult({
        is_correct: isCorrect,
        explanation: ex.explanation,
        example_sentence: '',
      });
    } finally {
      setEvaluating(false);
      setPhase('feedback');
    }
  }, [phase, exercises, currentIndex]);

  const handleNext = useCallback(() => {
    if (!exercises[currentIndex] || !evalResult || selectedChoice === null) return;

    const ex = exercises[currentIndex];
    setAnswers(prev => [...prev, {
      exercise: ex,
      userChoice: selectedChoice,
      isCorrect: evalResult.is_correct,
      explanation: evalResult.explanation,
      exampleSentence: evalResult.example_sentence,
    }]);

    if (currentIndex + 1 < exercises.length) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setPhase('summary');
    }
  }, [currentIndex, exercises, evalResult, selectedChoice]);

  const currentExercise = exercises[currentIndex] ?? null;
  const score = answers.filter(a => a.isCorrect).length;

  const optionBg = (opt: string) => {
    if (phase !== 'feedback' || !selectedChoice || !currentExercise) return 'var(--card-bg, white)';
    const isCorrectOption = opt === currentExercise.correct_collocation;
    const isSelected = opt === selectedChoice;
    if (isCorrectOption) return '#22c55e18';
    if (isSelected && !evalResult?.is_correct) return '#ef444418';
    return 'var(--card-bg, white)';
  };

  const optionBorder = (opt: string) => {
    if (phase !== 'feedback' || !selectedChoice || !currentExercise) {
      return opt === selectedChoice ? '2px solid var(--primary, #3b82f6)' : '1px solid var(--border, #d1d5db)';
    }
    const isCorrectOption = opt === currentExercise.correct_collocation;
    const isSelected = opt === selectedChoice;
    if (isCorrectOption) return '2px solid #22c55e';
    if (isSelected && !evalResult?.is_correct) return '2px solid #ef4444';
    return '1px solid var(--border, #d1d5db)';
  };

  return (
    <div className="card" style={{ padding: 20, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>
          <Link2 size={16} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
          Collocation Match
        </h3>
        <button
          className="btn btn-secondary"
          onClick={fetchExercises}
          disabled={loading || evaluating}
          style={{ padding: '4px 10px', fontSize: '0.75rem' }}
          data-testid="collocation-refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center' }}>
          Loading collocations…
        </p>
      ) : exercises.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center' }}>
          No exercises available.
        </p>
      ) : phase === 'summary' ? (
        <div>
          <div style={{
            textAlign: 'center', padding: 16, borderRadius: 8, marginBottom: 12,
            background: score === answers.length ? '#22c55e10' : '#f59e0b10',
            border: `1px solid ${score === answers.length ? '#22c55e30' : '#f59e0b30'}`,
          }}>
            <div style={{ fontSize: '2rem', marginBottom: 4 }}>
              {score === answers.length ? '🎉' : '📊'}
            </div>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text)' }}>
              {score} / {answers.length} correct
            </div>
          </div>

          {answers.filter(a => !a.isCorrect).length > 0 && (
            <div style={{
              background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8,
              padding: '10px 12px', marginBottom: 12,
              borderLeft: '3px solid #ef4444',
            }}>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 6px', fontWeight: 600 }}>
                ❌ Missed collocations
              </p>
              {answers.filter(a => !a.isCorrect).map((a, i) => (
                <div key={i} style={{ marginBottom: 6 }}>
                  <span style={{
                    fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)',
                  }}>
                    {a.exercise.correct_collocation}
                  </span>
                  <span style={{
                    fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: 8,
                  }}>
                    ({a.exercise.category})
                  </span>
                </div>
              ))}
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={fetchExercises}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            data-testid="collocation-new-round"
          >
            <RefreshCw size={14} /> New Round
          </button>
        </div>
      ) : currentExercise ? (
        <div>
          {/* Progress indicator */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 10, fontSize: '0.75rem', color: 'var(--text-secondary)',
          }}>
            <span>Question {currentIndex + 1} of {exercises.length}</span>
            <span style={{
              background: '#8b5cf610', color: '#8b5cf6', borderRadius: '1rem',
              padding: '2px 8px', fontWeight: 600,
            }}>
              {currentExercise.category}
            </span>
          </div>

          {/* Base word */}
          <div style={{
            textAlign: 'center', padding: 12, borderRadius: 8, marginBottom: 12,
            background: 'var(--bg-secondary, #f9fafb)', border: '1px solid var(--border)',
          }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
              Find the correct collocation for
            </div>
            <div style={{ fontWeight: 700, fontSize: '1.3rem', color: 'var(--text)' }}>
              {currentExercise.base_word}
            </div>
          </div>

          {/* Options */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {shuffledOptions.map((opt, idx) => (
              <button
                key={idx}
                onClick={() => handleSelect(opt)}
                disabled={phase === 'feedback' || evaluating}
                data-testid={`collocation-option-${idx}`}
                style={{
                  padding: '10px 14px',
                  border: optionBorder(opt),
                  borderRadius: 8,
                  background: optionBg(opt),
                  cursor: phase === 'feedback' ? 'default' : 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: selectedChoice === opt ? 600 : 400,
                  color: 'var(--text)',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                }}
              >
                {opt}
              </button>
            ))}
          </div>

          {/* Evaluating state */}
          {evaluating && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center' }}>
              Checking…
            </p>
          )}

          {/* Feedback */}
          {phase === 'feedback' && evalResult && (
            <div>
              <div style={{
                padding: 10, borderRadius: 8, marginBottom: 10,
                background: evalResult.is_correct ? '#22c55e10' : '#ef444410',
                border: `1px solid ${evalResult.is_correct ? '#22c55e30' : '#ef444430'}`,
              }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: evalResult.is_correct ? '#22c55e' : '#ef4444', marginBottom: 4 }}>
                  {evalResult.is_correct ? '✅ Correct!' : '❌ Not quite'}
                </div>
                {evalResult.explanation && (
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0 0 4px' }}>
                    {evalResult.explanation}
                  </p>
                )}
                {evalResult.example_sentence && (
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0, fontStyle: 'italic' }}>
                    💡 {evalResult.example_sentence}
                  </p>
                )}
              </div>

              <button
                className="btn btn-primary"
                onClick={handleNext}
                style={{ width: '100%' }}
                data-testid="collocation-next"
              >
                {currentIndex + 1 < exercises.length ? 'Next →' : 'See Results'}
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
