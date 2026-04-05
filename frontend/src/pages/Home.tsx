import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, Mic, BookOpen, BarChart3, Flame, AlertTriangle, Target } from 'lucide-react';
import { getLearningInsights, getLearningGoals, type LearningInsights, type LearningGoal } from '../api';

function mapRecommendationToRoute(rec: string): string | null {
  const lower = rec.toLowerCase();
  if (lower.includes('vocab') || lower.includes('word')) return '/vocabulary';
  if (lower.includes('pronunc') || lower.includes('speak')) return '/pronunciation';
  if (lower.includes('conversation') || lower.includes('chat')) return '/conversation';
  return null;
}

function GoalProgressBar({ goal }: { goal: LearningGoal }) {
  const pct = Math.min(100, Math.round((goal.today_count / goal.daily_target) * 100));
  const label = goal.goal_type.replace(/_/g, ' ');
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 2 }}>
        <span style={{ textTransform: 'capitalize' }}>{label}</span>
        <span>{goal.today_count}/{goal.daily_target}{goal.completed ? ' ✓' : ''}</span>
      </div>
      <div style={{ background: 'var(--border, #e5e7eb)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: goal.completed ? 'var(--success, #10b981)' : 'var(--primary, #6366f1)',
          borderRadius: 4,
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  );
}

function DailyPracticeCard() {
  const [insights, setInsights] = useState<LearningInsights | null>(null);
  const [goals, setGoals] = useState<LearningGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.allSettled([getLearningInsights(), getLearningGoals()])
      .then(([insightsResult, goalsResult]) => {
        if (insightsResult.status === 'fulfilled') setInsights(insightsResult.value);
        if (goalsResult.status === 'fulfilled') setGoals(goalsResult.value);
        if (insightsResult.status === 'rejected' && goalsResult.status === 'rejected') setError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  if (error) return null;

  if (loading) {
    return (
      <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ height: 20, width: '40%', background: 'var(--border, #e5e7eb)', borderRadius: 4, marginBottom: 12 }} />
        <div style={{ height: 12, width: '70%', background: 'var(--border, #e5e7eb)', borderRadius: 4, marginBottom: 8 }} />
        <div style={{ height: 12, width: '55%', background: 'var(--border, #e5e7eb)', borderRadius: 4 }} />
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
      <h3 style={{ margin: '0 0 1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Target size={20} color="var(--primary, #6366f1)" />
        Today's Practice
      </h3>

      {insights && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem', padding: '0.75rem', background: insights.streak_at_risk ? 'var(--danger-bg, #fef2f2)' : 'var(--success-bg, #f0fdf4)', borderRadius: 8 }}>
          {insights.streak_at_risk
            ? <AlertTriangle size={20} color="var(--danger, #ef4444)" />
            : <Flame size={20} color="var(--warning, #f59e0b)" />
          }
          <div>
            <strong>{insights.streak} day streak</strong>
            {insights.streak_at_risk && (
              <span style={{ color: 'var(--danger, #ef4444)', fontSize: '0.85rem', marginLeft: 8 }}>
                Complete an activity to keep it!
              </span>
            )}
          </div>
        </div>
      )}

      {goals.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary, #6b7280)' }}>Daily Goals</h4>
          {goals.map(g => <GoalProgressBar key={g.id} goal={g} />)}
        </div>
      )}

      {insights && insights.recommendations.length > 0 && (
        <div>
          <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary, #6b7280)' }}>Recommendations</h4>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {insights.recommendations.map((rec, i) => {
              const route = mapRecommendationToRoute(rec);
              return (
                <li key={i} style={{ fontSize: '0.9rem' }}>
                  {route ? (
                    <Link to={route} style={{ color: 'var(--primary, #6366f1)', textDecoration: 'none' }}>
                      → {rec}
                    </Link>
                  ) : (
                    <span>→ {rec}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <div>
      <div className="home-hero">
        <h2>Improve Your English</h2>
        <p>Practice conversations, pronunciation, and vocabulary with AI</p>
      </div>

      <DailyPracticeCard />

      <div className="feature-grid">
        <Link to="/conversation" className="feature-card">
          <div className="icon" style={{ background: '#eef2ff' }}>
            <MessageSquare size={28} color="#6366f1" />
          </div>
          <h3>Conversation</h3>
          <p>
            Practice real-life scenarios like hotel check-in, job interviews, and
            restaurant orders with AI role play.
          </p>
        </Link>

        <Link to="/pronunciation" className="feature-card">
          <div className="icon" style={{ background: '#fef3c7' }}>
            <Mic size={28} color="#f59e0b" />
          </div>
          <h3>Pronunciation</h3>
          <p>
            Shadowing practice: listen to a sentence, then repeat it
            immediately. Get feedback on accuracy and fluency.
          </p>
        </Link>

        <Link to="/vocabulary" className="feature-card">
          <div className="icon" style={{ background: '#d1fae5' }}>
            <BookOpen size={28} color="#10b981" />
          </div>
          <h3>Vocabulary</h3>
          <p>
            Learn scenario-specific words and phrases in context through
            interactive quizzes with real-life examples.
          </p>
        </Link>

        <Link to="/dashboard" className="feature-card">
          <div className="icon" style={{ background: '#f3e8ff' }}>
            <BarChart3 size={28} color="#8b5cf6" />
          </div>
          <h3>Dashboard</h3>
          <p>
            Track your learning streak, view statistics, and see your
            progress across all activities.
          </p>
        </Link>
      </div>
    </div>
  );
}
