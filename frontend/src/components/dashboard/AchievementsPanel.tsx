import { Award } from 'lucide-react';
import type { Achievement } from '../../api';

interface AchievementsPanelProps {
  achievements: Achievement[];
  unlocked: number;
  total: number;
}

export function AchievementsPanel({ achievements, unlocked, total }: AchievementsPanelProps) {
  if (achievements.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Award size={20} color="#f59e0b" />
        <h3 style={{ margin: 0 }}>Achievements</h3>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {unlocked}/{total} earned
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
        {achievements.map(a => (
          <div key={a.id} style={{
            padding: '10px', borderRadius: 8, textAlign: 'center',
            background: a.unlocked ? 'linear-gradient(135deg, #fef3c7, #fde68a)' : 'var(--bg-secondary, #f3f4f6)',
            opacity: a.unlocked ? 1 : 0.6,
            border: a.unlocked ? '1px solid #f59e0b' : '1px solid var(--border)',
          }}>
            <div style={{ fontSize: 28 }}>{a.emoji}</div>
            <p style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{a.title}</p>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{a.description}</p>
            {!a.unlocked && (
              <div style={{ marginTop: 4, height: 4, borderRadius: 2, background: '#e5e7eb', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 2, background: '#f59e0b', width: `${Math.min(100, (a.progress.current / a.progress.target) * 100)}%` }} />
              </div>
            )}
            {!a.unlocked && (
              <p style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{a.progress.current}/{a.progress.target}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
