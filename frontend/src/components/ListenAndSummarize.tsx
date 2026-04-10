import { useState, useCallback, useEffect } from 'react';
import { Mic, MicOff, Volume2, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { evaluateListeningSummary } from '../api';
import type { ListeningSummaryEvaluation } from '../api';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

interface ListenAndSummarizeProps {
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

export function ListenAndSummarize({ passage }: ListenAndSummarizeProps) {
  const [expanded, setExpanded] = useState(false);
  const [evaluation, setEvaluation] = useState<ListeningSummaryEvaluation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { isListening, transcript, start, stop, reset } = useSpeechRecognition();

  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);

  const handleReplay = useCallback(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(passage);
      utt.rate = 0.85;
      utt.lang = 'en-US';
      window.speechSynthesis.speak(utt);
    }
  }, [passage]);

  const handleSubmit = async () => {
    if (!transcript.trim()) return;
    setLoading(true);
    setError('');
    try {
      const result = await evaluateListeningSummary({ passage, user_summary: transcript.trim() });
      setEvaluation(result);
    } catch {
      setError('Evaluation failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setEvaluation(null);
    setError('');
    reset();
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
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          padding: 0, color: 'var(--text-primary, #1f2937)',
        }}
        aria-label={expanded ? 'Collapse listen and summarize' : 'Expand listen and summarize'}
      >
        <h4 style={{ margin: 0, fontSize: '1rem' }}>📝 Listen &amp; Summarize</h4>
        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {expanded && (
        <div style={{ marginTop: 16 }}>
          <p style={{ color: 'var(--text-secondary, #6b7280)', fontSize: 14, marginBottom: 12 }}>
            Listen to the passage, then summarize it in your own words using the microphone.
          </p>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button
              className="btn btn-secondary"
              onClick={handleReplay}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '6px 14px' }}
            >
              <Volume2 size={14} /> Replay Passage
            </button>
          </div>

          {!evaluation ? (
            <>
              {/* Recording controls */}
              <div style={{
                padding: 16,
                background: 'var(--bg-primary, #fff)',
                borderRadius: 8,
                border: `2px solid ${isListening ? 'var(--danger, #ef4444)' : 'var(--border-color, #e5e7eb)'}`,
                marginBottom: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <button
                    className={`btn ${isListening ? 'btn-danger' : 'btn-primary'}`}
                    onClick={isListening ? stop : start}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    {isListening ? <MicOff size={16} /> : <Mic size={16} />}
                    {isListening ? 'Stop' : 'Record Summary'}
                  </button>
                  {isListening && (
                    <span style={{ fontSize: 13, color: 'var(--danger, #ef4444)', fontWeight: 500 }}>
                      ● Recording...
                    </span>
                  )}
                </div>
                {transcript && (
                  <div style={{
                    padding: 10, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 6,
                    fontSize: 14, lineHeight: 1.6, color: 'var(--text-primary, #1f2937)',
                    minHeight: 40,
                  }}>
                    {transcript}
                  </div>
                )}
              </div>

              {transcript && !isListening && (
                <button
                  className="btn btn-primary"
                  onClick={handleSubmit}
                  disabled={loading}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  {loading ? 'Evaluating...' : 'Submit Summary'}
                </button>
              )}
              {error && <p style={{ color: 'var(--danger, #ef4444)', fontSize: 13, marginTop: 8 }}>{error}</p>}
            </>
          ) : (
            <>
              {/* Results */}
              <div style={{ marginBottom: 16 }}>
                <div style={{
                  textAlign: 'center', marginBottom: 16,
                  fontSize: 28, fontWeight: 700,
                  color: evaluation.overall_score >= 7 ? 'var(--success, #22c55e)' : evaluation.overall_score >= 5 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)',
                }}>
                  {evaluation.overall_score.toFixed(1)}/10
                </div>
                <ScoreBar label="Content Coverage" score={evaluation.content_coverage_score} />
                <ScoreBar label="Accuracy" score={evaluation.accuracy_score} />
                <ScoreBar label="Grammar" score={evaluation.grammar_score} />
                <ScoreBar label="Conciseness" score={evaluation.conciseness_score} />
              </div>

              {evaluation.feedback && (
                <div style={{
                  padding: 12, background: 'var(--bg-primary, #fff)', borderRadius: 8,
                  borderLeft: '3px solid var(--primary, #6366f1)', marginBottom: 12, fontSize: 14,
                }}>
                  <strong>Feedback:</strong> {evaluation.feedback}
                </div>
              )}

              {evaluation.model_summary && (
                <div style={{
                  padding: 12, background: 'var(--bg-primary, #fff)', borderRadius: 8,
                  borderLeft: '3px solid var(--success, #22c55e)', marginBottom: 12, fontSize: 14,
                }}>
                  <strong>Model Summary:</strong> {evaluation.model_summary}
                </div>
              )}

              <div style={{
                padding: 10, background: 'var(--bg-primary, #fff)', borderRadius: 8,
                border: '1px solid var(--border-color, #e5e7eb)', marginBottom: 12, fontSize: 14,
                color: 'var(--text-secondary, #6b7280)',
              }}>
                <strong>Your Summary:</strong> {transcript}
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
