import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Send, Square, Volume2 } from 'lucide-react';
import { api, type GrammarFeedback } from '../api';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  feedback?: GrammarFeedback;
}

const SCENARIOS = [
  { id: 'hotel_checkin', label: 'Hotel Check-in', description: 'Check into a hotel, ask about amenities', emoji: '🏨' },
  { id: 'restaurant_order', label: 'Restaurant Order', description: 'Order food, ask about the menu, pay the bill', emoji: '🍽️' },
  { id: 'job_interview', label: 'Job Interview', description: 'Answer interview questions, discuss experience', emoji: '💼' },
  { id: 'doctor_visit', label: 'Doctor Visit', description: 'Describe symptoms, understand the diagnosis', emoji: '🏥' },
  { id: 'shopping', label: 'Shopping', description: 'Ask about products, sizes, prices, returns', emoji: '🛍️' },
  { id: 'airport', label: 'At the Airport', description: 'Check-in, go through security, find the gate', emoji: '✈️' },
];

const DURATION = 5 * 60; // 5 minutes in seconds

export default function Conversation() {
  const [phase, setPhase] = useState<'select' | 'chat' | 'summary'>('select');
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [summary, setSummary] = useState<any>(null);

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

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const startConversation = async (topicId: string) => {
    setLoading(true);
    try {
      const res = await api.startConversation(topicId);
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
          <div className="topic-grid">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                className="topic-card"
                onClick={() => startConversation(s.id)}
              >
                <h3>{s.emoji} {s.label}</h3>
                <p>{s.description}</p>
              </button>
            ))}
          </div>
        )}
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
              style={{ width: 60, accentColor: 'var(--primary)' }}
            />
          </div>
          <span className={`timer ${timerClass}`}>{formatTime(timeLeft)}</span>
          <button className="btn btn-danger btn-sm" onClick={endConversation} disabled={loading}>
            <Square size={14} /> End
          </button>
        </div>
      </div>

      <div className="chat-messages">
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
      <div className="chat-input-bar" style={{ justifyContent: 'center', gap: 16 }}>
        <button
          className={`btn btn-icon ${speech.isListening ? 'mic-active' : 'btn-secondary'}`}
          onClick={speech.isListening ? speech.stop : speech.start}
          disabled={!speech.isSupported || loading}
          title={speech.isSupported ? (speech.isListening ? 'Stop listening' : 'Start speaking') : 'Speech recognition not supported'}
          style={{ width: 56, height: 56 }}
        >
          {speech.isListening ? <MicOff size={24} color="white" /> : <Mic size={24} />}
        </button>

        {/* Show transcript preview */}
        {(speech.transcript || speech.interimTranscript) && (
          <div style={{ flex: 1, fontSize: 14, color: 'var(--text)', padding: '8px 0' }}>
            {speech.transcript}
            <span style={{ color: 'var(--text-secondary)' }}>{speech.interimTranscript}</span>
          </div>
        )}

        <button
          className="btn btn-primary btn-icon"
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          style={{ width: 56, height: 56 }}
        >
          <Send size={24} />
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
