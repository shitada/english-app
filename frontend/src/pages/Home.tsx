import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, Mic, BookOpen, BarChart3, Flame, AlertTriangle, Target, TrendingUp, TrendingDown, Minus, Trash2, CheckCircle, HelpCircle, Zap } from 'lucide-react';
import { getLearningInsights, getLearningGoals, setLearningGoal, deleteLearningGoal, getTodayActivity, getDailyChallenge, getWordOfTheDay, type LearningInsights, type LearningGoal, type TodayActivity, type DailyChallenge, type WordOfTheDay } from '../api';
import { useOnboarding } from '../hooks/useOnboarding';
import OnboardingOverlay from '../components/OnboardingOverlay';

const MODULE_ROUTES: Record<string, string> = {
  conversation: '/conversation',
  vocabulary: '/vocabulary',
  pronunciation: '/pronunciation',
};

const MODULE_LABELS: Record<string, string> = {
  conversation: 'Conversation',
  vocabulary: 'Vocabulary',
  pronunciation: 'Pronunciation',
};

function strengthColor(value: number): string {
  if (value < 30) return 'var(--danger, #ef4444)';
  if (value < 60) return 'var(--warning, #f59e0b)';
  return 'var(--success, #10b981)';
}

function mapRecommendationToRoute(rec: string): string | null {
  const lower = rec.toLowerCase();
  if (lower.includes('vocab') || lower.includes('word')) return '/vocabulary';
  if (lower.includes('pronunc') || lower.includes('speak')) return '/pronunciation';
  if (lower.includes('conversation') || lower.includes('chat')) return '/conversation';
  return null;
}

