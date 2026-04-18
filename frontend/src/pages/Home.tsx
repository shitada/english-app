import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, Mic, BookOpen, BarChart3, Flame, AlertTriangle, Target, TrendingUp, TrendingDown, Minus, Trash2, CheckCircle, HelpCircle, Zap, Award, Headphones, PenTool } from 'lucide-react';
import { getLearningInsights, getLearningGoals, setLearningGoal, deleteLearningGoal, getTodayActivity, getDailyChallenge, getWordOfTheDay, getPhraseOfTheDay, getVocabularyStats, getRecentActivity, getAchievements, type LearningInsights, type LearningGoal, type TodayActivity, type DailyChallenge, type WordOfTheDay, type PhraseOfTheDay, type VocabularyStatsResponse, type RecentActivityItem, type Achievement } from '../api';
import { api } from '../api';
import type { StreakMilestonesResponse } from '../api';
import { useOnboarding } from '../hooks/useOnboarding';
import OnboardingOverlay from '../components/OnboardingOverlay';
import { AchievementToastContainer } from '../components/AchievementToast';
import QuickPracticeHub from '../components/QuickPracticeHub';
import SmartReviewQueue from '../components/SmartReviewQueue';
import SpeakingJournal from '../components/SpeakingJournal';
import FluencySprintCard from '../components/FluencySprintCard';
import StudyPlanCard from '../components/StudyPlanCard';
import { useI18n } from '../i18n/I18nContext';

const MODULE_ROUTES: Record<string, string> = {
  conversation: '/conversation',
  vocabulary: '/vocabulary',
  pronunciation: '/pronunciation',
};

