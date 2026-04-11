import { useState, useCallback, useRef, useEffect } from 'react';
import { Mic, MicOff, Send, ChevronDown, ChevronUp, BookOpen } from 'lucide-react';
import { api } from '../../api';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { ScoreBar } from './ScoreBar';

interface Props {
  conversationId: number;
  summaryText: string;
}

interface EvalResult {
  content_coverage: number;
  grammar_score: number;
  fluency_score: number;
  vocabulary_score: number;
  overall_score: number;
  feedback: string;
  model_retelling: string;
}


export function SpokenRetelling({ conversationId, summaryText }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [userText, setUserText] = useState('');
  const [showModel, setShowModel] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const speech = useSpeechRecognition({ continuous: true });

  useEffect(() => {
    if (speech.transcript) {
      setUserText(speech.transcript);
    }
  }, [speech.transcript]);

  const handleToggleRecord = useCallback(() => {
    if (speech.isListening) {
      speech.stop();
    } else {
      setError('');
      setEvalResult(null);
      speech.reset();
      setUserText('');
      speech.start();
    }
  }, [speech]);

  const handleSubmit = useCallback(async () => {
    const text = userText.trim();
    if (!text || evaluating) return;
    setEvaluating(true);
    setError('');
    try {
      const result = await api.evaluateRetelling(summaryText, text);
      setEvalResult(result);
    } catch {
      setError('Evaluation failed. Please try again.');
    } finally {
      setEvaluating(false);
    }
  }, [userText, evaluating, summaryText]);

  const handleRetry = useCallback(() => {
    setEvalResult(null);
    setUserText('');
    setShowModel(false);
    setError('');
    speech.reset();
  }, [speech]);

  const cardStyle: React.CSSProperties = {
    background: 'var(--card-bg, #fff)',
    border: '1px solid var(--border, #e5e7eb)',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'pointer',
    userSelect: 'none',
  };

  if (!summaryText) return null;

  return (
    <div style={cardStyle}>
      <div style={headerStyle} onClick={() => setExpanded(!expanded)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BookOpen size={18} style={{ color: 'var(--primary, #6366f1)' }} />
          <span style={{ fontWeight: 600, fontSize: 15 }}>🗣️ Spoken Retelling</span>
        </div>
        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </div>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
            Summarize the conversation in your own words. Use the microphone to speak, or type your retelling below.
          </p>

          {!evalResult && (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                {speech.isSupported && (
                  <button
                    onClick={handleToggleRecord}
                    disabled={evaluating}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: 'none',
                      background: speech.isListening ? 'var(--danger, #ef4444)' : 'var(--primary, #6366f1)',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    {speech.isListening ? <MicOff size={16} /> : <Mic size={16} />}
                    {speech.isListening ? 'Stop' : 'Record'}
                  </button>
                )}
              </div>

              <textarea
                ref={textareaRef}
                value={userText}
                onChange={e => setUserText(e.target.value)}
                placeholder="Speak or type your retelling of the conversation..."
                disabled={evaluating || speech.isListening}
                rows={4}
                style={{
                  width: '100%',
                  padding: 10,
                  borderRadius: 8,
                  border: '1px solid var(--border, #e5e7eb)',
                  background: 'var(--input-bg, #f9fafb)',
                  color: 'var(--text-primary, #111)',
                  fontSize: 14,
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />

              {speech.isListening && (
                <p style={{ fontSize: 12, color: 'var(--danger, #ef4444)', marginTop: 4 }}>
                  🎙️ Listening...
                </p>
              )}

              <button
                onClick={handleSubmit}
                disabled={!userText.trim() || evaluating || speech.isListening}
                style={{
                  marginTop: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: !userText.trim() || evaluating ? '#ccc' : 'var(--primary, #6366f1)',
                  color: '#fff',
                  cursor: !userText.trim() || evaluating ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                <Send size={16} />
                {evaluating ? 'Evaluating...' : 'Submit'}
              </button>
            </>
          )}

          {error && (
            <p style={{ color: 'var(--danger, #ef4444)', fontSize: 13, marginTop: 8 }}>{error}</p>
          )}

          {evalResult && (
            <div style={{ marginTop: 12 }}>
              <div style={{ marginBottom: 12 }}>
                <ScoreBar label="Content Coverage" score={evalResult.content_coverage} />
                <ScoreBar label="Grammar" score={evalResult.grammar_score} />
                <ScoreBar label="Fluency" score={evalResult.fluency_score} />
                <ScoreBar label="Vocabulary" score={evalResult.vocabulary_score} />
                <ScoreBar label="Overall" score={evalResult.overall_score} />
              </div>

              <div style={{
                padding: 12,
                borderRadius: 8,
                background: 'var(--info-bg, #eff6ff)',
                fontSize: 13,
                lineHeight: 1.5,
                marginBottom: 12,
              }}>
                <strong>Feedback:</strong> {evalResult.feedback}
              </div>

              <button
                onClick={() => setShowModel(!showModel)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border, #e5e7eb)',
                  background: 'var(--card-bg, #fff)',
                  cursor: 'pointer',
                  fontSize: 13,
                  marginBottom: showModel ? 8 : 0,
                }}
              >
                {showModel ? 'Hide' : 'Show'} Model Retelling
              </button>

              {showModel && (
                <div style={{
                  padding: 12,
                  borderRadius: 8,
                  background: 'var(--success-bg, #f0fdf4)',
                  fontSize: 13,
                  lineHeight: 1.6,
                  fontStyle: 'italic',
                }}>
                  {evalResult.model_retelling}
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <button
                  onClick={handleRetry}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'var(--primary, #6366f1)',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 500,
                  }}
                >
                  Try Again
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
