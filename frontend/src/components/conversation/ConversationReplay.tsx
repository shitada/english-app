import { Volume2, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReplayTurn } from '../../api';

interface ConversationReplayProps {
  turns: ReplayTurn[];
  replayIndex: number;
  setReplayIndex: React.Dispatch<React.SetStateAction<number>>;
  onBack: () => void;
  tts: { speak: (text: string) => void; isSpeaking: boolean };
}

export function ConversationReplay({ turns, replayIndex, setReplayIndex, onBack, tts }: ConversationReplayProps) {
  const turn = turns[replayIndex];
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={onBack}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: 'var(--text)' }}
        >
          ← Back to history
        </button>
      </div>
      <h2 style={{ marginBottom: 8 }}>Conversation Replay</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary, #6b7280)', marginBottom: 16 }}>
        Turn {replayIndex + 1} of {turns.length}
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
                <button
                  onClick={() => tts.speak(turn.user_message!)}
                  disabled={tts.isSpeaking}
                  style={{ background: 'none', border: 'none', cursor: tts.isSpeaking ? 'default' : 'pointer', padding: 2, opacity: tts.isSpeaking ? 0.4 : 1 }}
                  aria-label="Listen to your message"
                >
                  <Volume2 size={16} color="var(--primary, #6366f1)" />
                </button>
              </div>
              <div className="message-bubble user" style={{ marginBottom: 0 }}>
                <p>{turn.user_message}</p>
              </div>
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

      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, alignItems: 'center' }}>
        <button
          onClick={() => setReplayIndex(i => Math.max(0, i - 1))}
          disabled={replayIndex === 0}
          style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid var(--border)', cursor: replayIndex === 0 ? 'not-allowed' : 'pointer', background: 'transparent', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 4, opacity: replayIndex === 0 ? 0.4 : 1 }}
        >
          <ChevronLeft size={18} /> Previous
        </button>
        <button
          onClick={() => setReplayIndex(i => Math.min(turns.length - 1, i + 1))}
          disabled={replayIndex >= turns.length - 1}
          style={{ padding: '10px 20px', borderRadius: 8, border: 'none', cursor: replayIndex >= turns.length - 1 ? 'not-allowed' : 'pointer', background: 'var(--primary, #6366f1)', color: '#fff', display: 'flex', alignItems: 'center', gap: 4, opacity: replayIndex >= turns.length - 1 ? 0.4 : 1 }}
        >
          Next <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
