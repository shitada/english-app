import { Link } from 'react-router-dom';

export interface NextStepsData {
  grammarAccuracy?: number;   // 0-100 percentage
  fillerCount?: number;       // raw count
  avgResponseTime?: number;   // seconds
  avgWordsPerMessage?: number; // average word count
  vocabDiversity?: number;    // 0-100 percentage
}

export interface Recommendation {
  emoji: string;
  title: string;
  reason: string;
  link: string;
  linkLabel: string;
}

/**
 * Analyze session data and return 2-3 prioritized recommendations.
 * Exported for unit testing.
 */
export function generateRecommendations(data: NextStepsData): Recommendation[] {
  const recs: Recommendation[] = [];

  // Priority order: grammar → filler → response speed → sentence length → vocab diversity
  if (data.grammarAccuracy != null && data.grammarAccuracy < 70) {
    recs.push({
      emoji: '📝',
      title: 'Practice grammar patterns',
      reason: `Your grammar accuracy was ${data.grammarAccuracy}% — let's sharpen those patterns.`,
      link: '/pronunciation',
      linkLabel: 'Grammar Drills',
    });
  }

  if (data.fillerCount != null && data.fillerCount > 3) {
    recs.push({
      emoji: '🗣️',
      title: 'Reduce filler words',
      reason: `You used ${data.fillerCount} filler words — try pausing instead of filling.`,
      link: '/',
      linkLabel: 'Filler Reduction',
    });
  }

  if (data.avgResponseTime != null && data.avgResponseTime > 15) {
    recs.push({
      emoji: '⏱️',
      title: 'Build response speed',
      reason: `Your avg response time was ${data.avgResponseTime.toFixed(1)}s — aim for under 15s.`,
      link: '/pronunciation',
      linkLabel: 'Response Drills',
    });
  }

  if (data.avgWordsPerMessage != null && data.avgWordsPerMessage < 6) {
    recs.push({
      emoji: '✏️',
      title: 'Expand your sentences',
      reason: `Your messages averaged ${data.avgWordsPerMessage} words — try adding more detail.`,
      link: '/pronunciation',
      linkLabel: 'Sentence Expansion',
    });
  }

  if (data.vocabDiversity != null && data.vocabDiversity < 40) {
    recs.push({
      emoji: '📚',
      title: 'Grow your vocabulary',
      reason: `Your vocab diversity was ${data.vocabDiversity}% — explore new words.`,
      link: '/vocabulary',
      linkLabel: 'Vocabulary Practice',
    });
  }

  // If all metrics are good, show a congratulatory message
  if (recs.length === 0) {
    recs.push({
      emoji: '🎉',
      title: 'Level up! Try Advanced difficulty',
      reason: 'All your metrics look great — challenge yourself with a harder conversation.',
      link: '/conversation',
      linkLabel: 'New Conversation',
    });
    recs.push({
      emoji: '🌟',
      title: 'Explore a new topic',
      reason: 'You\'re doing well — broaden your skills by trying an unfamiliar topic.',
      link: '/conversation',
      linkLabel: 'Browse Topics',
    });
  }

  // Return at most 3 recommendations
  return recs.slice(0, 3);
}

interface NextStepsCardProps {
  data: NextStepsData;
}

export function NextStepsCard({ data }: NextStepsCardProps) {
  const recommendations = generateRecommendations(data);

  if (recommendations.length === 0) return null;

  return (
    <div
      data-testid="next-steps-card"
      style={{
        marginBottom: 24,
        padding: 16,
        background: 'var(--bg-secondary, #f5f5f5)',
        borderRadius: 8,
      }}
    >
      <h4 style={{ marginBottom: 12, fontSize: '0.9rem', color: 'var(--text-secondary, #6b7280)' }}>
        🚀 What to Practice Next
      </h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {recommendations.map((rec, i) => (
          <div
            key={i}
            data-testid={`next-step-${i}`}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              padding: 12,
              background: 'var(--card-bg, #fff)',
              borderRadius: 8,
              borderLeft: '3px solid var(--primary, #6366f1)',
            }}
          >
            <span style={{ fontSize: 24, lineHeight: 1, flexShrink: 0 }}>{rec.emoji}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{rec.title}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary, #6b7280)', marginBottom: 8 }}>
                {rec.reason}
              </div>
              <Link
                to={rec.link}
                data-testid={`next-step-link-${i}`}
                style={{
                  display: 'inline-block',
                  padding: '4px 12px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#fff',
                  background: 'var(--primary, #6366f1)',
                  borderRadius: 6,
                  textDecoration: 'none',
                }}
              >
                {rec.linkLabel} →
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
