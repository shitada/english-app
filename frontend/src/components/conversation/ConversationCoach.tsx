import { useState, useMemo } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ConversationCoachProps {
  messages: Message[];
  grammarCorrect: number;
  grammarTotal: number;
  wpmValues: number[];
}

interface Tip {
  id: string;
  emoji: string;
  text: string;
  priority: number;
}

export function ConversationCoach({ messages, grammarCorrect, grammarTotal, wpmValues }: ConversationCoachProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(false);

  const userMessages = useMemo(() => messages.filter((m) => m.role === 'user'), [messages]);

  const tip = useMemo(() => {
    if (userMessages.length < 2) return null;

    const tips: Tip[] = [];

    // Check question variety: no '?' in last 3+ user messages
    const recentUser = userMessages.slice(-3);
    if (recentUser.length >= 3 && !recentUser.some((m) => m.content.includes('?'))) {
      tips.push({ id: 'question', emoji: '❓', text: 'Try asking a follow-up question to keep the conversation flowing!', priority: 1 });
    }

    // Check message length: average below 6 words
    const wordCounts = userMessages.map((m) => m.content.trim().split(/\s+/).length);
    const avgWords = wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length;
    if (avgWords < 6 && userMessages.length >= 3) {
      tips.push({ id: 'length', emoji: '📝', text: 'Try adding more details to your responses — aim for longer sentences!', priority: 2 });
    }

    // Grammar streak: 100% after 3+ checked messages
    if (grammarTotal >= 3 && grammarCorrect === grammarTotal) {
      tips.push({ id: 'grammar-streak', emoji: '🌟', text: 'Perfect grammar streak! Try using more complex sentence structures.', priority: 3 });
    }

    // Complexity growth: message lengths increasing
    if (wordCounts.length >= 4) {
      const firstHalf = wordCounts.slice(0, Math.floor(wordCounts.length / 2));
      const secondHalf = wordCounts.slice(Math.floor(wordCounts.length / 2));
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      if (secondAvg > firstAvg * 1.3) {
        tips.push({ id: 'growth', emoji: '📈', text: 'Great progress! Your responses are getting more detailed.', priority: 4 });
      }
    }

    // Speaking pace feedback
    if (wpmValues.length >= 2) {
      const avgWpm = wpmValues.reduce((a, b) => a + b, 0) / wpmValues.length;
      if (avgWpm > 0 && avgWpm < 80) {
        tips.push({ id: 'pace-slow', emoji: '🗣️', text: 'Try speaking a bit faster — aim for a natural pace around 120 WPM.', priority: 5 });
      }
    }

    const available = tips.filter((t) => !dismissed.has(t.id));
    if (available.length === 0) return null;
    available.sort((a, b) => a.priority - b.priority);
    return available[0];
  }, [userMessages, grammarCorrect, grammarTotal, wpmValues, dismissed]);

  if (!tip) return null;

  return (
    <div style={{
      margin: '0 0 8px',
      padding: collapsed ? '6px 12px' : '10px 14px',
      background: 'var(--primary-light, #e8f0fe)',
      border: '1px solid var(--primary, #4285f4)',
      borderRadius: 10,
      fontSize: '0.85rem',
      position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand coach' : 'Collapse coach'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', padding: 0, color: 'var(--text-secondary)' }}
        >
          {collapsed ? '▶' : '▼'}
        </button>
        <span style={{ fontWeight: 600 }}>💡 Fluency Coach</span>
        {!collapsed && (
          <button
            onClick={() => setDismissed((prev) => new Set(prev).add(tip.id))}
            aria-label="Dismiss tip"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--text-secondary)' }}
          >
            ✕
          </button>
        )}
      </div>
      {!collapsed && (
        <div style={{ marginTop: 6, color: 'var(--text-primary)' }}>
          {tip.emoji} {tip.text}
        </div>
      )}
    </div>
  );
}