const MODULE_LABEL_KEYS: Record<string, 'moduleConversation' | 'moduleVocabulary' | 'modulePronunciation'> = {
  conversation: 'moduleConversation',
  vocabulary: 'moduleVocabulary',
  pronunciation: 'modulePronunciation',
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
  const { t } = useI18n();
  const modules = (['conversation', 'vocabulary', 'pronunciation'] as const);
  return (
    <div style={{ marginBottom: '1rem' }}>
      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary, #6b7280)' }}>{t('moduleStrengths')}</h4>
      {modules.map(mod => (
        <div key={mod} style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 2 }}>
            <span>{t(MODULE_LABEL_KEYS[mod])}</span>
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
  const { t } = useI18n();
  const modules = (['conversations', 'vocabulary', 'pronunciation', 'listening', 'speaking_journal'] as const);
  const labelKeys: Record<string, 'weeklyConversations' | 'weeklyVocabReviews' | 'weeklyPronunciation' | 'weeklyListening' | 'weeklySpeakingJournal'> = { conversations: 'weeklyConversations', vocabulary: 'weeklyVocabReviews', pronunciation: 'weeklyPronunciation', listening: 'weeklyListening', speaking_journal: 'weeklySpeakingJournal' };
  return (
    <div style={{ marginBottom: '1rem' }}>
      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary, #6b7280)' }}>{t('weeklyProgress')}</h4>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {modules.map(mod => {
          const data = comparison[mod];
          const diff = data.this_week - data.last_week;
          return (
            <div key={mod} style={{ flex: '1 1 30%', minWidth: '100px', background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8, padding: '0.5rem', textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)', marginBottom: 4 }}>{t(labelKeys[mod])}</div>
              <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{data.this_week}</div>
              <div style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                {diff > 0 ? <TrendingUp size={12} color="var(--success, #10b981)" /> :
                 diff < 0 ? <TrendingDown size={12} color="var(--danger, #ef4444)" /> :
                 <Minus size={12} color="var(--text-secondary, #6b7280)" />}
                <span style={{ color: diff > 0 ? 'var(--success, #10b981)' : diff < 0 ? 'var(--danger, #ef4444)' : 'var(--text-secondary, #6b7280)' }}>
                  {diff > 0 ? `+${diff}` : diff === 0 ? '—' : `${diff}`} {t('vsLastWeek')}
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
  const { t, tParam } = useI18n();
  const route = MODULE_ROUTES[area];
  const labelKey = MODULE_LABEL_KEYS[area];
  const label = labelKey ? t(labelKey) : area;
  if (!route) return null;
  return (
    <div style={{ marginBottom: '1rem' }}>
      <Link to={route} style={{
        display: 'block', textAlign: 'center', padding: '0.75rem', borderRadius: 8,
        background: 'var(--primary, #6366f1)', color: '#fff', textDecoration: 'none',
        fontWeight: 600, fontSize: '0.9rem',
      }}>
        {tParam('focusOnWeakest', { label })}
      </Link>
    </div>
  );
}

const QUICK_GOALS: { goalType: string; target: number; labelKey: 'goal3Conv' | 'goal10Vocab' | 'goal5Pron' | 'goal2Speaking' | 'goal2Listening' }[] = [
  { goalType: 'conversations', target: 3, labelKey: 'goal3Conv' },
  { goalType: 'vocabulary_reviews', target: 10, labelKey: 'goal10Vocab' },
  { goalType: 'pronunciation_attempts', target: 5, labelKey: 'goal5Pron' },
  { goalType: 'speaking_journal_entries', target: 2, labelKey: 'goal2Speaking' },
  { goalType: 'listening_quizzes', target: 2, labelKey: 'goal2Listening' },
];

function GoalSetupPrompt({ onGoalCreated }: { onGoalCreated: (goal: LearningGoal) => void }) {
  const { t } = useI18n();
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
      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary, #6b7280)' }}>{t('setDailyGoal')}</h4>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {QUICK_GOALS.map(({ goalType, target, labelKey }) => (
          <button key={goalType} onClick={() => handleCreate(goalType, target)}
            disabled={creating !== null}
            style={{
              padding: '0.4rem 0.75rem', borderRadius: 6, border: '1px solid var(--border, #e5e7eb)',
              background: creating === goalType ? 'var(--primary, #6366f1)' : '#fff',
              color: creating === goalType ? '#fff' : 'var(--text, #111827)',
              cursor: creating !== null ? 'not-allowed' : 'pointer', fontSize: '0.8rem',
            }}>
            {creating === goalType ? '…' : t(labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}

function GoalProgressBar({ goal, onDelete, onUpdate }: { goal: LearningGoal; onDelete: (goalType: string) => void; onUpdate: (goalType: string, newTarget: number) => void }) {
  const { t } = useI18n();
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
              title={t('clickToEditTarget')}
            >
              {goal.today_count}/{goal.daily_target}{goal.completed ? ' ✓' : ''}
            </span>
          )}
          <button
            onClick={() => onDelete(goal.goal_type)}
            title={t('removeGoal')}
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
  const { t, tParam } = useI18n();
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
        {t('todaysPractice')}
      </h3>

      {insights && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem', padding: '0.75rem', background: insights.streak_at_risk ? 'var(--danger-bg, #fef2f2)' : 'var(--success-bg, #f0fdf4)', borderRadius: 8 }}>
          {insights.streak_at_risk
            ? <AlertTriangle size={20} color="var(--danger, #ef4444)" />
            : <Flame size={20} color="var(--warning, #f59e0b)" />
          }
          <div>
            <strong>{tParam('dayStreak', { count: insights.streak })}</strong>
            {insights.streak_at_risk && (
              <span style={{ color: 'var(--danger, #ef4444)', fontSize: '0.85rem', marginLeft: 8 }}>
                {t('keepStreak')}
              </span>
            )}
          </div>
        </div>
      )}

      {insights && <ModuleStrengthsSection strengths={insights.module_strengths} />}

      {insights && insights.weekly_comparison && <WeeklyProgressSection comparison={insights.weekly_comparison} />}

      {insights && insights.weakest_area && <FocusAreaCTA area={insights.weakest_area} />}

      {todayActivity && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: '1rem' }}>
          {([
            { labelKey: 'todayConversations' as const, count: todayActivity.conversations, icon: <MessageSquare size={16} /> },
            { labelKey: 'todayVocabReviews' as const, count: todayActivity.vocabulary_reviews, icon: <BookOpen size={16} /> },
            { labelKey: 'todayPronunciation' as const, count: todayActivity.pronunciation_attempts, icon: <Mic size={16} /> },
            { labelKey: 'todayListening' as const, count: todayActivity.listening_quizzes, icon: <Headphones size={16} /> },
            { labelKey: 'todaySpeakingJournal' as const, count: todayActivity.speaking_journal_entries, icon: <PenTool size={16} /> },
          ]).map(({ labelKey, count, icon }) => (
            <div key={labelKey} style={{ flex: '1 1 calc(33% - 8px)', minWidth: 80, textAlign: 'center', padding: '0.5rem', background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, marginBottom: 4, color: 'var(--text-secondary, #6b7280)' }}>
                {icon}<span style={{ fontSize: '0.75rem' }}>{t(labelKey)}</span>
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{count}</div>
            </div>
          ))}
        </div>
      )}

      {goals.length > 0 && goals.every(g => g.completed) && (
        <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: 'var(--success-bg, #f0fdf4)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--success, #10b981)' }}>
          <CheckCircle size={18} />
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t('allGoalsComplete')}</span>
        </div>
      )}

      {goals.length > 0 ? (
        <div style={{ marginBottom: '1rem' }}>
          <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary, #6b7280)' }}>{t('dailyGoals')}</h4>
          {goals.map(g => <GoalProgressBar key={g.id} goal={g} onDelete={handleGoalDelete} onUpdate={handleGoalUpdate} />)}
        </div>
      ) : (
        <GoalSetupPrompt onGoalCreated={handleGoalCreated} />
      )}

      {insights && insights.recommendations.length > 0 && (
        <div>
          <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary, #6b7280)' }}>{t('recommendations')}</h4>
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
  const { t } = useI18n();
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
        <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{t('wordOfTheDay')}</span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 'auto', textTransform: 'capitalize' }}>
          {word.topic?.replace(/_/g, ' ')}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--primary, #6366f1)' }}>{word.word}</span>
        <button
          data-testid="wotd-tts"
          onClick={() => speak(word.word)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-secondary)' }}
          title={t('listen')}
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
            title={t('listenToExample')}
          >
            🔊
          </button>
        </div>
      )}

      <Link to="/vocabulary" style={{ display: 'inline-block', marginTop: 10, fontSize: '0.85rem', color: 'var(--primary, #6366f1)', fontWeight: 600, textDecoration: 'none' }}>
        {t('practiceVocabulary')}
      </Link>
    </div>
  );
}

