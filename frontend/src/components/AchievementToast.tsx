import { useEffect, useState } from 'react';
import { Award } from 'lucide-react';
import type { Achievement } from '../api';

interface AchievementToastProps {
  achievement: Achievement;
  index: number;
  onDismiss: (id: string) => void;
}

export function AchievementToast({ achievement, index, onDismiss }: AchievementToastProps) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const showTimer = setTimeout(() => setVisible(true), index * 400);
    const dismissTimer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onDismiss(achievement.id), 400);
    }, 5000 + index * 400);
    return () => { clearTimeout(showTimer); clearTimeout(dismissTimer); };
  }, [achievement.id, index, onDismiss]);

  const handleDismiss = () => {
    setExiting(true);
    setTimeout(() => onDismiss(achievement.id), 400);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={handleDismiss}
      style={{
        position: 'fixed',
        top: 16 + index * 80,
        right: visible && !exiting ? 16 : -400,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 20px',
        borderRadius: 12,
        background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
        border: '2px solid #f59e0b',
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        cursor: 'pointer',
        transition: 'right 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        maxWidth: 340,
        minWidth: 260,
      }}
    >
      <span style={{ fontSize: 32, flexShrink: 0 }}>{achievement.emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <Award size={14} color="#b45309" />
          <span style={{ fontSize: 11, fontWeight: 600, color: '#b45309', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Achievement Unlocked!
          </span>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#92400e' }}>
          {achievement.title}
        </div>
        <div style={{ fontSize: 12, color: '#a16207', marginTop: 2 }}>
          {achievement.description}
        </div>
      </div>
    </div>
  );
}

interface AchievementToastContainerProps {
  achievements: Achievement[];
}

const SEEN_KEY = 'seen_achievements';

function getSeenIds(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function markSeen(ids: string[]) {
  const existing = getSeenIds();
  const merged = Array.from(new Set([...existing, ...ids]));
  localStorage.setItem(SEEN_KEY, JSON.stringify(merged));
}

export function AchievementToastContainer({ achievements }: AchievementToastContainerProps) {
  const [toasts, setToasts] = useState<Achievement[]>([]);

  useEffect(() => {
    const unlocked = achievements.filter(a => a.unlocked);
    const seen = getSeenIds();
    const newlyUnlocked = unlocked.filter(a => !seen.includes(a.id));
    if (newlyUnlocked.length > 0) {
      setToasts(newlyUnlocked.slice(0, 3));
      markSeen(newlyUnlocked.map(a => a.id));
    }
  }, [achievements]);

  const handleDismiss = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return (
    <>
      {toasts.map((a, i) => (
        <AchievementToast key={a.id} achievement={a} index={i} onDismiss={handleDismiss} />
      ))}
    </>
  );
}
