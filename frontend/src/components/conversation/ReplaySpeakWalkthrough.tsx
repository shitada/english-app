import { useState, useEffect, useCallback } from 'react';
import { Mic, MicOff, Volume2, ChevronRight, X, RotateCcw } from 'lucide-react';
import { api } from '../../api';
import type { ReplayTurn } from '../../api';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';

interface RephraseResult {
  meaning_preserved: boolean;
  naturalness_score: number;
  variety_score: number;
  overall_score: number;
  feedback: string;
}

interface TurnResult {
  turnIndex: number;
  originalMessage: string;
  spokenMessage: string;
  evaluation: RephraseResult;
}

interface Props {
  turns: ReplayTurn[];
  ttsSpeak: (text: string) => void;
  onClose: () => void;
}

type TurnPhase = 'tts' | 'record' | 'evaluating' | 'feedback' | 'done';

function scoreColor(score: number): string {
  if (score >= 8) return '#22c55e';
  if (score >= 5) return '#f59e0b';
  return '#ef4444';
}

export function ReplaySpeakWalkthrough({ turns, ttsSpeak, onClose }: Props) {
  const [currentTurnIdx, setCurrentTurnIdx] = useState(0);
  const [turnPhase, setTurnPhase] = useState<TurnPhase>('tts');
  const [currentEval, setCurrentEval] = useState<RephraseResult | null>(null);
  const [evalError, setEvalError] = useState('');
  const [results, setResults] = useState<TurnResult[]>([]);
  const [finished, setFinished] = useState(false);

  const speech = useSpeechRecognition();

  // Identify user turns (turns that have a user_message)
  const userTurnIndices = turns
    .map((t, i) => (t.user_message ? i : -1))
    .filter((i) => i >= 0);

  const totalUserTurns = userTurnIndices.length;
  const currentUserTurnOrder = userTurnIndices.indexOf(currentTurnIdx) + 1;
  const turn = turns[currentTurnIdx];

  // Auto-play TTS for the assistant message when entering a new turn
  useEffect(() => {
    if (turnPhase === 'tts' && turn?.assistant_message) {
      ttsSpeak(turn.assistant_message);
    }
  }, [currentTurnIdx, turnPhase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Capture transcript when recording stops
  useEffect(() => {
    if (turnPhase === 'record' && !speech.isListening && speech.transcript) {
      handleEvaluate(speech.transcript);
    }
  }, [speech.isListening, speech.transcript, turnPhase]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStartRecording = useCallback(() => {
    speech.reset();
    setEvalError('');
    setCurrentEval(null);
    setTurnPhase('record');
    speech.start();
  }, [speech]);

  const handleStopRecording = useCallback(() => {
    speech.stop();
  }, [speech]);

  const handleEvaluate = async (spoken: string) => {
    if (!turn?.user_message) return;
    setTurnPhase('evaluating');
    setEvalError('');
    try {
      const res = await api.evaluateRephrase(turn.user_message, spoken);
      setCurrentEval(res);
      setResults((prev) => [
        ...prev,
        {
          turnIndex: currentTurnIdx,
          originalMessage: turn.user_message!,
          spokenMessage: spoken,
          evaluation: res,
        },
      ]);
      setTurnPhase('feedback');
    } catch {
      setEvalError('Evaluation failed. Please try again.');
      setTurnPhase('record');
    }
  };

  const handleNextTurn = () => {
    const curPos = userTurnIndices.indexOf(currentTurnIdx);
    if (curPos < userTurnIndices.length - 1) {
      setCurrentTurnIdx(userTurnIndices[curPos + 1]);
      setTurnPhase('tts');
      setCurrentEval(null);
      speech.reset();
    } else {
      setFinished(true);
      setTurnPhase('done');
    }
  };

  const handleRetryTurn = () => {
    // Remove the last result for this turn if there is one
    setResults((prev) => {
      const idx = prev.findLastIndex((r) => r.turnIndex === currentTurnIdx);
      if (idx >= 0) {
        const copy = [...prev];
        copy.splice(idx, 1);
        return copy;
      }
      return prev;
    });
    setCurrentEval(null);
    setTurnPhase('tts');
    speech.reset();
  };

  // Compute summary stats
  const avgOverall =
    results.length > 0
      ? +(results.reduce((s, r) => s + r.evaluation.overall_score, 0) / results.length).toFixed(1)
      : 0;
  const avgNaturalness =
    results.length > 0
      ? +(results.reduce((s, r) => s + r.evaluation.naturalness_score, 0) / results.length).toFixed(1)
      : 0;
  const avgVariety =
    results.length > 0
      ? +(results.reduce((s, r) => s + r.evaluation.variety_score, 0) / results.length).toFixed(1)
      : 0;
  const meaningPreservedCount = results.filter((r) => r.evaluation.meaning_preserved).length;

  const progressPct = totalUserTurns > 0 ? Math.round((currentUserTurnOrder / totalUserTurns) * 100) : 0;

  if (totalUserTurns === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
          No user turns found in this conversation to practice.
        </p>
        <button
          onClick={onClose}
          style={{
            padding: '8px 20px', borderRadius: 8, border: 'none',
            background: 'var(--primary, #6366f1)', color: '#fff', cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>
    );
  }

  // Summary view
  if (finished) {
    return (
      <div style={{ padding: 16 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '1.1rem' }}>🗣️ Speak Through — Summary</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
          {results.length} turn{results.length !== 1 ? 's' : ''} practiced
        </p>

        {/* Score cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
          {[
            { label: 'Overall', value: avgOverall },
            { label: 'Naturalness', value: avgNaturalness },
            { label: 'Variety', value: avgVariety },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                padding: 12, borderRadius: 10, textAlign: 'center',
                background: 'var(--bg-card, white)', border: '1px solid var(--border)',
              }}
            >
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: scoreColor(s.value) }}>{s.value}/10</div>
            </div>
          ))}
          <div
            style={{
              padding: 12, borderRadius: 10, textAlign: 'center',
              background: 'var(--bg-card, white)', border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Meaning ✓</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#6366f1' }}>
              {meaningPreservedCount}/{results.length}
            </div>
          </div>
        </div>

        {/* Per-turn breakdown */}
        <div style={{ marginBottom: 16 }}>
          {results.map((r, i) => (
            <div
              key={i}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 12px', borderRadius: 8, marginBottom: 4,
                background: r.evaluation.overall_score >= 7 ? '#f0fdf4' : r.evaluation.overall_score >= 5 ? '#fefce8' : '#fef2f2',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ flex: 1, fontSize: 13 }}>
                <div style={{ color: 'var(--text)', fontWeight: 500, marginBottom: 2 }}>
                  Turn {userTurnIndices.indexOf(r.turnIndex) + 1}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                  "{r.spokenMessage.slice(0, 60)}{r.spokenMessage.length > 60 ? '…' : ''}"
                </div>
              </div>
              <div style={{ fontWeight: 700, fontSize: 16, color: scoreColor(r.evaluation.overall_score), marginLeft: 8 }}>
                {r.evaluation.overall_score}/10
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => {
              setFinished(false);
              setResults([]);
              setCurrentTurnIdx(userTurnIndices[0]);
              setTurnPhase('tts');
              setCurrentEval(null);
              speech.reset();
            }}
            style={{
              padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
            }}
          >
            <RotateCcw size={14} /> Try Again
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: 'var(--primary, #6366f1)', color: '#fff', cursor: 'pointer', fontSize: 13,
            }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // Walk-through view
  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>🗣️ Speak Through</h3>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}
          aria-label="Close speak through"
        >
          <X size={20} />
        </button>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
          <span>Turn {currentUserTurnOrder} of {totalUserTurns}</span>
          <span>{progressPct}%</span>
        </div>
        <div style={{
          height: 6, borderRadius: 3, background: 'var(--border, #e5e7eb)', overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', borderRadius: 3,
            background: 'var(--primary, #6366f1)',
            width: `${progressPct}%`,
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* AI message */}
      {turn?.assistant_message && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>🤖 AI said:</span>
            <button
              onClick={() => ttsSpeak(turn.assistant_message!)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', padding: 2 }}
              aria-label="Listen to AI message"
            >
              <Volume2 size={14} />
            </button>
          </div>
          <div style={{
            padding: 12, borderRadius: 10,
            background: 'var(--bg-card, #f3f4f6)', border: '1px solid var(--border)',
            fontSize: 14, color: 'var(--text)', lineHeight: 1.6,
          }}>
            {turn.assistant_message}
          </div>
        </div>
      )}

      {/* User response area */}
      <div style={{
        padding: 16, borderRadius: 12,
        background: 'var(--bg, #f8fafc)', border: '1px solid var(--border)',
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
          🗣️ Your response:
        </div>

        {/* TTS phase — prompt user to speak */}
        {turnPhase === 'tts' && (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Listen to the AI message above, then speak your response.
            </p>
            <button
              onClick={handleStartRecording}
              style={{
                padding: '10px 24px', borderRadius: 10, border: 'none',
                background: 'var(--primary, #6366f1)', color: '#fff', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600,
              }}
              disabled={!speech.isSupported}
              aria-label="Start recording"
            >
              <Mic size={16} /> Start Speaking
            </button>
            {!speech.isSupported && (
              <p style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>
                Speech recognition is not supported in this browser.
              </p>
            )}
          </div>
        )}

        {/* Recording phase */}
        {turnPhase === 'record' && (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: '#ef444420', border: '2px solid #ef4444',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 8, animation: 'pulse 1.5s ease-in-out infinite',
            }}>
              <Mic size={22} color="#ef4444" />
            </div>
            <p style={{ fontSize: 13, color: '#ef4444', fontWeight: 500, marginBottom: 8 }}>
              ● Listening...
            </p>
            {(speech.transcript || speech.interimTranscript) && (
              <p style={{
                fontSize: 14, color: 'var(--text)', fontStyle: 'italic',
                padding: '8px 12px', borderRadius: 8, background: 'var(--bg-card, white)',
                border: '1px solid var(--border)', marginBottom: 8,
              }}>
                "{speech.transcript}{speech.interimTranscript && (
                  <span style={{ color: 'var(--text-secondary)' }}>{speech.interimTranscript}</span>
                )}"
              </p>
            )}
            <button
              onClick={handleStopRecording}
              style={{
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: '#ef4444', color: '#fff', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13,
              }}
              aria-label="Stop recording"
            >
              <MicOff size={14} /> Done
            </button>
            {evalError && (
              <p style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>{evalError}</p>
            )}
          </div>
        )}

        {/* Evaluating phase */}
        {turnPhase === 'evaluating' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              border: '3px solid var(--primary, #6366f1)', borderTopColor: 'transparent',
              animation: 'spin 0.8s linear infinite',
              display: 'inline-block', marginBottom: 8,
            }} />
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Evaluating your response...</p>
          </div>
        )}

        {/* Feedback phase */}
        {turnPhase === 'feedback' && currentEval && (
          <div>
            {/* What you said */}
            <div style={{
              padding: 10, borderRadius: 8, marginBottom: 12,
              background: 'var(--bg-card, white)', border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>You said:</div>
              <div style={{ fontSize: 14, color: 'var(--text)' }}>"{speech.transcript}"</div>
            </div>

            {/* Score cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              {[
                { label: 'Overall', value: currentEval.overall_score },
                { label: 'Naturalness', value: currentEval.naturalness_score },
                { label: 'Variety', value: currentEval.variety_score },
              ].map((s) => (
                <div
                  key={s.label}
                  style={{
                    padding: 8, borderRadius: 8, textAlign: 'center',
                    background: 'var(--bg-card, white)', border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{s.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: scoreColor(s.value) }}>{s.value}/10</div>
                </div>
              ))}
              <div style={{
                padding: 8, borderRadius: 8, textAlign: 'center',
                background: 'var(--bg-card, white)', border: '1px solid var(--border)',
              }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Meaning</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: currentEval.meaning_preserved ? '#22c55e' : '#ef4444' }}>
                  {currentEval.meaning_preserved ? '✓ Preserved' : '✗ Changed'}
                </div>
              </div>
            </div>

            {/* Original comparison */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12,
            }}>
              <div style={{
                padding: 8, borderRadius: 8, background: '#3b82f610', border: '1px solid #3b82f630',
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#3b82f6', marginBottom: 4 }}>Your response</div>
                <div style={{ fontSize: 13, color: 'var(--text)' }}>{speech.transcript}</div>
              </div>
              <div style={{
                padding: 8, borderRadius: 8, background: '#22c55e10', border: '1px solid #22c55e30',
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#22c55e', marginBottom: 4 }}>Original</div>
                <div style={{ fontSize: 13, color: 'var(--text)' }}>{turn?.user_message}</div>
              </div>
            </div>

            {/* Feedback text */}
            {currentEval.feedback && (
              <p style={{ fontSize: 13, color: 'var(--text)', marginBottom: 12, lineHeight: 1.5 }}>
                💡 {currentEval.feedback}
              </p>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleRetryTurn}
                style={{
                  padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4, fontSize: 13,
                }}
              >
                <RotateCcw size={14} /> Retry
              </button>
              <button
                onClick={handleNextTurn}
                style={{
                  padding: '6px 14px', borderRadius: 8, border: 'none',
                  background: 'var(--primary, #6366f1)', color: '#fff', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4, fontSize: 13,
                }}
              >
                {userTurnIndices.indexOf(currentTurnIdx) < userTurnIndices.length - 1
                  ? <>Next Turn <ChevronRight size={14} /></>
                  : 'See Summary'}
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