function PhraseOfTheDayCard() {
  const { t } = useI18n();
  const [phrase, setPhrase] = useState<PhraseOfTheDay | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    getPhraseOfTheDay().then(setPhrase).catch(() => {});
  }, []);

  const speak = useCallback((text: string) => {
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.9;
      window.speechSynthesis.speak(u);
    }
  }, []);

  const computeAccuracy = useCallback((reference: string, spoken: string): number => {
    const normalize = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const refWords = normalize(reference).split(/\s+/);
    const spokenWords = normalize(spoken).split(/\s+/);
    if (refWords.length === 0) return 0;
    let matched = 0;
    for (const rw of refWords) {
      if (spokenWords.includes(rw)) matched++;
    }
    return Math.round((matched / refWords.length) * 100);
  }, []);

  const startPractice = useCallback(() => {
    if (!phrase) return;
    const SpeechRecognition = (window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    setListening(true);
    setScore(null);
    const recognition = new (SpeechRecognition as new () => SpeechRecognition)();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.onresult = (e: SpeechRecognitionEvent) => {
      const transcript = e.results[0][0].transcript;
      setScore(computeAccuracy(phrase.phrase, transcript));
      setListening(false);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.start();
  }, [phrase, computeAccuracy]);

  if (!phrase) return null;

  const scoreColor = score !== null ? (score >= 80 ? 'var(--success, #10b981)' : score >= 50 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)') : undefined;

  return (
    <div style={{
      padding: '1rem 1.25rem',
      marginBottom: '1.5rem',
      borderRadius: 12,
      border: '2px solid transparent',
      background: 'linear-gradient(var(--card-bg, #fff), var(--card-bg, #fff)) padding-box, linear-gradient(135deg, #06b6d4, #8b5cf6) border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>💬</span>
        <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{t('phraseOfTheDay') || 'Phrase of the Day'}</span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 'auto', textTransform: 'capitalize' }}>
          {phrase.topic?.replace(/_/g, ' ')}
        </span>
      </div>

      <p style={{ margin: '0 0 12px', fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)', lineHeight: 1.4 }}>
        "{phrase.phrase}"
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={() => speak(phrase.phrase)}
          style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border, #e5e7eb)', background: 'var(--bg-secondary, #f9fafb)', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4 }}
        >
          🔊 {t('listen') || 'Listen'}
        </button>
        <button
          onClick={startPractice}
          disabled={listening}
          style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: listening ? 'var(--warning, #f59e0b)' : 'var(--primary, #6366f1)', color: '#fff', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4 }}
        >
          🎙️ {listening ? (t('listening') || 'Listening...') : (t('practice') || 'Practice')}
        </button>
        {score !== null && (
          <span style={{ fontWeight: 700, fontSize: '1rem', color: scoreColor, marginLeft: 8 }}>
            {score}%
          </span>
        )}
      </div>
    </div>
  );
}

