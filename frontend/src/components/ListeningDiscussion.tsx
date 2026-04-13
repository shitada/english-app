import { useState, useCallback, useRef } from 'react';
import { Mic, MicOff, ChevronDown, ChevronUp, RotateCcw, MessageCircle } from 'lucide-react';
import { getListeningDiscussionQuestion, evaluateListeningDiscussion } from '../api';
import type { ListeningDiscussionQuestion, ListeningDiscussionEvaluation } from '../api';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

interface Props {
  passage: string;
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const pct = (score / 10) * 100;
  const color = score >= 7 ? 'var(--success, #22c55e)' : score >= 5 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)';
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600 }}>{score.toFixed(1)}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-secondary, #e5e7eb)' }}>
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: color, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

export function ListeningDiscussion({ passage }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [questionData, setQuestionData] = useState<ListeningDiscussionQuestion | null>(null);
  const [evaluation, setEvaluation] = useState<ListeningDiscussionEvaluation | null>(null);
  const [loading, setLoading] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState('');
  const [timer, setTimer] = useState(30);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const speech = useSpeechRecognition({ continuous: true });

  const loadQuestion = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getListeningDiscussionQuestion({ passage });
      setQuestionData(data);
    } catch {
      setError('Failed to generate discussion question. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [passage]);

  const handleExpand = useCallback(() => {
    const willExpand = !expanded;
    setExpanded(willExpand);
    if (willExpand && !questionData && !loading) {
      loadQuestion();
    }
  }, [expanded, questionData, loading, loadQuestion]);

  const startRecording = useCallback(() => {
    setTimer(30);
    speech.reset();
    speech.start();
    startTimeRef.current = Date.now();
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

  const stopRecording = useCallback(() => {
    speech.stop();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [speech]);

  const handleSubmit = async () => {
    if (!speech.transcript.trim() || !questionData) return;
    setEvaluating(true);
    setError('');
    const duration = (Date.now() - startTimeRef.current) / 1000;
    try {
      const result = await evaluateListeningDiscussion({
        passage,
        question: questionData.question,
        user_response: speech.transcript.trim(),
        duration_seconds: duration,
      });
      setEvaluation(result);
    } catch {
      setError('Evaluation failed. Please try again.');
    } finally {
      setEvaluating(false);
    }
  };

  const handleReset = () => {
    setEvaluation(null);
    setError('');
    setTimer(30);
    speech.reset();
  };

  return (
    <div style={{
      marginTop: 24,
      padding: 20,
      background: 'var(--bg-secondary, #f5f5f5)',
      borderRadius: 12,
      border: '1px solid var(--border-color, #e5e7eb)',
    }}>
      <button
        onClick={handleExpand}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          padding: 0, color: 'var(--text-primary, #1f2937)',
        }}
        aria-label={expanded ? 'Collapse discussion' : 'Expand discussion'}
      >
        <h4 style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <MessageCircle size={18} /> Discuss the Topic
        </h4>
        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {expanded && (
        <div style={{ marginTop: 16 }}>
          {loading && (
            <p style={{ color: 'var(--text-secondary, #6b7280)', fontSize: 14 }}>Generating discussion question...</p>
          )}

          {error && <p style={{ color: 'var(--danger, #ef4444)', fontSize: 13 }}>{error}</p>}

          {questionData && !evaluation && (
            <>
              <div style={{
                padding: 14, background: 'var(--bg-primary, #fff)', borderRadius: 8,
                borderLeft: '3px solid var(--primary, #6366f1)', marginBottom: 14, fontSize: 15,
                fontWeight: 500, lineHeight: 1.5,
              }}>
                {questionData.question}
              </div>

              {questionData.hints.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary, #6b7280)' }}>Starter phrases:</span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                    {questionData.hints.map((hint, i) => (
                      <span key={i} style={{
                        padding: '3px 10px', background: 'var(--bg-primary, #fff)', borderRadius: 12,
                        fontSize: 12, color: 'var(--text-secondary, #6b7280)',
                        border: '1px solid var(--border-color, #e5e7eb)',
                      }}>
                        {hint}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{
                padding: 16, background: 'var(--bg-primary, #fff)', borderRadius: 8,
                border: `2px solid ${speech.isListening ? 'var(--danger, #ef4444)' : 'var(--border-color, #e5e7eb)'}`,
                marginBottom: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <button
                    className={`btn ${speech.isListening ? 'btn-danger' : 'btn-primary'}`}
                    onClick={speech.isListening ? stopRecording : startRecording}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    {speech.isListening ? <MicOff size={16} /> : <Mic size={16} />}
                    {speech.isListening ? 'Stop' : 'Record Response'}
                  </button>
                  {speech.isListening && (
                    <span style={{ fontSize: 13, color: 'var(--danger, #ef4444)', fontWeight: 500 }}>
                      ● {timer}s
                    </span>
                  )}
                </div>
                {speech.transcript && (
                  <div style={{
                    padding: 10, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 6,
                    fontSize: 14, lineHeight: 1.6, color: 'var(--text-primary, #1f2937)', minHeight: 40,
                  }}>
                    {speech.transcript}
                  </div>
                )}
              </div>

              {speech.transcript && !speech.isListening && (
                <button
                  className="btn btn-primary"
                  onClick={handleSubmit}
                  disabled={evaluating}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  {evaluating ? 'Evaluating...' : 'Submit Response'}
                </button>
              )}
            </>
          )}

          {evaluation && (
            <>
              <div style={{ marginBottom: 16 }}>
                <div style={{
                  textAlign: 'center', marginBottom: 16, fontSize: 28, fontWeight: 700,
                  color: evaluation.overall_score >= 7 ? 'var(--success, #22c55e)' : evaluation.overall_score >= 5 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)',
                }}>
                  {evaluation.overall_score.toFixed(1)}/10
                </div>
                <ScoreBar label="Argument" score={evaluation.argument_score} />
                <ScoreBar label="Relevance" score={evaluation.relevance_score} />
                <ScoreBar label="Grammar" score={evaluation.grammar_score} />
                <ScoreBar label="Vocabulary" score={evaluation.vocabulary_score} />
              </div>

              {evaluation.feedback && (
                <div style={{
                  padding: 12, background: 'var(--bg-primary, #fff)', borderRadius: 8,
                  borderLeft: '3px solid var(--primary, #6366f1)', marginBottom: 12, fontSize: 14,
                }}>
                  <strong>Feedback:</strong> {evaluation.feedback}
                </div>
              )}

              {evaluation.model_answer && (
                <div style={{
                  padding: 12, background: 'var(--bg-primary, #fff)', borderRadius: 8,
                  borderLeft: '3px solid var(--success, #22c55e)', marginBottom: 12, fontSize: 14,
                }}>
                  <strong>Model Answer:</strong> {evaluation.model_answer}
                </div>
              )}

              <div style={{
                padding: 10, background: 'var(--bg-primary, #fff)', borderRadius: 8,
                border: '1px solid var(--border-color, #e5e7eb)', marginBottom: 12, fontSize: 14,
                color: 'var(--text-secondary, #6b7280)',
              }}>
                <strong>Your Response:</strong> {speech.transcript}
              </div>

              <button
                className="btn btn-secondary"
                onClick={handleReset}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <RotateCcw size={14} /> Try Again
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
