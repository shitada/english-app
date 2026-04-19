import { useState, useEffect } from 'react';
import { Flame, MessageSquare, Mic, BookOpen, Clock } from 'lucide-react';
import { api, type DashboardStats, type MistakeItem, type Achievement, type WeeklyReport as WeeklyReportData, type GrammarTrendResponse, type MistakeReviewItem, type ConfidenceTrendResponse, type TodayActivity, getMistakeJournal, getAchievements, getWeeklyReport, getGrammarTrend, getMistakeReview, getConfidenceTrend, getTodayActivity } from '../api';
import { formatRelativeTime } from '../utils/formatDate';
import { AchievementsPanel, CEFRLevelCard, FluencyProgressionChart, GrammarTrend, GrammarWeakSpots, LearningVelocityCard, ListeningProgress, MistakeJournal, MistakeReviewDrill, ModuleStreaksCard, PronunciationProgress, PronunciationWeakSpots, SelfAssessmentTrendChart, SessionAnalytics, ShareProgressCard, SkillsRadarChart, SpeakingConfidence, SpeakingJournalProgress, TopicCoverageMap, VocabActivationCard, VocabForecastCard, VocabularyProgress, WeeklyReport } from '../components/dashboard';
import { LazySection } from '../hooks/useLazyLoad';

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [mistakes, setMistakes] = useState<MistakeItem[]>([]);
  const [mistakeFilter, setMistakeFilter] = useState<'all' | 'grammar' | 'pronunciation' | 'vocabulary'>('all');
  const [mistakeTotal, setMistakeTotal] = useState(0);
  const [mistakeOffset, setMistakeOffset] = useState(0);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [achievementsUnlocked, setAchievementsUnlocked] = useState(0);
  const [achievementsTotal, setAchievementsTotal] = useState(0);
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReportData | null>(null);
  const [grammarTrend, setGrammarTrend] = useState<GrammarTrendResponse | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewItems, setReviewItems] = useState<MistakeReviewItem[]>([]);
  const [confidenceTrend, setConfidenceTrend] = useState<ConfidenceTrendResponse | null>(null);
  const [todayActivity, setTodayActivity] = useState<TodayActivity | null>(null);

  useEffect(() => {
    api.getDashboardStats()
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
    getAchievements()
      .then(res => {
        setAchievements(res.achievements);
        setAchievementsUnlocked(res.unlocked_count);
        setAchievementsTotal(res.total_count);
      })
      .catch(() => {});
    getWeeklyReport()
      .then(setWeeklyReport)
      .catch(() => {});
    getGrammarTrend()
      .then(setGrammarTrend)
      .catch(() => {});
    getConfidenceTrend()
      .then(setConfidenceTrend)
      .catch(() => {});
    getTodayActivity()
      .then(setTodayActivity)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setMistakeOffset(0);
    getMistakeJournal(mistakeFilter, 10, 0)
      .then(res => { setMistakes(res.items); setMistakeTotal(res.total_count); })
      .catch(() => {});
  }, [mistakeFilter]);

  const loadMoreMistakes = () => {
    const newOffset = mistakeOffset + 10;
    getMistakeJournal(mistakeFilter, 10, newOffset)
      .then(res => { setMistakes(prev => [...prev, ...res.items]); setMistakeOffset(newOffset); })
      .catch(() => {});
  };

  const startMistakeReview = () => {
    getMistakeReview(10)
      .then(res => { setReviewItems(res.items); setReviewMode(true); })
      .catch(() => {});
  };

  const hasGrammarMistakes = mistakes.some(m => m.module === 'grammar');

  if (loading) {
    return (
      <div>
        <h2 style={{ marginBottom: 24 }}>Dashboard</h2>
        <div className="skeleton skeleton-card" style={{ height: 120, marginBottom: 24 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton skeleton-card" />
          ))}
        </div>
        <div className="skeleton skeleton-card" style={{ height: 200 }} />
      </div>
    );
  }

  if (!stats) {
    return <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Failed to load dashboard.</p>;
  }

  return (
    <div>
      <h2 style={{ marginBottom: 24 }}>Dashboard</h2>

      {/* Streak */}
      <div className="card" style={{ textAlign: 'center', marginBottom: 24, background: stats.streak > 0 ? 'linear-gradient(135deg, #fef3c7, #fde68a)' : undefined }}>
        <Flame size={40} color={stats.streak > 0 ? '#f59e0b' : '#d1d5db'} />
        <div style={{ fontSize: 48, fontWeight: 800, marginTop: 8 }}>{stats.streak}</div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          {stats.streak === 0 ? 'Start learning today!' : stats.streak === 1 ? 'Day streak! Keep it up!' : `Day streak! Amazing!`}
        </p>
      </div>

      {/* Stats grid */}
      <div className="stats-grid">
        <StatCard icon={<MessageSquare size={24} color="#6366f1" />} label="Conversations" value={stats.total_conversations} sub={`${stats.total_messages} messages sent`} />
        <StatCard icon={<Mic size={24} color="#f59e0b" />} label="Shadowing" value={stats.total_pronunciation} sub={`Avg score: ${stats.avg_pronunciation_score}/10`} />
        <StatCard icon={<BookOpen size={24} color="#10b981" />} label="Words Reviewed" value={stats.total_vocab_reviewed} sub={`${stats.vocab_mastered} mastered`} />
        <StatCard icon={<Clock size={24} color={stats.vocab_due_count > 0 ? '#ef4444' : '#6b7280'} />} label="Due for Review" value={stats.vocab_due_count} sub={stats.vocab_due_count > 0 ? 'Words need review!' : 'All caught up!'} />
      </div>

      {/* Share Today's Progress */}
      <ShareProgressCard
        streak={stats.streak}
        wordsToday={todayActivity?.vocabulary_reviews}
        topSkill={computeTopSkill(stats)}
      />

      {/* Skills Radar Chart */}
      <SkillsRadarChart />

      {/* CEFR English Level Estimate */}
      <LazySection>
        <CEFRLevelCard />
      </LazySection>

      {/* Weekly Report */}
      <WeeklyReport report={weeklyReport} />

      {/* Session Analytics */}
      <LazySection>
        <SessionAnalytics />
      </LazySection>

      {/* Learning Velocity */}
      <LazySection>
        <LearningVelocityCard />
      </LazySection>

      {/* Module Streaks */}
      <LazySection>
        <ModuleStreaksCard />
      </LazySection>

      {/* Speaking Confidence */}
      {confidenceTrend && (
        <SpeakingConfidence sessions={confidenceTrend.sessions} trend={confidenceTrend.trend} />
      )}

      {/* Speaking Journal Progress */}
      <LazySection>
        <SpeakingJournalProgress />
      </LazySection>

      {/* Fluency Progression */}
      <LazySection>
        <FluencyProgressionChart />
      </LazySection>

      {/* Self-Assessment Trend */}
      <LazySection>
        <SelfAssessmentTrendChart />
      </LazySection>

      {/* Vocabulary Progress */}
      <LazySection>
        <VocabularyProgress />
      </LazySection>

      {/* Vocabulary Retention Forecast */}
      <LazySection>
        <VocabForecastCard />
      </LazySection>

      {/* Vocabulary Activation */}
      <LazySection>
        <VocabActivationCard />
      </LazySection>

      {/* Topic Coverage Map */}
      <LazySection>
        <TopicCoverageMap />
      </LazySection>

      {/* Pronunciation Progress */}
      <LazySection>
        <PronunciationProgress />
      </LazySection>

      {/* Pronunciation Weak Spots */}
      <LazySection>
        <PronunciationWeakSpots />
      </LazySection>

      {/* Listening Progress */}
      <LazySection>
        <ListeningProgress />
      </LazySection>

      {/* Grammar Trend */}
      {grammarTrend && (
        <GrammarTrend conversations={grammarTrend.conversations} trend={grammarTrend.trend} />
      )}

      {/* Grammar Weak Spots */}
      <LazySection>
        <GrammarWeakSpots />
      </LazySection>

      {/* Achievements */}
      <LazySection>
        <AchievementsPanel achievements={achievements} unlocked={achievementsUnlocked} total={achievementsTotal} />
      </LazySection>

      {/* Recent activity */}
      {stats.recent_activity.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Recent Activity</h3>
          {stats.recent_activity.map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: i < stats.recent_activity.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <span style={{ fontSize: 18 }}>
                {a.type === 'conversation' ? '💬' : a.type === 'vocabulary' ? '📚' : a.type === 'listening' ? '🎧' : '🎙️'}
              </span>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14 }}>{a.detail}</p>
                <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{formatRelativeTime(a.timestamp)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Mistake Journal */}
      <LazySection>
        {reviewMode ? (
          <MistakeReviewDrill items={reviewItems} onClose={() => setReviewMode(false)} />
        ) : (
          <MistakeJournal
            mistakes={mistakes}
            filter={mistakeFilter}
            setFilter={setMistakeFilter}
            total={mistakeTotal}
            onLoadMore={loadMoreMistakes}
            onStartReview={startMistakeReview}
            hasGrammarMistakes={hasGrammarMistakes}
          />
        )}
      </LazySection>
    </div>
  );
}

function computeTopSkill(stats: DashboardStats): string | undefined {
  const candidates: { label: string; value: number }[] = [
    { label: 'Conversations', value: stats.total_conversations || 0 },
    { label: 'Shadowing', value: stats.total_pronunciation || 0 },
    { label: 'Vocabulary', value: stats.total_vocab_reviewed || 0 },
  ];
  let best: { label: string; value: number } | undefined;
  for (const c of candidates) {
    if (c.value > 0 && (!best || c.value > best.value)) best = c;
  }
  return best?.label;
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number; sub: string }) {
  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <div style={{ marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 32, fontWeight: 700 }}>{value}</div>
      <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{label}</p>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{sub}</p>
    </div>
  );
}