function RecentlyPracticedCard() {
  const { t, tParam } = useI18n();
  const [items, setItems] = useState<RecentActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getRecentActivity(5)
      .then((res) => setItems(res.items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (!loading && items.length === 0) return null;

  const iconMap: Record<string, { icon: typeof MessageSquare; color: string; bg: string }> = {
    conversation: { icon: MessageSquare, color: '#6366f1', bg: '#eef2ff' },
    pronunciation: { icon: Mic, color: '#f59e0b', bg: '#fef3c7' },
    vocabulary: { icon: BookOpen, color: '#10b981', bg: '#d1fae5' },
    listening: { icon: Headphones, color: '#06b6d4', bg: '#cffafe' },
    speaking_journal: { icon: PenTool, color: '#f43f5e', bg: '#ffe4e6' },
  };

  const relativeTime = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('justNow');
    if (mins < 60) return tParam('minutesAgo', { count: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return tParam('hoursAgo', { count: hrs });
    const days = Math.floor(hrs / 24);
    if (days === 1) return t('yesterday');
    return tParam('daysAgo', { count: days });
  };

  return (
    <div style={{
      background: 'var(--card-bg, #ffffff)', borderRadius: 16, padding: '20px 24px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 16, border: '1px solid var(--border-color, #e5e7eb)',
    }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #1f2937)' }}>
        {t('recentlyPracticed')}
      </h3>
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ height: 40, borderRadius: 8, background: 'var(--border-color, #e5e7eb)', opacity: 0.5, animation: 'pulse 1.5s infinite' }} />
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((item, i) => {
            const cfg = iconMap[item.type] || iconMap.conversation;
            const Icon = cfg.icon;
            return (
              <Link key={i} to={item.route} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8,
                textDecoration: 'none', color: 'inherit', transition: 'background 0.15s',
              }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-bg, #f3f4f6)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ width: 32, height: 32, borderRadius: 8, background: cfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon size={16} color={cfg.color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary, #1f2937)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.detail}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary, #6b7280)', textTransform: 'capitalize' }}>
                    {item.type}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary, #6b7280)', whiteSpace: 'nowrap' }}>
                  {relativeTime(item.timestamp)}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StreakMilestonesCard() {
  const { t, tParam } = useI18n();
  const [data, setData] = useState<StreakMilestonesResponse | null>(null);

  useEffect(() => {
    api.getStreakMilestones().then(setData).catch(() => {});
  }, []);

  if (!data) return null;

  const { current_streak, longest_streak, milestones, next_milestone, freeze_available } = data;
  const isHot = current_streak >= 7;

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span
          style={{
            fontSize: 32,
            animation: isHot ? 'streak-pulse 1.5s ease-in-out infinite' : undefined,
          }}
        >
          🔥
        </span>
        <div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--primary, #6366f1)' }}>
            {current_streak} day{current_streak !== 1 ? 's' : ''}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('currentStreak')}</div>
        </div>
        {freeze_available > 0 && (
          <div
            data-testid="streak-freeze-badge"
            title={`${freeze_available} streak freeze${freeze_available !== 1 ? 's' : ''} available`}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 12,
              background: 'var(--info-bg, #eff6ff)', border: '1px solid var(--info, #3b82f6)',
              fontSize: 12, fontWeight: 600, color: 'var(--info, #3b82f6)',
            }}
          >
            🛡️ {freeze_available}
          </div>
        )}
        {longest_streak > 0 && (
          <div style={{
            marginLeft: 'auto', padding: '4px 10px', borderRadius: 12,
            background: 'var(--warning-bg, #fffbeb)', border: '1px solid var(--warning, #f59e0b)',
            fontSize: 12, fontWeight: 600, color: 'var(--warning, #f59e0b)',
          }}>
            {tParam('bestStreak', { count: longest_streak })}
          </div>
        )}
      </div>

      {/* Milestone timeline */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, justifyContent: 'center' }}>
        {milestones.map(m => {
          const justUnlocked = m.achieved && current_streak === m.days;
          return (
            <div
              key={m.days}
              style={{
                padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                background: m.achieved ? 'var(--warning, #f59e0b)' : 'var(--bg-secondary, #f5f5f5)',
                color: m.achieved ? '#fff' : 'var(--text-secondary)',
                border: m.achieved ? 'none' : '1px solid var(--border)',
                animation: justUnlocked ? 'milestone-unlock 0.6s ease-out' : m.achieved ? 'milestone-glow 2s ease-in-out infinite' : undefined,
                transition: 'all 0.3s',
              }}
            >
              {m.achieved ? '⭐' : '○'} {m.label}
            </div>
          );
        })}
      </div>

      {/* Progress to next milestone */}
      {next_milestone && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
            <span style={{ color: 'var(--text-secondary)' }}>{tParam('nextMilestone', { label: next_milestone.label })}</span>
            <span style={{ fontWeight: 600 }}>{tParam('daysToGo', { count: next_milestone.days_remaining, s: next_milestone.days_remaining !== 1 ? 's' : '' })}</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--border, #e5e7eb)' }}>
            <div style={{
              height: '100%', borderRadius: 3,
              background: 'linear-gradient(90deg, var(--primary, #6366f1), var(--warning, #f59e0b))',
              width: `${Math.min(100, ((next_milestone.days - next_milestone.days_remaining) / next_milestone.days) * 100)}%`,
              transition: 'width 0.5s',
            }} />
          </div>
        </div>
      )}
    </div>
  );
}

function VocabProgressCard() {
  const { t, tParam } = useI18n();
  const [stats, setStats] = useState<VocabularyStatsResponse | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    getVocabularyStats().then(setStats).catch(() => {});
  }, []);

  if (!stats || stats.total_words === 0) return null;

  const overallPct = stats.total_words > 0
    ? Math.round((stats.total_mastered / stats.total_words) * 100)
    : 0;

  const sorted = [...stats.topic_breakdown].sort(
    (a, b) => (b.mastered_count / (b.word_count || 1)) - (a.mastered_count / (a.word_count || 1))
  );

  const displayed = expanded ? sorted : sorted.slice(0, 4);

  const barColor = (pct: number) =>
    pct >= 60 ? 'var(--color-success, #22c55e)' : pct >= 30 ? 'var(--color-warning, #f59e0b)' : 'var(--color-error, #ef4444)';

  return (
    <div style={{
      background: 'var(--card-bg, #ffffff)', borderRadius: 16, padding: '20px 24px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 16, border: '1px solid var(--border-color, #e5e7eb)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <BookOpen size={20} color="var(--color-primary, #6366f1)" />
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #1f2937)' }}>
          {t('vocabularyProgress')}
        </h3>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `conic-gradient(${barColor(overallPct)} ${overallPct * 3.6}deg, var(--border-color, #e5e7eb) 0deg)`,
          position: 'relative',
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%', background: 'var(--card-bg, #ffffff)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, color: 'var(--text-primary, #1f2937)',
          }}>
            {overallPct}%
          </div>
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #1f2937)' }}>
            {tParam('masteredCount', { mastered: stats.total_mastered, total: stats.total_words })}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary, #6b7280)' }}>
            {stats.accuracy_rate > 0 ? tParam('accuracyRate', { rate: Math.round(stats.accuracy_rate) }) : t('startPracticingToTrack')}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {displayed.map((t) => {
          const pct = t.word_count > 0 ? Math.round((t.mastered_count / t.word_count) * 100) : 0;
          return (
            <div key={t.topic}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3, color: 'var(--text-primary, #1f2937)' }}>
                <span>{t.topic}</span>
                <span style={{ color: 'var(--text-secondary, #6b7280)' }}>{t.mastered_count}/{t.word_count}</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--border-color, #e5e7eb)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: barColor(pct), transition: 'width 0.4s ease' }} />
              </div>
            </div>
          );
        })}
      </div>

      {sorted.length > 4 && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            marginTop: 10, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
            color: 'var(--color-primary, #6366f1)', fontWeight: 500, padding: 0,
          }}
        >
          {expanded ? t('showLess') : tParam('showAllTopics', { count: sorted.length })}
        </button>
      )}

      <Link
        to="/vocabulary"
        style={{
          display: 'block', marginTop: 12, textAlign: 'center', padding: '8px 16px', borderRadius: 8,
          background: 'var(--color-primary, #6366f1)', color: '#fff', fontSize: 13, fontWeight: 500,
          textDecoration: 'none',
        }}
      >
        {t('practiceVocabulary')}
      </Link>
    </div>
  );
}