function ModuleStrengthsSection({ strengths }: { strengths: { conversation: number; vocabulary: number; pronunciation: number } }) {
  const modules = (['conversation', 'vocabulary', 'pronunciation'] as const);
  return (
    <div style={{ marginBottom: '1rem' }}>
      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary, #6b7280)' }}>Module Strengths</h4>
      {modules.map(mod => (
        <div key={mod} style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 2 }}>
            <span>{MODULE_LABELS[mod]}</span>
            <span>{Math.round(strengths[mod])}%</span>
          </div>
          <div style={{ background: 'var(--border, #e5e7eb)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, Math.max(0, strengths[mod]))}%`,
              height: '100%',
              background: strengthColor(strengths[mod]),
              borderRadius: 4,
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function WeeklyProgressSection({ comparison }: { comparison: LearningInsights['weekly_comparison'] }) {
  const modules = (['conversations', 'vocabulary', 'pronunciation'] as const);
  const labels: Record<string, string> = { conversations: 'Conversations', vocabulary: 'Vocab Reviews', pronunciation: 'Pronunciation' };
  return (
    <div style={{ marginBottom: '1rem' }}>
      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary, #6b7280)' }}>Weekly Progress</h4>
      <div style={{ display: 'flex', gap: 12 }}>
        {modules.map(mod => {
          const data = comparison[mod];
          const diff = data.this_week - data.last_week;
          return (
            <div key={mod} style={{ flex: 1, background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8, padding: '0.5rem', textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)', marginBottom: 4 }}>{labels[mod]}</div>
              <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{data.this_week}</div>
              <div style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                {diff > 0 ? <TrendingUp size={12} color="var(--success, #10b981)" /> :
                 diff < 0 ? <TrendingDown size={12} color="var(--danger, #ef4444)" /> :
                 <Minus size={12} color="var(--text-secondary, #6b7280)" />}
                <span style={{ color: diff > 0 ? 'var(--success, #10b981)' : diff < 0 ? 'var(--danger, #ef4444)' : 'var(--text-secondary, #6b7280)' }}>
                  {diff > 0 ? `+${diff}` : diff === 0 ? '—' : `${diff}`} vs last wk
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FocusAreaCTA({ area }: { area: string }) {
  const route = MODULE_ROUTES[area];
  const label = MODULE_LABELS[area] || area;
  if (!route) return null;
  return (
    <div style={{ marginBottom: '1rem' }}>
      <Link to={route} style={{
        display: 'block', textAlign: 'center', padding: '0.75rem', borderRadius: 8,
        background: 'var(--primary, #6366f1)', color: '#fff', textDecoration: 'none',
        fontWeight: 600, fontSize: '0.9rem',
      }}>
        Focus on {label} — your weakest area →
      </Link>
    </div>
  );
}

const QUICK_GOALS: { goalType: string; target: number; label: string }[] = [
  { goalType: 'conversations', target: 3, label: '3 conversations/day' },
  { goalType: 'vocabulary_reviews', target: 10, label: '10 vocab reviews/day' },
  { goalType: 'pronunciation_attempts', target: 5, label: '5 pronunciations/day' },
];

function GoalSetupPrompt({ onGoalCreated }: { onGoalCreated: (goal: LearningGoal) => void }) {
  const [creating, setCreating] = useState<string | null>(null);

  const handleCreate = useCallback(async (goalType: string, target: number) => {
    setCreating(goalType);
    try {
      const goal = await setLearningGoal(goalType, target);
      onGoalCreated(goal);
    } catch {
      // Silently fail — user can try again
    } finally {
      setCreating(null);
    }
  }, [onGoalCreated]);

  return (
    <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8 }}>
      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary, #6b7280)' }}>Set a Daily Goal</h4>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {QUICK_GOALS.map(({ goalType, target, label }) => (
          <button key={goalType} onClick={() => handleCreate(goalType, target)}
            disabled={creating !== null}
            style={{
              padding: '0.4rem 0.75rem', borderRadius: 6, border: '1px solid var(--border, #e5e7eb)',
              background: creating === goalType ? 'var(--primary, #6366f1)' : '#fff',
              color: creating === goalType ? '#fff' : 'var(--text, #111827)',
              cursor: creating !== null ? 'not-allowed' : 'pointer', fontSize: '0.8rem',
            }}>
            {creating === goalType ? '…' : label}
          </button>
        ))}
      </div>
    </div>
  );
}

function GoalProgressBar({ goal, onDelete, onUpdate }: { goal: LearningGoal; onDelete: (goalType: string) => void; onUpdate: (goalType: string, newTarget: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [targetInput, setTargetInput] = useState(String(goal.daily_target));
  const pct = Math.min(100, Math.round((goal.today_count / goal.daily_target) * 100));
  const label = goal.goal_type.replace(/_/g, ' ');

  const handleSave = () => {
    const val = parseInt(targetInput, 10);
    if (val > 0 && val <= 100 && val !== goal.daily_target) {
      onUpdate(goal.goal_type, val);
    }
    setEditing(false);
  };

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', marginBottom: 2 }}>
        <span style={{ textTransform: 'capitalize' }}>{label}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {editing ? (
            <input
              type="number" min={1} max={100} value={targetInput}
              onChange={e => setTargetInput(e.target.value)}
              onBlur={handleSave}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              autoFocus
              style={{ width: 48, textAlign: 'center', fontSize: '0.85rem', borderRadius: 4, border: '1px solid var(--border, #e5e7eb)', padding: '1px 4px' }}
            />
          ) : (
            <span
              onClick={() => { setTargetInput(String(goal.daily_target)); setEditing(true); }}
              style={{ cursor: 'pointer' }}
              title="Click to edit target"
            >
              {goal.today_count}/{goal.daily_target}{goal.completed ? ' ✓' : ''}
            </span>
          )}
          <button
            onClick={() => onDelete(goal.goal_type)}
            title="Remove goal"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-secondary, #6b7280)', display: 'flex', alignItems: 'center' }}
          >
            <Trash2 size={14} />
          </button>
        </span>
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
  const [todayActivity, setTodayActivity] = useState<TodayActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.allSettled([getLearningInsights(), getLearningGoals(), getTodayActivity()])
      .then(([insightsResult, goalsResult, todayResult]) => {
        if (insightsResult.status === 'fulfilled') setInsights(insightsResult.value);
        if (goalsResult.status === 'fulfilled') setGoals(goalsResult.value);
        if (todayResult.status === 'fulfilled') setTodayActivity(todayResult.value);
        if (insightsResult.status === 'rejected' && goalsResult.status === 'rejected') setError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleGoalCreated = useCallback((goal: LearningGoal) => {
    setGoals(prev => [...prev, goal]);
  }, []);

  const handleGoalDelete = useCallback(async (goalType: string) => {
    try {
      await deleteLearningGoal(goalType);
      setGoals(prev => prev.filter(g => g.goal_type !== goalType));
    } catch { /* user can try again */ }
  }, []);

  const handleGoalUpdate = useCallback(async (goalType: string, newTarget: number) => {
    try {
      const updated = await setLearningGoal(goalType, newTarget);
      setGoals(prev => prev.map(g => g.goal_type === goalType ? updated : g));
    } catch { /* user can try again */ }
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

      {insights && <ModuleStrengthsSection strengths={insights.module_strengths} />}

      {insights && insights.weekly_comparison && <WeeklyProgressSection comparison={insights.weekly_comparison} />}

      {insights && insights.weakest_area && <FocusAreaCTA area={insights.weakest_area} />}

      {todayActivity && (
        <div style={{ display: 'flex', gap: 12, marginBottom: '1rem' }}>
          {([
            { label: 'Conversations', count: todayActivity.conversations, icon: <MessageSquare size={16} /> },
            { label: 'Vocab Reviews', count: todayActivity.vocabulary_reviews, icon: <BookOpen size={16} /> },
            { label: 'Pronunciation', count: todayActivity.pronunciation_attempts, icon: <Mic size={16} /> },
          ]).map(({ label, count, icon }) => (
            <div key={label} style={{ flex: 1, textAlign: 'center', padding: '0.5rem', background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, marginBottom: 4, color: 'var(--text-secondary, #6b7280)' }}>
                {icon}<span style={{ fontSize: '0.75rem' }}>{label}</span>
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{count}</div>
            </div>
          ))}
        </div>
      )}

      {goals.length > 0 && goals.every(g => g.completed) && (
        <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: 'var(--success-bg, #f0fdf4)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--success, #10b981)' }}>
          <CheckCircle size={18} />
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>🎉 All daily goals complete!</span>
        </div>
      )}

      {goals.length > 0 ? (
        <div style={{ marginBottom: '1rem' }}>
          <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary, #6b7280)' }}>Daily Goals</h4>
          {goals.map(g => <GoalProgressBar key={g.id} goal={g} onDelete={handleGoalDelete} onUpdate={handleGoalUpdate} />)}
        </div>
      ) : (
        <GoalSetupPrompt onGoalCreated={handleGoalCreated} />
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

function WordOfTheDayCard() {
  const [word, setWord] = useState<WordOfTheDay | null>(null);

  useEffect(() => {
    getWordOfTheDay().then(setWord).catch(() => {});
  }, []);

  const speak = useCallback((text: string) => {
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.9;
      window.speechSynthesis.speak(u);
    }
  }, []);

  if (!word) return null;

  return (
    <div style={{
      padding: '1rem 1.25rem',
      marginBottom: '1.5rem',
      borderRadius: 12,
      border: '2px solid transparent',
      background: 'linear-gradient(var(--card-bg, #fff), var(--card-bg, #fff)) padding-box, linear-gradient(135deg, #8b5cf6, #ec4899) border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>📖</span>
        <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>Word of the Day</span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 'auto', textTransform: 'capitalize' }}>
          {word.topic?.replace(/_/g, ' ')}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--primary, #6366f1)' }}>{word.word}</span>
        <button
          onClick={() => speak(word.word)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-secondary)' }}
          title="Listen"
        >
          🔊
        </button>
      </div>

      <p style={{ margin: '0 0 6px', fontSize: '0.9rem', color: 'var(--text)' }}>
        {word.meaning}
      </p>

      {word.example_sentence && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 8, padding: '6px 10px', background: 'var(--bg-secondary, #f9fafb)', borderRadius: 6 }}>
          <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontStyle: 'italic', flex: 1 }}>
            "{word.example_sentence}"
          </span>
          <button
            onClick={() => speak(word.example_sentence)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, fontSize: 14, color: 'var(--text-secondary)', flexShrink: 0 }}
            title="Listen to example"
          >
            🔊
          </button>
        </div>
      )}

      <Link to="/vocabulary" style={{ display: 'inline-block', marginTop: 10, fontSize: '0.85rem', color: 'var(--primary, #6366f1)', fontWeight: 600, textDecoration: 'none' }}>
        Practice Vocabulary →
      </Link>
    </div>
  );
}

function DailyChallengeCard() {
  const [challenge, setChallenge] = useState<DailyChallenge | null>(null);

  useEffect(() => {
    getDailyChallenge().then(setChallenge).catch(() => {});
  }, []);

  if (!challenge) return null;

  const progress = challenge.target_count > 0
    ? Math.min(100, Math.round((challenge.current_count / challenge.target_count) * 100))
    : 0;
  const emoji = challenge.challenge_type === 'conversation' ? '💬' : challenge.challenge_type === 'vocabulary' ? '📚' : '🎙️';

  return (
    <div style={{
      padding: '1rem 1.25rem',
      marginBottom: '1.5rem',
      borderRadius: 12,
      border: '2px solid transparent',
      background: challenge.completed
        ? 'linear-gradient(var(--card-bg, #fff), var(--card-bg, #fff)) padding-box, linear-gradient(135deg, #10b981, #6366f1) border-box'
        : 'linear-gradient(var(--card-bg, #fff), var(--card-bg, #fff)) padding-box, linear-gradient(135deg, #6366f1, #f59e0b) border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Zap size={18} color={challenge.completed ? '#10b981' : '#6366f1'} />
        <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>Daily Challenge</span>
        {challenge.completed && <span style={{ marginLeft: 'auto', fontSize: 18 }}>🎉</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 20 }}>{emoji}</span>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>{challenge.title}</p>
          <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{challenge.description}</p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, background: 'var(--border, #e5e7eb)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
          <div style={{
            width: `${progress}%`,
            height: '100%',
            background: challenge.completed ? '#10b981' : '#6366f1',
            borderRadius: 4,
            transition: 'width 0.3s ease',
          }} />
        </div>
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: challenge.completed ? '#10b981' : 'var(--text-secondary)', minWidth: 40, textAlign: 'right' }}>
          {challenge.current_count}/{challenge.target_count}
        </span>
      </div>

      {!challenge.completed && (
        <Link
          to={challenge.route}
          style={{
            display: 'inline-block',
            marginTop: 10,
            padding: '0.4rem 1rem',
            borderRadius: 6,
            background: 'var(--primary, #6366f1)',
            color: '#fff',
            fontWeight: 600,
            fontSize: '0.85rem',
            textDecoration: 'none',
          }}
        >
          Start Challenge →
        </Link>
      )}
    </div>
  );
}

export default function Home() {
  const { isActive, currentStep, totalSteps, step, next, prev, skip, restartTour } = useOnboarding();

  return (
    <div>
      {isActive && (
        <OnboardingOverlay
          step={step}
          currentStep={currentStep}
          totalSteps={totalSteps}
          onNext={next}
          onPrev={prev}
          onSkip={skip}
        />
      )}
      <div className="home-hero">
        <h2>Improve Your English</h2>
        <p>Practice conversations, pronunciation, and vocabulary with AI</p>
        <button className="tour-restart-btn" onClick={restartTour} title="Take a guided tour">
          <HelpCircle size={16} />
          Take a Tour
        </button>
      </div>

      <DailyPracticeCard />

      <DailyChallengeCard />

      <WordOfTheDayCard />

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
