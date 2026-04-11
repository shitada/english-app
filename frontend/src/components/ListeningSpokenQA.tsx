import { useState, useCallback, useRef } from 'react';
import { Mic, MicOff, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { evaluateListeningQA } from '../api';
import type { ListeningQAEvaluation, ListeningQuizQuestion } from '../api';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

interface Props {
  passage: string;
  questions: ListeningQuizQuestion[];
}

interface QAResult {
  question: string;
  correctAnswer: string;
  userAnswer: string;
  evaluation: ListeningQAEvaluation;
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const pct = (score / 10) * 100;
  const color = score >= 7 ? 'var(--success, #22c55e)' : score >= 5 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)';
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600, color }}>{score.toFixed(1)}</span>
      </div>
      <div style={{ height: 5, background: 'var(--border, #e5e7eb)', borderRadius: 3 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

export function ListeningSpokenQA({ passage, questions }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<'prompt' | 'recording' | 'evaluating' | 'result' | 'summary'>('prompt');
  const [results, setResults] = useState<QAResult[]>([]);
  const [currentEval, setCurrentEval] = useState<ListeningQAEvaluation | null>(null);
  const [error, setError] = useState('');
  const [timer, setTimer] = useState(20);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speech = useSpeechRecognition({ continuous: true });

  const currentQ = questions[currentIndex];

  const startRecording = useCallback(() => {
    setTimer(20);
    speech.reset();
    speech.start();
    setPhase('recording');
    timerRef.current = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) {
          speech.stop();
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [speech]);

  const stopAndEvaluate = useCallback(async () => {
    speech.stop();
    if (timerRef.current) clearInterval(timerRef.current);

    const userAnswer = speech.transcript.trim();
    if (!userAnswer) {
      setError('No speech detected. Please try again.');
      setPhase('prompt');
      return;
    }

    setPhase('evaluating');
    const correctAnswer = currentQ.options[currentQ.correct_index];

    try {
      const evalResult = await evaluateListeningQA({
        passage,
        question: currentQ.question,
        correct_answer: correctAnswer,
        user_spoken_answer: userAnswer,
      });
      setCurrentEval(evalResult);
      setResults(prev => [...prev, {
        question: currentQ.question,
        correctAnswer,
        userAnswer,
        evaluation: evalResult,
      }]);
      setPhase('result');
    } catch {
      setError('Evaluation failed. Please try the next question.');
      setPhase('result');
    }
  }, [speech, currentQ, passage]);

  const nextQuestion = useCallback(() => {
    setCurrentEval(null);
    setError('');
    speech.reset();
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(i => i + 1);
      setPhase('prompt');
    } else {
      setPhase('summary');
    }
  }, [currentIndex, questions.length, speech]);

  const restart = useCallback(() => {
    setCurrentIndex(0);
    setResults([]);
    setCurrentEval(null);
    setError('');
    speech.reset();
    setPhase('prompt');
  }, [speech]);

  const readQuestion = useCallback((text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }, []);

  if (!questions.length) return null;

  return (
    <div style={{ marginTop: 20, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          width: '100%', padding: '14px 16px', background: 'var(--card-bg)', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)', fontSize: 15, fontWeight: 600,
        }}
      >
        {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        🎤 Spoken Q&A Challenge
        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          Answer questions by speaking
        </span>
      </button>

      {expanded && (
        <div style={{ padding: 16, borderTop: '1px solid var(--border)' }}>
          {phase === 'summary' ? (
            <div>
              <h4 style={{ textAlign: 'center', marginBottom: 12 }}>🎤 Spoken Q&A — Summary</h4>
              {results.length > 0 && (() => {
                const avgContent = results.reduce((s, r) => s + r.evaluation.content_accuracy_score, 0) / results.length;
                const avgGrammar = results.reduce((s, r) => s + r.evaluation.grammar_score, 0) / results.length;
                const avgVocab = results.reduce((s, r) => s + r.evaluation.vocabulary_score, 0) / results.length;
                const avgOverall = results.reduce((s, r) => s + r.evaluation.overall_score, 0) / results.length;
                return (
                  <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: 16, marginBottom: 12 }}>
                    <div style={{ textAlign: 'center', marginBottom: 12 }}>
                      <div style={{ fontSize: 36, fontWeight: 700, color: avgOverall >= 7 ? 'var(--success)' : avgOverall >= 5 ? 'var(--warning)' : 'var(--danger)' }}>
                        {avgOverall.toFixed(1)}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Average Score</div>
                    </div>
                    <ScoreBar label="Content Accuracy" score={avgContent} />
                    <ScoreBar label="Grammar" score={avgGrammar} />
                    <ScoreBar label="Vocabulary" score={avgVocab} />
                  </div>
                );
              })()}
              {results.map((r, i) => (
                <div key={i} style={{ padding: 10, background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 8, fontSize: 13 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Q{i + 1}: {r.question}</div>
                  <div style={{ color: 'var(--text-secondary)' }}>You said: "{r.userAnswer}"</div>
                  <div style={{ color: 'var(--success)', marginTop: 2 }}>✓ {r.evaluation.model_answer}</div>
                  <div style={{ textAlign: 'right', fontWeight: 600, color: r.evaluation.overall_score >= 7 ? 'var(--success)' : 'var(--warning)' }}>
                    {r.evaluation.overall_score.toFixed(1)}/10
                  </div>
                </div>
              ))}
              <div style={{ textAlign: 'center', marginTop: 12 }}>
                <button className="btn btn-primary" onClick={restart} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <RotateCcw size={14} /> Try Again
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Question {currentIndex + 1} of {questions.length}
                </span>
              </div>

              <div style={{ padding: 14, background: 'var(--bg-secondary)', borderRadius: 10, marginBottom: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.5 }}>
                  {currentQ.question}
                </div>
                <button
                  onClick={() => readQuestion(currentQ.question)}
                  style={{ marginTop: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}
                >
                  🔊 Listen
                </button>
              </div>

              {error && (
                <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', color: 'var(--danger, #ef4444)', borderRadius: 8, marginBottom: 10, fontSize: 13 }}>
                  {error}
                </div>
              )}

              {phase === 'prompt' && (
                <div style={{ textAlign: 'center' }}>
                  <button className="btn btn-primary" onClick={startRecording} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 24px' }}>
                    <Mic size={18} /> Speak Your Answer
                  </button>
                </div>
              )}

              {phase === 'recording' && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: timer <= 5 ? 'var(--danger)' : 'var(--text)', marginBottom: 10 }}>
                    {timer}s
                  </div>
                  <button className="btn btn-danger" onClick={stopAndEvaluate} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 24px' }}>
                    <MicOff size={18} /> Done
                  </button>
                  {speech.transcript && (
                    <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                      "{speech.transcript}"
                    </div>
                  )}
                </div>
              )}

              {phase === 'evaluating' && (
                <div style={{ textAlign: 'center', padding: 16 }}>
                  <div className="spinner" style={{ margin: '0 auto 10px' }} />
                  <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Evaluating your answer…</p>
                </div>
              )}

              {phase === 'result' && currentEval && (
                <div>
                  <div style={{ background: 'var(--card-bg)', borderRadius: 10, padding: 14, border: '1px solid var(--border)', marginBottom: 10 }}>
                    <ScoreBar label="Content Accuracy" score={currentEval.content_accuracy_score} />
                    <ScoreBar label="Grammar" score={currentEval.grammar_score} />
                    <ScoreBar label="Vocabulary" score={currentEval.vocabulary_score} />
                    <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 8, background: currentEval.overall_score >= 7 ? 'rgba(34,197,94,0.1)' : 'rgba(234,179,8,0.1)', textAlign: 'center', fontWeight: 600, fontSize: 16 }}>
                      Overall: {currentEval.overall_score.toFixed(1)}/10
                    </div>
                  </div>

                  {currentEval.feedback && (
                    <div style={{ padding: '8px 12px', background: 'rgba(99,102,241,0.06)', borderRadius: 8, fontSize: 13, marginBottom: 8, border: '1px solid rgba(99,102,241,0.15)' }}>
                      💡 {currentEval.feedback}
                    </div>
                  )}

                  <div style={{ padding: '8px 12px', background: 'rgba(34,197,94,0.06)', borderRadius: 8, fontSize: 13, marginBottom: 12, border: '1px solid rgba(34,197,94,0.15)' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2 }}>Model answer:</div>
                    <div style={{ fontWeight: 500, color: 'var(--success, #22c55e)' }}>✓ {currentEval.model_answer}</div>
                  </div>

                  <div style={{ textAlign: 'center' }}>
                    <button className="btn btn-primary" onClick={nextQuestion} style={{ padding: '8px 20px' }}>
                      {currentIndex < questions.length - 1 ? 'Next Question →' : 'View Summary'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
