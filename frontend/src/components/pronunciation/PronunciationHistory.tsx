import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { PronunciationAttempt, PronunciationProgress } from '../../api';
import { formatDateTime } from '../../utils/formatDate';

interface PronunciationHistoryProps {
  historyData: PronunciationAttempt[];
  progressData: PronunciationProgress | null;
  onBack: () => void;
}

export function PronunciationHistory({ historyData, progressData, onBack }: PronunciationHistoryProps) {
  const [expandedAttemptId, setExpandedAttemptId] = useState<number | null>(null);

  return (
    <div>
      <button
        onClick={onBack}
        style={{ marginBottom: 16, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: 'var(--text)' }}
      >
        ← Back to sentences
      </button>
      <h2 style={{ marginBottom: 16 }}>Pronunciation History</h2>

      {progressData && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 32, marginBottom: 16 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--primary)' }}>{progressData.total_attempts}</div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Attempts</p>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div className={`score-circle ${progressData.avg_score >= 8 ? 'score-high' : progressData.avg_score >= 5 ? 'score-mid' : 'score-low'}`} style={{ margin: '0 auto' }}>
                {progressData.avg_score}
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>Avg Score</p>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div className={`score-circle ${progressData.best_score >= 8 ? 'score-high' : progressData.best_score >= 5 ? 'score-mid' : 'score-low'}`} style={{ margin: '0 auto' }}>
                {progressData.best_score}
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>Best</p>
            </div>
          </div>

          {progressData.most_practiced.length > 0 && (
            <div>
              <h4 style={{ marginBottom: 8 }}>Most Practiced</h4>
              {progressData.most_practiced.map((mp, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 14, flex: 1 }}>{mp.text.slice(0, 50)}{mp.text.length > 50 ? '...' : ''}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 8 }}>
                    {mp.attempt_count}× · avg {mp.avg_score}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {historyData.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>No attempts yet. Start practicing!</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {historyData.map((a) => (
            <div
              key={a.id}
              className="card"
              style={{ padding: '12px 16px', cursor: a.feedback?.word_feedback ? 'pointer' : 'default' }}
              onClick={() => a.feedback?.word_feedback && setExpandedAttemptId(expandedAttemptId === a.id ? null : a.id)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                  {a.feedback?.word_feedback && (
                    expandedAttemptId === a.id
                      ? <ChevronDown size={14} color="var(--text-secondary)" />
                      : <ChevronRight size={14} color="var(--text-secondary)" />
                  )}
                  <span style={{ fontSize: 14 }}>{a.reference_text.slice(0, 60)}{a.reference_text.length > 60 ? '...' : ''}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {a.score != null && (
                    <span style={{
                      padding: '2px 8px', borderRadius: 12, fontSize: 13, fontWeight: 600,
                      background: a.score >= 8 ? '#dcfce7' : a.score >= 5 ? '#fef9c3' : '#fee2e2',
                      color: a.score >= 8 ? '#15803d' : a.score >= 5 ? '#a16207' : '#b91c1c',
                    }}>
                      {a.score}/10
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{formatDateTime(a.created_at)}</span>
                </div>
              </div>

              {expandedAttemptId === a.id && a.feedback?.word_feedback && (() => {
                const wf = a.feedback!.word_feedback;
                const total = wf.length;
                const correct = wf.filter((w) => w.is_correct).length;
                const partial = wf.filter((w) => !w.is_correct && w.heard !== 'missing').length;
                const incorrect = total - correct - partial;
                return (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                    {a.user_transcription && (
                      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
                        <strong>You said:</strong> "{a.user_transcription}"
                      </p>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                      <span style={{ color: '#22c55e' }}>✓ {correct}</span>
                      <span style={{ color: '#f59e0b' }}>~ {partial}</span>
                      <span style={{ color: '#ef4444' }}>✗ {incorrect}</span>
                    </div>
                    <div className="accuracy-bar" role="img" aria-label={`Accuracy: ${correct} correct, ${partial} partial, ${incorrect} incorrect out of ${total} words`}>
                      {correct > 0 && <div className="accuracy-segment correct" style={{ width: `${(correct / total) * 100}%` }} />}
                      {partial > 0 && <div className="accuracy-segment partial" style={{ width: `${(partial / total) * 100}%` }} />}
                      {incorrect > 0 && <div className="accuracy-segment incorrect" style={{ width: `${(incorrect / total) * 100}%` }} />}
                    </div>

                    <div className="word-comparison" style={{ marginTop: 8 }}>
                      {wf.map((w, j) => {
                        const chipClass = w.is_correct ? 'word-correct' : (w.heard !== 'missing' ? 'word-partial' : 'word-incorrect');
                        return (
                          <div key={j} className={`word-chip ${chipClass}`} title={w.tip || 'Correct!'}>
                            {w.expected}
                            {!w.is_correct && w.heard !== 'missing' && (
                              <span style={{ fontSize: 11, display: 'block' }}>→ "{w.heard}"</span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {wf.some((w) => !w.is_correct && w.tip) && (
                      <div style={{ marginTop: 8 }}>
                        {wf.filter((w) => !w.is_correct && w.tip).map((w, j) => (
                          <p key={j} style={{ fontSize: 12, marginBottom: 2, color: 'var(--text-secondary)' }}>
                            • <strong>{w.expected}:</strong> {w.tip}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
