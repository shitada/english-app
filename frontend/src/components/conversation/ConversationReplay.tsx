import { useState, useCallback, useEffect } from 'react';
import { Volume2, ChevronLeft, ChevronRight, Mic, Square, RotateCcw } from 'lucide-react';
import type { ReplayTurn } from '../../api';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';

interface ConversationReplayProps {
  turns: ReplayTurn[];
  replayIndex: number;
  setReplayIndex: React.Dispatch<React.SetStateAction<number>>;
  onBack: () => void;
  tts: { speak: (text: string) => void; isSpeaking: boolean };
}

function computeSimilarity(spoken: string, original: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  const spokenWords = normalize(spoken);
  const originalWords = normalize(original);
  if (originalWords.length === 0) return 0;
  const originalSet = new Set(originalWords);
  const matched = spokenWords.filter(w => originalSet.has(w)).length;
  return Math.min(100, Math.round((matched / originalWords.length) * 100));
}

export function ConversationReplay({ turns, replayIndex, setReplayIndex, onBack, tts }: ConversationReplayProps) {
  const turn = turns[replayIndex];
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });

  const [practiceMode, setPracticeMode] = useState(false);
  const [practicePhase, setPracticePhase] = useState<'hidden' | 'speaking' | 'revealed'>('hidden');
  const [spokenText, setSpokenText] = useState('');
  // Track which turns have been practiced and their scores
  const [practiceScores, setPracticeScores] = useState<Record<number, number>>({});

  const userTurns = turns.filter(t => t.user_message);
  const practicedCount = Object.keys(practiceScores).length;
  const totalScore = practicedCount > 0
    ? Math.round(Object.values(practiceScores).reduce((a, b) => a + b, 0) / practicedCount)
    : 0;

  const startSpeaking = useCallback(() => {
    setPracticePhase('speaking');
    setSpokenText('');
    speech.reset?.();
    speech.start();
  }, [speech]);

  const stopSpeaking = useCallback(() => {
    speech.stop();
  }, [speech]);

  // When speech ends, capture result
  useEffect(() => {
    if (practicePhase === 'speaking' && !speech.isListening && speech.transcript) {
      const transcript = speech.transcript;
      setSpokenText(transcript);
      setPracticePhase('revealed');
      if (turn?.user_message) {
        const sim = computeSimilarity(transcript, turn.user_message);
        setPracticeScores(prev => ({ ...prev, [replayIndex]: sim }));
      }
    }
  }, [practicePhase, speech.isListening, speech.transcript, turn, replayIndex]);

  const handleNav = useCallback((newIndex: number) => {
    setReplayIndex(newIndex);
    setPracticePhase('hidden');
    setSpokenText('');
    speech.reset?.();
  }, [setReplayIndex, speech]);

  const similarityColor = (pct: number) =>
    pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={onBack}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: 'var(--text)' }}
        >
          ← Back to history
        </button>
        <button
          onClick={() => {
            setPracticeMode(!practiceMode);
            setPracticePhase('hidden');
            setSpokenText('');
            setPracticeScores({});
          }}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: practiceMode ? 'var(--primary, #6366f1)' : 'var(--card-bg, #f3f4f6)',
            color: practiceMode ? '#fff' : 'var(--text)',
            fontWeight: 600, fontSize: '0.85rem',
          }}
        >
          🎙️ {practiceMode ? 'Exit Practice' : 'Practice Speaking'}
        </button>
      </div>

      <h2 style={{ marginBottom: 8 }}>Conversation Replay</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary, #6b7280)', marginBottom: 16 }}>
        Turn {replayIndex + 1} of {turns.length}
        {practiceMode && (
          <span style={{ marginLeft: 12, fontWeight: 600, color: 'var(--primary, #6366f1)' }}>
            🎯 Practice Mode
          </span>
        )}
      </p>

      {turn && (
        <div className="card" style={{ padding: '1.5rem', marginBottom: 16 }}>
          {turn.assistant_message && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <strong style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>🤖 Assistant</strong>
                <button
                  onClick={() => tts.speak(turn.assistant_message!)}
                  disabled={tts.isSpeaking}
                  style={{ background: 'none', border: 'none', cursor: tts.isSpeaking ? 'default' : 'pointer', padding: 2, opacity: tts.isSpeaking ? 0.4 : 1 }}
                  aria-label="Listen to assistant message"
                >
                  <Volume2 size={16} color="var(--primary, #6366f1)" />
                </button>
              </div>
              <div className="message-bubble assistant" style={{ marginBottom: 0 }}>
                <p>{turn.assistant_message}</p>
              </div>
            </div>
          )}

          {turn.user_message && (
            <div style={{ marginBottom: turn.corrections.length > 0 ? 16 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <strong style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>🗣️ You said</strong>
                {(!practiceMode || practicePhase === 'revealed') && (
                  <button
                    onClick={() => tts.speak(turn.user_message!)}
                    disabled={tts.isSpeaking}
                    style={{ background: 'none', border: 'none', cursor: tts.isSpeaking ? 'default' : 'pointer', padding: 2, opacity: tts.isSpeaking ? 0.4 : 1 }}
                    aria-label="Listen to your message"
                  >
                    <Volume2 size={16} color="var(--primary, #6366f1)" />
                  </button>
                )}
              </div>

              {practiceMode && practicePhase !== 'revealed' ? (
                <div style={{
                  position: 'relative', borderRadius: 12, overflow: 'hidden',
                  border: '1px solid var(--border)', padding: 16, textAlign: 'center',
                  background: 'var(--card-bg, #f9fafb)',
                }}>
                  {practicePhase === 'hidden' && (
                    <>
                      <div style={{
                        filter: 'blur(8px)', userSelect: 'none', pointerEvents: 'none',
                        color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 12,
                      }}>
                        {turn.user_message}
                      </div>
                      <button
                        onClick={startSpeaking}
                        className="btn btn-primary"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 20px' }}
                      >
                        <Mic size={16} /> Speak from Memory
                      </button>
                    </>
                  )}

                  {practicePhase === 'speaking' && (
                    <>
                      <div style={{
                        filter: 'blur(8px)', userSelect: 'none', pointerEvents: 'none',
                        color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 12,
                      }}>
                        {turn.user_message}
                      </div>
                      <div style={{
                        width: 48, height: 48, borderRadius: '50%',
                        background: '#ef444420', border: '2px solid #ef4444',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        marginBottom: 8, animation: 'pulse 1.5s ease-in-out infinite',
                      }}>
                        <Mic size={20} color="#ef4444" />
                      </div>
                      {speech.transcript && (
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic', marginBottom: 8 }}>
                          "{speech.transcript}"
                        </p>
                      )}
                      <button
                        onClick={stopSpeaking}
                        className="btn btn-primary"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      >
                        <Square size={14} /> Done
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div className="message-bubble user" style={{ marginBottom: 0 }}>
                  <p>{turn.user_message}</p>
                </div>
              )}

              {/* Side-by-side comparison after speaking */}
              {practiceMode && practicePhase === 'revealed' && spokenText && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <div style={{
                      padding: 10, borderRadius: 8, fontSize: '0.82rem',
                      background: '#3b82f610', border: '1px solid #3b82f630',
                    }}>
                      <div style={{ fontWeight: 600, fontSize: '0.7rem', color: '#3b82f6', marginBottom: 4 }}>Your recall</div>
                      <div style={{ color: 'var(--text-secondary)' }}>{spokenText}</div>
                    </div>
                    <div style={{
                      padding: 10, borderRadius: 8, fontSize: '0.82rem',
                      background: '#22c55e10', border: '1px solid #22c55e30',
                    }}>
                      <div style={{ fontWeight: 600, fontSize: '0.7rem', color: '#22c55e', marginBottom: 4 }}>Original</div>
                      <div style={{ color: 'var(--text-secondary)' }}>{turn.user_message}</div>
                    </div>
                  </div>
                  {(() => {
                    const sim = practiceScores[replayIndex] ?? 0;
                    return (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 12px', borderRadius: 8,
                        background: `${similarityColor(sim)}10`,
                        border: `1px solid ${similarityColor(sim)}30`,
                      }}>
                        <span style={{ fontWeight: 700, color: similarityColor(sim), fontSize: '1rem' }}>{sim}%</span>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>word similarity</span>
                        <button
                          onClick={() => { setPracticePhase('hidden'); setSpokenText(''); }}
                          style={{
                            marginLeft: 'auto', background: 'none', border: 'none',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                            fontSize: '0.75rem', color: 'var(--primary, #6366f1)',
                          }}
                        >
                          <RotateCcw size={12} /> Retry
                        </button>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {turn.corrections.length > 0 && (
            <div style={{ padding: '0.75rem', background: 'rgba(255,200,0,0.1)', borderRadius: 8 }}>
              <strong style={{ fontSize: '0.85rem' }}>📝 Corrections</strong>
              {turn.corrections.map((c, i) => (
                <div key={i} style={{ fontSize: '0.85rem', marginTop: 6 }}>
                  <span style={{ color: 'var(--danger, #ef4444)', textDecoration: 'line-through' }}>{c.original}</span>
                  {' → '}
                  <span style={{ color: 'var(--success, #10b981)', fontWeight: 600 }}>{c.correction}</span>
                  {c.explanation && <p style={{ margin: '2px 0 0', color: 'var(--text-secondary)' }}>{c.explanation}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Session score in practice mode */}
      {practiceMode && practicedCount > 0 && (
        <div style={{
          padding: '10px 16px', borderRadius: 8, marginBottom: 16,
          background: 'var(--card-bg, #f9fafb)', border: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: '0.82rem',
        }}>
          <span style={{ color: 'var(--text-secondary)' }}>
            Practiced {practicedCount} of {userTurns.length} turns
          </span>
          <span style={{ fontWeight: 700, color: similarityColor(totalScore) }}>
            Avg: {totalScore}% match
          </span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, alignItems: 'center' }}>
        <button
          onClick={() => handleNav(Math.max(0, replayIndex - 1))}
          disabled={replayIndex === 0}
          style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid var(--border)', cursor: replayIndex === 0 ? 'not-allowed' : 'pointer', background: 'transparent', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 4, opacity: replayIndex === 0 ? 0.4 : 1 }}
        >
          <ChevronLeft size={18} /> Previous
        </button>
        <button
          onClick={() => handleNav(Math.min(turns.length - 1, replayIndex + 1))}
          disabled={replayIndex >= turns.length - 1}
          style={{ padding: '10px 20px', borderRadius: 8, border: 'none', cursor: replayIndex >= turns.length - 1 ? 'not-allowed' : 'pointer', background: 'var(--primary, #6366f1)', color: '#fff', display: 'flex', alignItems: 'center', gap: 4, opacity: replayIndex >= turns.length - 1 ? 0.4 : 1 }}
        >
          Next <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