function DailyChallengeCard() {
  const { t } = useI18n();
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
        <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{t('dailyChallenge')}</span>
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
          {t('startChallenge')}
        </Link>
      )}
    </div>
  );
}

function RecentAchievementsRow() {
  const { t } = useI18n();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [allAchievements, setAllAchievements] = useState<Achievement[]>([]);

  useEffect(() => {
    getAchievements().then(res => {
      setAllAchievements(res.achievements);
      setAchievements(res.achievements.filter(a => a.unlocked).slice(-3));
    }).catch(() => {});
  }, []);

  return (
    <>
      <AchievementToastContainer achievements={allAchievements} />
      {achievements.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Award size={18} color="#f59e0b" />
            <h4 style={{ margin: 0, fontSize: '0.95rem' }}>{t('recentAchievements')}</h4>
            <Link to="/dashboard" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--primary, #6366f1)' }}>
              {t('viewAll')}
            </Link>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {achievements.map(a => (
              <Link
                key={a.id}
                to="/dashboard"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 20,
                  background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
                  border: '1px solid #f59e0b',
                  textDecoration: 'none', color: '#92400e',
                  fontSize: 13, fontWeight: 500,
                }}
              >
                <span style={{ fontSize: 18 }}>{a.emoji}</span>
                {a.title}
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default function Home() {
  const { t } = useI18n();
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
        <h2>{t('homeTitle')}</h2>
        <p>{t('homeSubtitle')}</p>
        <button className="tour-restart-btn" onClick={restartTour} title={t('takeTour')}>
          <HelpCircle size={16} />
          {t('takeTour')}
        </button>
      </div>

      <DailyPracticeCard />

      <StudyPlanCard />

      <RecentlyPracticedCard />

      <Link
        to="/minimal-pairs"
        data-testid="minimal-pairs-cta"
        className="card"
        style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '1rem',
          marginBottom: '1rem', textDecoration: 'none', color: 'inherit',
          border: '1px solid var(--border)', borderRadius: 12,
        }}
      >
        <Headphones size={28} color="#8b5cf6" />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }}>Minimal Pairs</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Train your ear — distinguish ship/sheep, light/right, and more.
          </div>
        </div>
        <span style={{
          padding: '6px 14px', borderRadius: 8, background: 'var(--primary, #3b82f6)',
          color: 'white', fontSize: 13, fontWeight: 600,
        }}>
          Train your ear
        </span>
      </Link>

      <QuickPracticeHub />

      <SpeakingJournal />

      <FluencySprintCard />

      <StreakMilestonesCard />

      <RecentAchievementsRow />

      <VocabProgressCard />

      <SmartReviewQueue />

      <DailyChallengeCard />

      <WordOfTheDayCard />

      <PhraseOfTheDayCard />

      <div className="feature-grid">
        <Link to="/conversation" className="feature-card">
          <div className="icon" style={{ background: '#eef2ff' }}>
            <MessageSquare size={28} color="#6366f1" />
          </div>
          <h3>{t('moduleConversation')}</h3>
          <p>
            {t('featureConversationDesc')}
          </p>
        </Link>

        <Link to="/pronunciation" className="feature-card">
          <div className="icon" style={{ background: '#fef3c7' }}>
            <Mic size={28} color="#f59e0b" />
          </div>
          <h3>{t('modulePronunciation')}</h3>
          <p>
            {t('featurePronunciationDesc')}
          </p>
        </Link>

        <Link to="/vocabulary" className="feature-card">
          <div className="icon" style={{ background: '#d1fae5' }}>
            <BookOpen size={28} color="#10b981" />
          </div>
          <h3>{t('moduleVocabulary')}</h3>
          <p>
            {t('featureVocabularyDesc')}
          </p>
        </Link>

        <Link to="/dashboard" className="feature-card">
          <div className="icon" style={{ background: '#f3e8ff' }}>
            <BarChart3 size={28} color="#8b5cf6" />
          </div>
          <h3>{t('featureDashboard')}</h3>
          <p>
            {t('featureDashboardDesc')}
          </p>
        </Link>
      </div>
    </div>
  );
}
