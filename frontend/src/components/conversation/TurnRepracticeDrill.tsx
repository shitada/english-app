import { useState, useEffect } from 'react';
import { Volume2, Mic, MicOff, Send, RotateCcw } from 'lucide-react';
import { api } from '../../api';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';

interface Props {
  aiMessage: string;
  originalUserMessage: string;
  ttsSpeak: (text: string) => void;
  onClose: () => void;
}

interface RephraseResult {
  meaning_preserved: boolean;
  naturalness_score: number;
  variety_score: number;
  overall_score: number;
  feedback: string;
}

function scoreColor(score: number): string {
  if (score >= 8) return '#22c55e';
  if (score >= 5) return '#f59e0b';
  return '#ef4444';
}

export function TurnRepracticeDrill({ aiMessage, originalUserMessage, ttsSpeak, onClose }: Props) {
  const [userInput, setUserInput] = useState('');
  const [result, setResult] = useState<RephraseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [error, setError] = useState('');

  const speech = useSpeechRecognition();

  // Sync speech transcript to input
  useEffect(() => {
    if (speech.transcript) {
      setUserInput(speech.transcript);
    }
  }, [speech.transcript]);

  async function handleSubmit() {
    const text = userInput.trim();
    if (!text || loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.evaluateRephrase(originalUserMessage, text);
      setResult(res);
    } catch {
      setError('Evaluation failed. Please try again.');
    }
    setLoading(false);
  }

  function handleReset() {
    setUserInput('');
    setResult(null);
    setShowOriginal(false);
  }

  return (
    <div style={{
      marginTop: 8,
      padding: 16,
      borderRadius: 12,
      background: 'var(--bg, #f8fafc)',
      border: '1px solid var(--border)',
    }}>
      {/* AI context */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>AI said:</span>
          <button
            onClick={() => ttsSpeak(aiMessage)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', padding: 2 }}
            aria-label="Listen to AI message"
          >
            <Volume2 size={14} />
          </button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text)', fontStyle: 'italic', margin: 0 }}>
          "{aiMessage}"
        </p>
      </div>

      {/* Show/hide original */}
      <button
        onClick={() => setShowOriginal(!showOriginal)}
        style={{
          fontSize: 12, color: 'var(--text-secondary)', background: 'none',
          border: 'none', cursor: 'pointer', textDecoration: 'underline', marginBottom: 8, padding: 0,
        }}
      >
        {showOriginal ? 'Hide' : 'Show'} your original response
      </button>
      {showOriginal && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 8px', fontStyle: 'italic' }}>
          "{originalUserMessage}"
        </p>
      )}

      {!result ? (
        <>
          {/* Input area */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              value={userInput}
              onChange={e => setUserInput(e.target.value)}
              placeholder="Say it better this time..."
              rows={2}
              style={{
                flex: 1, padding: 10, borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--bg-card, white)', color: 'var(--text)', fontSize: 14,
                resize: 'vertical', fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {speech.isSupported && (
                <button
                  onClick={speech.isListening ? speech.stop : speech.start}
                  style={{
                    padding: 8, borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: speech.isListening ? '#ef4444' : 'var(--primary)',
                    color: 'white',
                  }}
                  aria-label={speech.isListening ? 'Stop recording' : 'Start recording'}
                >
                  {speech.isListening ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
              )}
              <button
                onClick={handleSubmit}
                disabled={!userInput.trim() || loading}
                style={{
                  padding: 8, borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: userInput.trim() ? 'var(--primary)' : 'var(--border)',
                  color: 'white', opacity: loading ? 0.6 : 1,
                }}
                aria-label="Submit response"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
          {loading && <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Evaluating...</p>}
          {error && <p style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>{error}</p>}
        </>
      ) : (
        <>
          {/* Results */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            {[
              { label: 'Overall', value: result.overall_score },
              { label: 'Naturalness', value: result.naturalness_score },
              { label: 'Variety', value: result.variety_score },
            ].map(s => (
              <div key={s.label} style={{
                padding: 8, borderRadius: 8,
                background: 'var(--bg-card, white)', border: '1px solid var(--border)',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: scoreColor(s.value) }}>
                  {s.value}/10
                </div>
              </div>
            ))}
            <div style={{
              padding: 8, borderRadius: 8,
              background: 'var(--bg-card, white)', border: '1px solid var(--border)',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Meaning</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: result.meaning_preserved ? '#22c55e' : '#ef4444' }}>
                {result.meaning_preserved ? '✓' : '✗'}
              </div>
            </div>
          </div>

          {/* Comparison */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div style={{ padding: 8, borderRadius: 8, background: 'var(--bg-card, white)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Original</div>
              <p style={{ fontSize: 13, margin: 0, color: 'var(--text)' }}>{originalUserMessage}</p>
            </div>
            <div style={{ padding: 8, borderRadius: 8, background: 'var(--bg-card, white)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Your new response</div>
              <p style={{ fontSize: 13, margin: 0, color: 'var(--text)' }}>{userInput}</p>
            </div>
          </div>

          {result.feedback && (
            <p style={{ fontSize: 13, color: 'var(--text)', marginBottom: 12, lineHeight: 1.5 }}>
              💡 {result.feedback}
            </p>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleReset}
              style={{
                padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--text)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4, fontSize: 13,
              }}
            >
              <RotateCcw size={14} /> Try Again
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '6px 14px', borderRadius: 8, border: 'none',
                background: 'var(--primary)', color: 'white', cursor: 'pointer', fontSize: 13,
              }}
            >
              Done
            </button>
          </div>
        </>
      )}

      {/* Close button when not submitted */}
      {!result && (
        <button
          onClick={onClose}
          style={{
            marginTop: 8, fontSize: 12, color: 'var(--text-secondary)',
            background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0,
          }}
        >
          Cancel
        </button>
      )}
    </div>
  );
}
