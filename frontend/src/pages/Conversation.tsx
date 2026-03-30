import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Send, Square, Volume2, History } from 'lucide-react';
import { api, type GrammarFeedback, type ChatMessage, type ConversationListItem } from '../api';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  feedback?: GrammarFeedback;
}

const TOPIC_EMOJIS: Record<string, string> = {
  hotel_checkin: '🏨',
  restaurant_order: '🍽️',
  job_interview: '💼',
  doctor_visit: '🏥',
  shopping: '🛍️',
  airport: '✈️',
};

const DURATION = 5 * 60; // 5 minutes in seconds

type Difficulty = 'beginner' | 'intermediate' | 'advanced';

const DIFFICULTY_OPTIONS: { value: Difficulty; label: string; description: string }[] = [
  { value: 'beginner', label: '🌱 Beginner', description: 'Simple vocabulary, short sentences' },
  { value: 'intermediate', label: '📗 Intermediate', description: 'Natural conversation pace' },
  { value: 'advanced', label: '🚀 Advanced', description: 'Idioms, complex grammar, nuanced' },
];

export default function Conversation() {
  const [phase, setPhase] = useState<'select' | 'chat' | 'summary' | 'history'>('select');
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [summary, setSummary] = useState<any>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [pastConversations, setPastConversations] = useState<ConversationListItem[]>([]);
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([]);
  const [topics, setTopics] = useState<{ id: string; label: string; description: string }[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const speech = useSpeechRecognition({ continuous: true });
  const tts = useSpeechSynthesis();

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Timer
  useEffect(() => {
    if (phase === 'chat') {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [phase]);

  // Sync speech recognition transcript to input
  useEffect(() => {
    if (speech.transcript) {
      setInput(speech.transcript);
    }
  }, [speech.transcript]);

  // Fetch topics from API
  useEffect(() => {
    api.getConversationTopics()
      .then((data) => setTopics(data))
      .catch(() => {})
      .finally(() => setTopicsLoading(false));
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Load past conversations for history browsing
  useEffect(() => {
    api.listConversations().then((res) => {
      setPastConversations(res.conversations.filter((c) => c.status === 'ended'));
    }).catch(() => {});
  }, [phase]);

  const viewConversationHistory = async (id: number) => {
    try {
      const res = await api.getHistory(id);
      setHistoryMessages(res.messages);
      setPhase('history');
    } catch (err) {
      console.error(err);
    }
  };

  const startConversation = async (topicId: string) => {
    setLoading(true);
    try {
      const res = await api.startConversation(topicId, difficulty);
      setConversationId(res.conversation_id);
      setMessages([{ role: 'assistant', content: res.message }]);
      setPhase('chat');
      setTimeLeft(DURATION);
      tts.speak(res.message);
    } catch (err) {
      alert('Failed to start conversation. Make sure the backend is running.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || !conversationId || loading) return;

    // Stop recognition and capture current text before resetting
    speech.stop();
    const userMsg = input.trim();
    setInput('');
    speech.reset();
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const res = await api.sendMessage(conversationId, userMsg);
      setMessages((prev) => {
        const updated = [...prev];
        // Add feedback to the last user message
        const lastUser = updated.findLastIndex((m) => m.role === 'user');
        if (lastUser >= 0) {
          updated[lastUser] = { ...updated[lastUser], feedback: res.feedback };
        }
        // Add AI response
        updated.push({ role: 'assistant', content: res.message });
        return updated;
      });
      tts.speak(res.message);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const endConversation = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    try {
      const res = await api.endConversation(conversationId);
      setSummary(res.summary);
      setPhase('summary');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      clearInterval(timerRef.current);
    }
  }, [conversationId]);

  // Topic selection
  if (phase === 'select') {
    return (
      <div>
        <h2 style={{ marginBottom: 8 }}>Choose a Scenario</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
          Select a real-life scenario. AI will play a role and you'll practice the conversation.
        </p>
        {loading ? (
          <div className="loading">
            <div className="spinner" /> Setting up scenario...
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ marginBottom: 8, fontSize: '1rem' }}>Difficulty Level</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                {DIFFICULTY_OPTIONS.map((d) => (
                  <button
                    key={d.value}
                    onClick={() => setDifficulty(d.value)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: difficulty === d.value ? '2px solid var(--primary)' : '2px solid var(--border)',
                      background: difficulty === d.value ? 'var(--primary)' : 'transparent',
                      color: difficulty === d.value ? 'white' : 'var(--text)',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                    }}
                    title={d.description}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            {topicsLoading ? (
              <div className="topic-grid">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="skeleton skeleton-card" style={{ height: 100 }} />
                ))}
              </div>
            ) : (
              <div className="topic-grid">
                {topics.map((s) => (
                  <button
                    key={s.id}
                    className="topic-card"
                    onClick={() => startConversation(s.id)}
                  >
                    <h3>{TOPIC_EMOJIS[s.id] || '💬'} {s.label}</h3>
                    <p>{s.description}</p>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Past Conversations */}
        {pastConversations.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <h3 style={{ marginBottom: 12, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <History size={18} /> Past Conversations
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pastConversations.slice(0, 5).map((c) => {
                const topic = topics.find((t) => t.id === c.topic);
                return (
                  <button
                    key={c.id}
                    onClick={() => viewConversationHistory(c.id)}
                    style={{
                      padding: '12px 16px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--card-bg)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <strong>{TOPIC_EMOJIS[c.topic] || '💬'} {topic?.label || c.topic}</strong>
                      <span style={{ color: 'var(--text-secondary)', marginLeft: 8, fontSize: '0.85rem' }}>
                        {c.difficulty} · {c.message_count} messages
                      </span>
                    </div>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      {new Date(c.started_at).toLocaleDateString()}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // History view (read-only past conversation)
  if (phase === 'history') {
    return (
      <div>
        <button
          onClick={() => setPhase('select')}
          style={{ marginBottom: 16, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: 'var(--text)' }}
        >
          ← Back to scenarios
        </button>
        <h2 style={{ marginBottom: 16 }}>Conversation History</h2>
        <div className="chat-container" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {historyMessages.map((msg, i) => (
            <div key={i} className={`chat-message ${msg.role}`} style={{ marginBottom: 12 }}>
              <div className={`message-bubble ${msg.role}`}>
                <p>{msg.content}</p>
                {msg.feedback && !msg.feedback.is_correct && (
                  <div style={{ fontSize: '0.85rem', marginTop: 8, padding: 8, background: 'rgba(255,200,0,0.1)', borderRadius: 4 }}>
                    <strong>Correction:</strong> {msg.feedback.corrected_text}
                  </div>
                )}
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {new Date(msg.created_at).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Summary
  if (phase === 'summary' && summary) {
    return (
      <div className="card summary-card">
        <h2 style={{ marginBottom: 16 }}>Conversation Complete!</h2>
        <p style={{ marginBottom: 16 }}>{summary.summary}</p>

        {summary.key_vocabulary?.length > 0 && (
          <>
            <h4>Key Vocabulary</h4>
            <div className="vocab-tags">
              {summary.key_vocabulary.map((w: string) => (
                <span key={w}>{w}</span>
              ))}
            </div>
          </>
        )}

        <p style={{ marginBottom: 8 }}>
          <strong>Level:</strong> {summary.communication_level}
        </p>
        <p style={{ marginBottom: 24, color: 'var(--primary-dark)' }}>
          <strong>Tip:</strong> {summary.tip}
        </p>

        <button className="btn btn-primary" onClick={() => {
          setPhase('select');
          setMessages([]);
          setSummary(null);
          setConversationId(null);
        }}>
          Start New Conversation
        </button>
      </div>
    );
  }

  // Chat
  const timerClass = timeLeft <= 30 ? 'danger' : timeLeft <= 60 ? 'warning' : '';

  return (
    <div className="chat-container">
      <div className="chat-header">
        <span style={{ fontWeight: 600 }}>Role Play Scenario</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Volume2 size={14} color="var(--text-secondary)" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={tts.volume}
              onChange={(e) => tts.setVolume(parseFloat(e.target.value))}
              aria-label="Volume"
              style={{ width: 60, accentColor: 'var(--primary)' }}
            />
          </div>
          <span className={`timer ${timerClass}`}>{formatTime(timeLeft)}</span>
          <button className="btn btn-danger btn-sm" onClick={endConversation} disabled={loading} aria-label="End conversation">
            <Square size={14} /> End
          </button>
        </div>
      </div>

      <div className="chat-messages" role="log" aria-live="polite">
        {messages.map((msg, i) => (
          <div key={i}>
            <div className={`message message-${msg.role}`}>
              {msg.content}
            </div>
            {msg.feedback && <FeedbackPanel feedback={msg.feedback} />}
          </div>
        ))}
        {loading && (
          <div className="message message-assistant">
            <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2, margin: 0 }} />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {speech.error && (
        <div style={{ padding: '8px 16px', background: '#fef2f2', color: '#b91c1c', fontSize: 13, borderTop: '1px solid #fecaca' }}>
          {speech.error}
        </div>
      )}
      <div className="chat-input-bar" style={{ gap: 12, alignItems: 'center' }}>
        <button
          className={`btn btn-icon ${speech.isListening ? 'mic-active' : 'btn-secondary'}`}
          onClick={speech.isListening ? speech.stop : speech.start}
          disabled={!speech.isSupported || loading}
          title={speech.isSupported ? (speech.isListening ? 'Stop listening' : 'Start speaking') : 'Speech recognition not supported'}
          aria-label={speech.isListening ? 'Stop listening' : 'Start speaking'}
          style={{ width: 48, height: 48, flexShrink: 0 }}
        >
          {speech.isListening ? <MicOff size={22} color="white" /> : <Mic size={22} />}
        </button>

        <div style={{ flex: 1, position: 'relative' }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && input.trim() && !loading) sendMessage(); }}
            placeholder={speech.isListening ? 'Listening...' : 'Type your message or use the mic'}
            disabled={loading}
            aria-label="Message input"
            style={{
              width: '100%',
              padding: '10px 14px',
              fontSize: 14,
              border: '1px solid var(--border, #e2e8f0)',
              borderRadius: 8,
              outline: 'none',
              background: 'var(--bg, #fff)',
              color: 'var(--text)',
            }}
          />
          {speech.interimTranscript && (
            <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--text-secondary)', pointerEvents: 'none' }}>
              {speech.interimTranscript}
            </span>
          )}
        </div>

        <button
          className="btn btn-primary btn-icon"
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          aria-label="Send message"
          style={{ width: 48, height: 48, flexShrink: 0 }}
        >
          <Send size={22} />
        </button>
      </div>
    </div>
  );
}

function FeedbackPanel({ feedback }: { feedback: GrammarFeedback }) {
  const [expanded, setExpanded] = useState(true);

  if (feedback.is_correct && feedback.suggestions.length === 0) {
    return (
      <div className="feedback-panel correct">
        ✅ Great! Your English is correct.
      </div>
    );
  }

  return (
    <div className="feedback-panel" onClick={() => setExpanded(!expanded)}>
      <div style={{ cursor: 'pointer', fontWeight: 600, marginBottom: expanded ? 8 : 0 }}>
        {feedback.is_correct ? '💡 Suggestions' : '📝 Corrections & Suggestions'}
        <span style={{ float: 'right', fontSize: 12 }}>{expanded ? '▼' : '▶'}</span>
      </div>
      {expanded && (
        <>
          {feedback.errors.map((err, i) => (
            <div key={i} className="feedback-error">
              <strong>{err.original}</strong> → <em>{err.correction}</em>
              <br />
              <span style={{ fontSize: 12 }}>{err.explanation}</span>
            </div>
          ))}
          {feedback.suggestions.map((sug, i) => (
            <div key={i} className="feedback-suggestion">
              💡 "{sug.original}" → <em>"{sug.better}"</em>
              <br />
              <span style={{ fontSize: 12 }}>{sug.explanation}</span>
            </div>
          ))}
          {feedback.corrected_text && !feedback.is_correct && (
            <div style={{ marginTop: 8, padding: '6px 10px', background: '#fefce8', borderRadius: 6, fontSize: 12 }}>
              ✏️ <strong>Corrected:</strong> {feedback.corrected_text}
            </div>
          )}
        </>
      )}
    </div>
  );
}
