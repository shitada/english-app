import { Award, BookOpen, MessageSquare, BarChart3 } from 'lucide-react';

interface ShareCardProps {
  summary: {
    communication_level?: string;
    summary?: string;
    tip?: string;
    key_vocabulary?: string[];
    performance?: {
      total_user_messages?: number;
      grammar_accuracy_rate?: number;
      avg_words_per_message?: number;
      vocabulary_diversity?: number;
      total_words?: number;
    };
  };
  topic?: string;
}

function getGradeColor(value: number, thresholds: [number, number] = [50, 80]): string {
  if (value >= thresholds[1]) return '#22c55e';
  if (value >= thresholds[0]) return '#f59e0b';
  return '#ef4444';
}

function getGradeLabel(value: number): string {
  if (value >= 90) return 'Excellent';
  if (value >= 80) return 'Great';
  if (value >= 60) return 'Good';
  if (value >= 40) return 'Fair';
  return 'Needs Practice';
}

export function ShareCard({ summary, topic }: ShareCardProps) {
  const perf = summary.performance;
  const grammarRate = perf?.grammar_accuracy_rate ?? 0;
  const wordsPerMsg = perf?.avg_words_per_message ?? 0;
  const vocabDiversity = perf?.vocabulary_diversity ?? 0;
  const totalMessages = perf?.total_user_messages ?? 0;
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const cardStyle: React.CSSProperties = {
    width: 400,
    maxWidth: '100%',
    margin: '0 auto',
    borderRadius: 16,
    overflow: 'hidden',
    background: 'linear-gradient(135deg, var(--bg-primary, #fff) 0%, var(--bg-secondary, #f8f9fa) 100%)',
    border: '2px solid var(--border-color, #e5e7eb)',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  };

  const headerStyle: React.CSSProperties = {
    background: 'linear-gradient(135deg, var(--primary, #6366f1) 0%, var(--primary-dark, #4f46e5) 100%)',
    color: '#fff',
    padding: '20px 24px',
  };

  const bodyStyle: React.CSSProperties = {
    padding: '20px 24px',
  };

  const statStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 0',
    borderBottom: '1px solid var(--border-color, #e5e7eb)',
  };

  const gaugeSize = 56;
  const gaugeStroke = 5;
  const gaugeRadius = (gaugeSize - gaugeStroke) / 2;
  const gaugeCircumference = 2 * Math.PI * gaugeRadius;
  const gaugeFill = (grammarRate / 100) * gaugeCircumference;

  return (
    <div style={cardStyle} data-testid="share-card">
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 11, opacity: 0.8, textTransform: 'uppercase', letterSpacing: 1 }}>
              Practice Session
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>
              {topic ? `🗣️ ${topic}` : '🗣️ English Practice'}
            </div>
          </div>
          <div style={{
            background: 'rgba(255,255,255,0.2)',
            borderRadius: 8,
            padding: '4px 10px',
            fontSize: 12,
            fontWeight: 600,
          }}>
            {summary.communication_level || 'Intermediate'}
          </div>
        </div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>{date}</div>
      </div>

      {/* Body */}
      <div style={bodyStyle}>
        {/* Grammar gauge + messages */}
        <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
          {grammarRate > 0 && (
            <div style={{ textAlign: 'center', flexShrink: 0 }}>
              <svg width={gaugeSize} height={gaugeSize} viewBox={`0 0 ${gaugeSize} ${gaugeSize}`}>
                <circle
                  cx={gaugeSize / 2} cy={gaugeSize / 2} r={gaugeRadius}
                  fill="none" stroke="var(--border-color, #e5e7eb)" strokeWidth={gaugeStroke}
                />
                <circle
                  cx={gaugeSize / 2} cy={gaugeSize / 2} r={gaugeRadius}
                  fill="none" stroke={getGradeColor(grammarRate)} strokeWidth={gaugeStroke}
                  strokeDasharray={`${gaugeFill} ${gaugeCircumference}`}
                  strokeLinecap="round"
                  transform={`rotate(-90 ${gaugeSize / 2} ${gaugeSize / 2})`}
                />
                <text x={gaugeSize / 2} y={gaugeSize / 2 + 1} textAnchor="middle" dominantBaseline="middle"
                  fontSize="14" fontWeight="700" fill="var(--text-primary, #1f2937)">
                  {grammarRate}%
                </text>
              </svg>
              <div style={{ fontSize: 10, color: 'var(--text-secondary, #6b7280)', marginTop: 2 }}>Grammar</div>
            </div>
          )}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: getGradeColor(grammarRate || 70) }}>
              {getGradeLabel(grammarRate || 70)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary, #6b7280)' }}>
              {summary.summary ? (summary.summary.length > 100 ? summary.summary.slice(0, 100) + '…' : summary.summary) : 'Great practice session!'}
            </div>
          </div>
        </div>

        {/* Stats rows */}
        {totalMessages > 0 && (
          <div style={statStyle}>
            <MessageSquare size={16} color="var(--primary, #6366f1)" />
            <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary, #1f2937)' }}>Messages Sent</span>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{totalMessages}</span>
          </div>
        )}
        {wordsPerMsg > 0 && (
          <div style={statStyle}>
            <BookOpen size={16} color="var(--primary, #6366f1)" />
            <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary, #1f2937)' }}>Words per Message</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: getGradeColor(wordsPerMsg, [6, 12]) }}>{wordsPerMsg}</span>
          </div>
        )}
        {vocabDiversity > 0 && (
          <div style={{ ...statStyle, borderBottom: 'none' }}>
            <BarChart3 size={16} color="var(--primary, #6366f1)" />
            <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary, #1f2937)' }}>Vocab Diversity</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: getGradeColor(vocabDiversity, [40, 60]) }}>{vocabDiversity}%</span>
          </div>
        )}

        {/* Key vocabulary chips */}
        {summary.key_vocabulary && summary.key_vocabulary.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Award size={14} color="var(--primary, #6366f1)" />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #6b7280)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Key Vocabulary
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {summary.key_vocabulary.slice(0, 8).map((word) => (
                <span key={word} style={{
                  background: 'var(--primary-light, #e0e7ff)',
                  color: 'var(--primary-dark, #4338ca)',
                  padding: '3px 10px',
                  borderRadius: 12,
                  fontSize: 12,
                  fontWeight: 500,
                }}>
                  {word}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Tip */}
        {summary.tip && (
          <div style={{
            marginTop: 16,
            padding: '10px 14px',
            background: 'var(--warning-bg, #fffbeb)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--text-primary, #1f2937)',
            borderLeft: '3px solid var(--warning, #f59e0b)',
          }}>
            💡 <strong>Tip:</strong> {summary.tip}
          </div>
        )}

        {/* Footer */}
        <div style={{
          marginTop: 16,
          textAlign: 'center',
          fontSize: 10,
          color: 'var(--text-secondary, #9ca3af)',
          letterSpacing: 0.5,
        }}>
          Practiced with English Learning App
        </div>
      </div>
    </div>
  );
}
