import { useState, useMemo } from 'react';
import { Target, Check, X } from 'lucide-react';

interface GoalDefinition {
  id: string;
  label: string;
  emoji: string;
  description: string;
  evaluate: (messages: { role: string; content: string }[]) => { achieved: boolean; progress: string };
}

const GOAL_DEFINITIONS: GoalDefinition[] = [
  {
    id: 'ask_questions',
    label: 'Ask follow-up questions',
    emoji: '❓',
    description: 'Ask at least 3 questions during the conversation',
    evaluate: (msgs) => {
      const count = msgs.filter(m => m.role === 'user' && m.content.includes('?')).length;
      return { achieved: count >= 3, progress: `${count}/3` };
    },
  },
  {
    id: 'longer_sentences',
    label: 'Use longer sentences',
    emoji: '📝',
    description: 'Average 12+ words per message',
    evaluate: (msgs) => {
      const userMsgs = msgs.filter(m => m.role === 'user');
      if (userMsgs.length === 0) return { achieved: false, progress: '0/12' };
      const avg = Math.round(userMsgs.reduce((s, m) => s + m.content.split(/\s+/).length, 0) / userMsgs.length);
      return { achieved: avg >= 12, progress: `${avg}/12` };
    },
  },
  {
    id: 'varied_starters',
    label: 'Vary sentence starters',
    emoji: '🔀',
    description: 'Use 4+ different sentence starters',
    evaluate: (msgs) => {
      const starters = new Set(
        msgs.filter(m => m.role === 'user').map(m => m.content.trim().split(/\s+/)[0]?.toLowerCase()).filter(Boolean)
      );
      return { achieved: starters.size >= 4, progress: `${starters.size}/4` };
    },
  },
  {
    id: 'express_opinions',
    label: 'Express opinions',
    emoji: '💬',
    description: 'Use opinion phrases at least twice (I think, I believe, I feel...)',
    evaluate: (msgs) => {
      const pattern = /\b(i think|i believe|i feel|in my opinion|i'd say|i suppose|i reckon)\b/i;
      const count = msgs.filter(m => m.role === 'user' && pattern.test(m.content)).length;
      return { achieved: count >= 2, progress: `${count}/2` };
    },
  },
  {
    id: 'use_connectors',
    label: 'Use linking words',
    emoji: '🔗',
    description: 'Use connectors like however, moreover, although at least 3 times',
    evaluate: (msgs) => {
      const pattern = /\b(however|moreover|although|furthermore|nevertheless|therefore|meanwhile|consequently|in addition|on the other hand)\b/i;
      const count = msgs.filter(m => m.role === 'user' && pattern.test(m.content)).length;
      return { achieved: count >= 3, progress: `${count}/3` };
    },
  },
];

interface GoalSelectorProps {
  selectedGoals: string[];
  onToggleGoal: (goalId: string) => void;
}

export function GoalSelector({ selectedGoals, onToggleGoal }: GoalSelectorProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ marginBottom: 24 }}>
      <h3
        style={{ marginBottom: 8, fontSize: '1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        onClick={() => setExpanded(!expanded)}
      >
        <Target size={16} /> Session Goals {selectedGoals.length > 0 && `(${selectedGoals.length})`}
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{expanded ? '▲' : '▼'}</span>
      </h3>
      {expanded && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {GOAL_DEFINITIONS.map(goal => {
            const selected = selectedGoals.includes(goal.id);
            return (
              <button
                key={goal.id}
                onClick={() => onToggleGoal(goal.id)}
                disabled={!selected && selectedGoals.length >= 3}
                title={goal.description}
                style={{
                  padding: '6px 12px',
                  borderRadius: 20,
                  border: selected ? '2px solid var(--primary)' : '2px solid var(--border)',
                  background: selected ? 'var(--primary)' : 'transparent',
                  color: selected ? 'white' : 'var(--text)',
                  cursor: !selected && selectedGoals.length >= 3 ? 'not-allowed' : 'pointer',
                  opacity: !selected && selectedGoals.length >= 3 ? 0.5 : 1,
                  fontSize: '0.85rem',
                  transition: 'all 0.2s',
                }}
              >
                {goal.emoji} {goal.label}
              </button>
            );
          })}
        </div>
      )}
      {expanded && selectedGoals.length === 0 && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 4 }}>
          Select up to 3 goals to focus on during your conversation.
        </p>
      )}
    </div>
  );
}

interface GoalTrackerProps {
  selectedGoals: string[];
  messages: { role: string; content: string }[];
}

export function GoalTracker({ selectedGoals, messages }: GoalTrackerProps) {
  const results = useMemo(() => {
    return selectedGoals.map(goalId => {
      const def = GOAL_DEFINITIONS.find(g => g.id === goalId);
      if (!def) return null;
      const result = def.evaluate(messages);
      return { ...def, ...result };
    }).filter(Boolean) as (GoalDefinition & { achieved: boolean; progress: string })[];
  }, [selectedGoals, messages]);

  if (results.length === 0) return null;

  return (
    <div style={{
      display: 'flex', gap: 12, padding: '8px 16px', margin: '0 0 8px',
      background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8, flexWrap: 'wrap',
      fontSize: '0.8rem',
    }}>
      <span style={{ fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
        <Target size={12} /> Goals:
      </span>
      {results.map(r => (
        <span
          key={r.id}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            color: r.achieved ? 'var(--success, #22c55e)' : 'var(--text-secondary)',
          }}
        >
          {r.emoji} {r.progress} {r.achieved ? '✓' : ''}
        </span>
      ))}
    </div>
  );
}

interface GoalSummaryProps {
  selectedGoals: string[];
  messages: { role: string; content: string }[];
}

export function GoalSummary({ selectedGoals, messages }: GoalSummaryProps) {
  const results = useMemo(() => {
    return selectedGoals.map(goalId => {
      const def = GOAL_DEFINITIONS.find(g => g.id === goalId);
      if (!def) return null;
      const result = def.evaluate(messages);
      return { ...def, ...result };
    }).filter(Boolean) as (GoalDefinition & { achieved: boolean; progress: string })[];
  }, [selectedGoals, messages]);

  if (results.length === 0) return null;

  const achievedCount = results.filter(r => r.achieved).length;

  return (
    <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8 }}>
      <h4 style={{ marginBottom: 10, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Target size={14} /> Session Goals — {achievedCount}/{results.length} achieved
      </h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {results.map(r => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            {r.achieved
              ? <Check size={14} color="var(--success, #22c55e)" />
              : <X size={14} color="var(--danger, #ef4444)" />}
            <span style={{ color: r.achieved ? 'var(--success, #22c55e)' : 'var(--text)' }}>
              {r.emoji} {r.label}: {r.progress}
            </span>
          </div>
        ))}
      </div>
      {achievedCount === results.length && results.length > 0 && (
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--success, #22c55e)', fontWeight: 600 }}>
          🎉 All goals achieved! Great focus!
        </p>
      )}
      {achievedCount > 0 && achievedCount < results.length && (
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
          Keep practicing — you're making progress!
        </p>
      )}
    </div>
  );
}
