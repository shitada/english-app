import { useState, useEffect, useCallback } from 'react';
import { Volume2, Copy, Download, Share2, TrendingUp, TrendingDown, Eye, EyeOff, FileSpreadsheet, BookmarkPlus, Check } from 'lucide-react';
import type { GrammarFeedback, ConversationQuizQuestion, SessionAveragesResponse } from '../../api';
import { api, getSessionAverages } from '../../api';
import { generateStudyCardsCSV, hasStudyCards } from '../../utils/csvExport';
import { computeFluencyScore } from '../../utils/fluencyScore';
import type { FluencyResult } from '../../utils/fluencyScore';
import { useI18n } from '../../i18n/I18nContext';
import { ConversationQuiz } from './ConversationQuiz';
import { CorrectionDrill } from './CorrectionDrill';
import { SpeakCorrectionDrill } from './SpeakCorrectionDrill';
import { DictationExercise } from './DictationExercise';
import { ShadowingExercise } from './ShadowingExercise';
import { ClozeExercise } from './ClozeExercise';
import { RephraseChallenge } from './RephraseChallenge';
import { SpokenRetelling } from './SpokenRetelling';
import { ExpressItBetter } from './ExpressItBetter';
import { ShareCard } from './ShareCard';
import { NextStepsCard } from './NextStepsCard';
import type { NextStepsData } from './NextStepsCard';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  feedback?: GrammarFeedback;
  key_phrases?: string[];
}

interface ConversationSummaryProps {
  summary: any;
  messages: Message[];
  quizQuestions: ConversationQuizQuestion[];
  quizIndex: number;
  quizAnswers: (number | null)[];
  quizRevealed: boolean;
  quizFinished: boolean;
  quizLoading: boolean;
  quizError: string;
  onAnswerQuiz: (optionIndex: number) => void;
  onNextQuiz: () => void;
  onStartQuiz: () => void;
  onNewConversation: () => void;
  onPracticeAgain?: () => void;
  topicLabel?: string;
  tts: { speak: (text: string) => void; isSpeaking: boolean };
  conversationId?: number;
  vocabTargetCount?: number;
  vocabUsedCount?: number;
  speechRecognition?: {
    isListening: boolean;
    transcript: string;
    startListening: () => void;
    stopListening: () => void;
    reset?: () => void;
  };
  fillerCount?: number;
  fillerDetails?: Record<string, number>;
  responseTimes?: number[];
  correctionAttempts?: number;
  correctionSuccesses?: number;
  hintCount?: number;
  bestGrammarStreak?: number;
}

export function ConversationSummary({
  summary,
  messages,
  quizQuestions,
  quizIndex,
  quizAnswers,
  quizRevealed,
  quizFinished,
  quizLoading,
  quizError,
  onAnswerQuiz,
  onNextQuiz,
  onStartQuiz,
  onNewConversation,
  onPracticeAgain,
  topicLabel,
  tts,
  conversationId,
  vocabTargetCount,
  vocabUsedCount,
  speechRecognition,
  fillerCount,
  fillerDetails,
  responseTimes,
  correctionAttempts,
  correctionSuccesses,
  hintCount,
  bestGrammarStreak,
}: ConversationSummaryProps) {
  const [copied, setCopied] = useState(false);
  const [showShareCard, setShowShareCard] = useState(false);
  const [averages, setAverages] = useState<SessionAveragesResponse | null>(null);
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [savingWords, setSavingWords] = useState<Set<string>>(new Set());
  const [saveAllLoading, setSaveAllLoading] = useState(false);
  const [topicProgress, setTopicProgress] = useState<{
    has_previous: boolean;
    current: Record<string, number>;
    previous: Record<string, number> | null;
    deltas: Record<string, number> | null;
  } | null>(null);

  // Self-Assessment state
  const [selfAssessment, setSelfAssessment] = useState<{
    confidence_rating: number;
    fluency_rating: number;
    comprehension_rating: number;
  } | null>(null);
  const [saRatings, setSaRatings] = useState({ confidence: 0, fluency: 0, comprehension: 0 });
  const [saSubmitting, setSaSubmitting] = useState(false);
  const [saSubmitted, setSaSubmitted] = useState(false);
  const [gaugeAnimated, setGaugeAnimated] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);

  // Compute fluency score when performance data exists
  const fluencyResult: FluencyResult | null =
    summary.performance && summary.performance.total_user_messages > 0
      ? computeFluencyScore(summary.performance)
      : null;

  const { t } = useI18n();

  // Trigger gauge animation after mount
  useEffect(() => {
    if (fluencyResult) {
      const timer = setTimeout(() => setGaugeAnimated(true), 80);
      return () => clearTimeout(timer);
    }
  }, [fluencyResult !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    getSessionAverages().then(setAverages).catch(() => {});
  }, []);

  useEffect(() => {
    if (conversationId) {
      api.getTopicProgress(conversationId).then(setTopicProgress).catch(() => {});
    }
  }, [conversationId]);

  // Load existing self-assessment on mount
  useEffect(() => {
    if (conversationId) {
      api.getConversationSelfAssessment(conversationId)
        .then((data) => {
          setSelfAssessment(data);
          setSaRatings({
            confidence: data.confidence_rating,
            fluency: data.fluency_rating,
            comprehension: data.comprehension_rating,
          });
          setSaSubmitted(true);
        })
        .catch(() => {});
    }
  }, [conversationId]);

  const handleSelfAssessmentSubmit = useCallback(async () => {
    if (!conversationId || saSubmitting) return;
    if (saRatings.confidence === 0 || saRatings.fluency === 0 || saRatings.comprehension === 0) return;
    setSaSubmitting(true);
    try {
      const result = await api.saveConversationSelfAssessment(conversationId, {
        confidence_rating: saRatings.confidence,
        fluency_rating: saRatings.fluency,
        comprehension_rating: saRatings.comprehension,
      });
      setSelfAssessment(result);
      setSaSubmitted(true);
    } catch { /* save failed */ }
    setSaSubmitting(false);
  }, [conversationId, saRatings, saSubmitting]);

  function formatSummaryText(): string {
    const lines: string[] = ['📝 English Practice Session', ''];
    if (summary.communication_level) lines.push(`Level: ${summary.communication_level}`);
    lines.push(`Date: ${new Date().toLocaleDateString()}`, '');
    lines.push('--- Summary ---', summary.summary || '', '');
    if (summary.performance && summary.performance.total_user_messages > 0) {
      const p = summary.performance;
      lines.push('--- Performance ---');
      const parts = [`Messages: ${p.total_user_messages}`];
      if (p.grammar_checked > 0) parts.push(`Grammar: ${p.grammar_accuracy_rate}%`);
      if (p.avg_words_per_message > 0) parts.push(`Avg Words/Msg: ${p.avg_words_per_message}`);
      lines.push(parts.join(' | '), '');
    }
    if (summary.key_vocabulary?.length > 0) {
      lines.push('--- Key Vocabulary ---', summary.key_vocabulary.join(', '), '');
    }
    if (summary.tip) lines.push('--- Tip ---', summary.tip, '');
    return lines.join('\n');
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(formatSummaryText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard not available */ }
  }

  async function handleDownload() {
    try {
      let text = formatSummaryText();
      if (conversationId) {
        const data = await api.exportConversation(conversationId);
        const msgLines = data.messages?.map((m: { role: string; content: string }) => `[${m.role}] ${m.content}`) ?? [];
        if (msgLines.length) text += '\n--- Transcript ---\n' + msgLines.join('\n') + '\n';
      }
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conversation-${conversationId ?? 'summary'}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* download failed */ }
  }

  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'English Practice Session', text: formatSummaryText() });
      } catch { /* share cancelled */ }
    }
  }

  function handleDownloadStudyCards() {
    const csv = generateStudyCardsCSV(messages, summary);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `study-cards-${conversationId ?? 'session'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const showStudyCardsBtn = hasStudyCards(messages, summary);

  async function handleSaveWord(word: string) {
    if (!conversationId || savedWords.has(word) || savingWords.has(word)) return;
    setSavingWords(prev => new Set(prev).add(word));
    try {
      await api.saveConversationVocabulary(conversationId, [word]);
      setSavedWords(prev => new Set(prev).add(word));
    } catch { /* save failed */ }
    setSavingWords(prev => { const next = new Set(prev); next.delete(word); return next; });
  }

  async function handleSaveAllWords() {
    if (!conversationId || saveAllLoading) return;
    const unsaved = (summary.key_vocabulary as string[]).filter((w: string) => !savedWords.has(w));
    if (unsaved.length === 0) return;
    setSaveAllLoading(true);
    try {
      await api.saveConversationVocabulary(conversationId, unsaved);
      setSavedWords(prev => {
        const next = new Set(prev);
        unsaved.forEach((w: string) => next.add(w));
        return next;
      });
    } catch { /* save failed */ }
    setSaveAllLoading(false);
  }

  const allVocabSaved = (summary.key_vocabulary as string[] | undefined)?.length
    ? (summary.key_vocabulary as string[]).every((w: string) => savedWords.has(w))
    : false;

  return (
    <div className="card summary-card">
      <h2 style={{ marginBottom: 16 }}>Conversation Complete!</h2>
      <p style={{ marginBottom: 16 }}>{summary.summary}</p>

      {/* Fluency Score Gauge */}
      {fluencyResult && (() => {
        const size = 140;
        const strokeWidth = 10;
        const radius = (size - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;
        const progress = gaugeAnimated ? fluencyResult.score / 100 : 0;
        const dashOffset = circumference * (1 - progress);
        const subWeights = [
          { key: 'Grammar', value: fluencyResult.breakdown.grammar, weight: '30%', max: 100 },
          { key: 'Vocabulary', value: fluencyResult.breakdown.vocabulary, weight: '30%', max: 100 },
          { key: 'Complexity', value: fluencyResult.breakdown.complexity, weight: '25%', max: 100 },
          { key: 'Participation', value: fluencyResult.breakdown.participation, weight: '15%', max: 100 },
        ];
        return (
          <div
            data-testid="fluency-score-gauge"
            style={{
              marginBottom: 24,
              padding: 20,
              background: 'var(--bg-secondary, #f5f5f5)',
              borderRadius: 12,
              textAlign: 'center',
            }}
          >
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block', margin: '0 auto' }}>
              {/* Background ring */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="var(--border, #e5e7eb)"
                strokeWidth={strokeWidth}
              />
              {/* Score ring */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={fluencyResult.color}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                style={{ transition: 'stroke-dashoffset 1s ease-out' }}
              />
              {/* Score text */}
              <text
                x={size / 2}
                y={size / 2 - 6}
                textAnchor="middle"
                dominantBaseline="central"
                style={{ fontSize: 32, fontWeight: 700, fill: fluencyResult.color }}
              >
                {Math.round(fluencyResult.score)}
              </text>
              <text
                x={size / 2}
                y={size / 2 + 20}
                textAnchor="middle"
                dominantBaseline="central"
                style={{ fontSize: 11, fill: 'var(--text-secondary, #6b7280)' }}
              >
                / 100
              </text>
            </svg>

            <div style={{ marginTop: 8, fontSize: 16, fontWeight: 600, color: fluencyResult.color }}>
              {fluencyResult.label}
            </div>
            <div style={{ marginTop: 2, fontSize: 12, color: 'var(--text-secondary, #6b7280)' }}>
              Fluency Score
            </div>

            <button
              onClick={() => setShowBreakdown((prev) => !prev)}
              data-testid="fluency-breakdown-toggle"
              style={{
                marginTop: 10,
                padding: '4px 12px',
                fontSize: 12,
                background: 'none',
                border: '1px solid var(--border, #e5e7eb)',
                borderRadius: 6,
                cursor: 'pointer',
                color: 'var(--text-secondary, #6b7280)',
              }}
            >
              {showBreakdown ? 'Hide breakdown' : 'Show breakdown'}
            </button>

            {showBreakdown && (
              <div
                data-testid="fluency-breakdown"
                style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left' }}
              >
                {subWeights.map((s) => (
                  <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, minWidth: 90, color: 'var(--text-secondary, #6b7280)' }}>
                      {s.key} ({s.weight})
                    </span>
                    <div style={{ flex: 1, background: 'var(--border, #e5e7eb)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${s.max > 0 ? (s.value / s.max) * 100 : 0}%`,
                          height: '100%',
                          background: fluencyResult.color,
                          borderRadius: 4,
                          transition: 'width 0.6s ease',
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, minWidth: 32, textAlign: 'right' }}>
                      {s.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {summary.key_vocabulary?.length > 0 && (
        <>
          <h4>Key Vocabulary</h4>
          <div className="vocab-tags">
            {summary.key_vocabulary.map((w: string) => {
              const isSaved = savedWords.has(w);
              const isSaving = savingWords.has(w);
              return (
                <span
                  key={w}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    opacity: isSaved ? 0.7 : 1,
                  }}
                >
                  {w}
                  {isSaved ? (
                    <Check size={14} style={{ color: 'var(--success, #22c55e)' }} aria-label={`${w} saved`} />
                  ) : (
                    <button
                      onClick={() => handleSaveWord(w)}
                      disabled={isSaving || !conversationId}
                      aria-label={`Save ${w} to vocab bank`}
                      title="Save to Vocab Bank"
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: isSaving ? 'wait' : 'pointer',
                        padding: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        color: 'var(--primary)',
                        opacity: isSaving ? 0.5 : 1,
                      }}
                    >
                      <BookmarkPlus size={14} />
                    </button>
                  )}
                </span>
              );
            })}
          </div>
          {conversationId && !allVocabSaved && (
            <button
              onClick={handleSaveAllWords}
              disabled={saveAllLoading}
              style={{
                marginTop: 8,
                padding: '6px 14px',
                fontSize: 13,
                background: 'var(--primary)',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: saveAllLoading ? 'wait' : 'pointer',
                opacity: saveAllLoading ? 0.7 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <BookmarkPlus size={14} />
              {saveAllLoading ? 'Saving…' : 'Save All to Vocab Bank'}
            </button>
          )}
          {allVocabSaved && (
            <p style={{ marginTop: 8, fontSize: 13, color: 'var(--success, #22c55e)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Check size={14} /> All vocabulary saved to bank
            </p>
          )}
        </>
      )}

      <p style={{ marginBottom: 8 }}>
        <strong>Level:</strong> {summary.communication_level}
      </p>
      <p style={{ marginBottom: 24, color: 'var(--primary-dark)' }}>
        <strong>Tip:</strong> {summary.tip}
      </p>

      {summary.performance && summary.performance.total_user_messages > 0 && (
        <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8 }}>
          <h4 style={{ marginBottom: 8 }}>Performance</h4>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--primary)' }}>
                {summary.performance.total_user_messages}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Messages</div>
            </div>
            {summary.performance.grammar_checked > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: summary.performance.grammar_accuracy_rate >= 80 ? 'var(--success, #22c55e)' : summary.performance.grammar_accuracy_rate >= 50 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)' }}>
                  {summary.performance.grammar_accuracy_rate}%
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Grammar Accuracy</div>
              </div>
            )}
            {summary.performance.grammar_checked > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700 }}>
                  {summary.performance.grammar_correct}/{summary.performance.grammar_checked}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Correct</div>
              </div>
            )}
            {summary.performance.avg_words_per_message > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: summary.performance.avg_words_per_message >= 12 ? 'var(--success, #22c55e)' : summary.performance.avg_words_per_message >= 6 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)' }}>
                  {summary.performance.avg_words_per_message}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Avg Words/Msg</div>
              </div>
            )}
            {summary.performance.vocabulary_diversity > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: summary.performance.vocabulary_diversity >= 60 ? 'var(--success, #22c55e)' : summary.performance.vocabulary_diversity >= 40 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)' }}>
                  {summary.performance.vocabulary_diversity}%
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Vocab Diversity</div>
              </div>
            )}
            {summary.performance.total_words > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700 }}>
                  {summary.performance.total_words}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Total Words</div>
              </div>
            )}
            {summary.performance.speaking_pace_wpm > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: summary.performance.speaking_pace_wpm >= 100 ? 'var(--success, #22c55e)' : summary.performance.speaking_pace_wpm >= 60 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)' }}>
                  {summary.performance.speaking_pace_wpm}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>WPM Pace</div>
              </div>
            )}
            {vocabTargetCount != null && vocabTargetCount > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: (vocabUsedCount ?? 0) === vocabTargetCount ? 'var(--success, #22c55e)' : (vocabUsedCount ?? 0) > 0 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)' }}>
                  {vocabUsedCount ?? 0}/{vocabTargetCount}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Target Words</div>
              </div>
            )}
            {summary.performance.pace_trend && summary.performance.pace_trend.length >= 3 && (
              <div style={{ textAlign: 'center' }}>
                <svg width="60" height="30" viewBox={`0 0 60 30`} style={{ display: 'block', margin: '0 auto 2px' }}>
                  <polyline
                    fill="none"
                    stroke="var(--primary, #6366f1)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={(() => {
                      const vals = summary.performance.pace_trend as number[];
                      const maxV = Math.max(...vals);
                      const minV = Math.min(...vals);
                      const range = maxV - minV || 1;
                      return vals.map((v: number, i: number) =>
                        `${(i / (vals.length - 1)) * 56 + 2},${28 - ((v - minV) / range) * 24}`
                      ).join(' ');
                    })()}
                  />
                </svg>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Pace Trend</div>
              </div>
            )}
          </div>
        </div>
      )}

      {summary.pace_stats && summary.pace_stats.count > 0 && (() => {
        const ps = summary.pace_stats;
        const avg = ps.avg_wpm;
        let coachTip = t('paceTipNatural');
        let color = 'var(--success, #22c55e)';
        if (avg < 90) { coachTip = t('paceTipSlow'); color = 'var(--info, #3b82f6)'; }
        else if (avg > 160) { coachTip = t('paceTipFast'); color = 'var(--warning, #f59e0b)'; }
        return (
          <div data-testid="pacing-card" style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8 }}>
            <h4 style={{ marginBottom: 8 }}>🎙️ {t('pacingTitle')}</h4>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color }}>{Math.round(avg)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('paceAvg')} {t('paceWpmUnit')}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{Math.round(ps.min_wpm)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('paceMin')} {t('paceWpmUnit')}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{Math.round(ps.max_wpm)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('paceMax')} {t('paceWpmUnit')}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{ps.count}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Turns</div>
              </div>
            </div>
            <p style={{ marginTop: 8, marginBottom: 0, fontSize: 13, color: 'var(--text-secondary)' }}>{coachTip}</p>
          </div>
        );
      })()}

      {/* Session Insights — filler words, response time, corrections, hints, grammar streak */}
      {(() => {
        const hasFillers = (fillerCount ?? 0) > 0;
        const hasResponseTimes = (responseTimes ?? []).length > 0;
        const hasCorrections = (correctionAttempts ?? 0) > 0;
        const hasHints = (hintCount ?? 0) > 0;
        const hasStreak = (bestGrammarStreak ?? 0) >= 2;
        if (!hasFillers && !hasResponseTimes && !hasCorrections && !hasHints && !hasStreak) return null;

        const avgResponseTime = hasResponseTimes
          ? responseTimes!.reduce((a, b) => a + b, 0) / responseTimes!.length
          : 0;
        const responseTimeColor = avgResponseTime < 10
          ? 'var(--success, #22c55e)'
          : avgResponseTime < 20
            ? 'var(--warning, #f59e0b)'
            : 'var(--danger, #ef4444)';

        // Top filler words sorted by count descending
        const topFillers = fillerDetails
          ? Object.entries(fillerDetails)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([word, count]) => `${word} ×${count}`)
              .join(', ')
          : '';

        return (
          <div
            data-testid="session-insights-card"
            style={{
              marginBottom: 24,
              padding: 16,
              background: 'var(--bg-secondary, #f5f5f5)',
              borderRadius: 8,
            }}
          >
            <h4 style={{ marginBottom: 12 }}>Session Insights</h4>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              {hasFillers && (
                <div style={{ textAlign: 'center', minWidth: 80 }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--warning, #f59e0b)' }}>
                    {fillerCount}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>🗣️ Filler Words</div>
                  {topFillers && (
                    <div
                      data-testid="filler-breakdown"
                      style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}
                    >
                      {topFillers}
                    </div>
                  )}
                </div>
              )}
              {hasResponseTimes && (
                <div style={{ textAlign: 'center', minWidth: 80 }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: responseTimeColor }}>
                    {avgResponseTime.toFixed(1)}s
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>⏱️ Avg Response Time</div>
                </div>
              )}
              {hasCorrections && (
                <div style={{ textAlign: 'center', minWidth: 80 }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--primary, #6366f1)' }}>
                    {correctionSuccesses}/{correctionAttempts}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>✏️ Correction Drills</div>
                </div>
              )}
              {hasHints && (
                <div style={{ textAlign: 'center', minWidth: 80 }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--primary, #6366f1)' }}>
                    {hintCount}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>💡 Hints Used</div>
                </div>
              )}
              {hasStreak && (
                <div data-testid="best-grammar-streak" style={{ textAlign: 'center', minWidth: 80 }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--success, #22c55e)' }}>
                    🔥 {bestGrammarStreak}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Best Grammar Streak</div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Self-Assessment Reflection */}
      {conversationId && (
        <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8 }} data-testid="self-assessment-card">
          <h4 style={{ marginBottom: 12 }}>How did you feel?</h4>
          {saSubmitted && selfAssessment ? (
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              {([
                { key: 'confidence', label: 'Confidence', emojis: ['😰', '😟', '😐', '😊', '😎'] },
                { key: 'fluency', label: 'Fluency', emojis: ['🐢', '🚶', '🏃', '🏎️', '🚀'] },
                { key: 'comprehension', label: 'Comprehension', emojis: ['😵', '🤔', '😐', '💡', '🧠'] },
              ] as const).map(({ key, label, emojis }) => {
                const rating = key === 'confidence' ? selfAssessment.confidence_rating
                  : key === 'fluency' ? selfAssessment.fluency_rating
                  : selfAssessment.comprehension_rating;
                return (
                  <div key={key} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 24 }}>{emojis[rating - 1]}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}: {rating}/5</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div>
              {([
                { key: 'confidence' as const, label: 'Confidence', emojis: ['😰', '😟', '😐', '😊', '😎'] },
                { key: 'fluency' as const, label: 'Fluency', emojis: ['🐢', '🚶', '🏃', '🏎️', '🚀'] },
                { key: 'comprehension' as const, label: 'Comprehension', emojis: ['😵', '🤔', '😐', '💡', '🧠'] },
              ]).map(({ key, label, emojis }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, minWidth: 110 }}>{label}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {emojis.map((emoji, i) => (
                      <button
                        key={i}
                        onClick={() => setSaRatings(prev => ({ ...prev, [key]: i + 1 }))}
                        aria-label={`${label} rating ${i + 1}`}
                        style={{
                          fontSize: 22,
                          background: saRatings[key] === i + 1 ? 'var(--primary-light, rgba(99,102,241,0.15))' : 'none',
                          border: saRatings[key] === i + 1 ? '2px solid var(--primary, #6366f1)' : '2px solid transparent',
                          borderRadius: 8,
                          cursor: 'pointer',
                          padding: '4px 6px',
                          transition: 'all 0.15s ease',
                          opacity: saRatings[key] === 0 ? 0.7 : saRatings[key] === i + 1 ? 1 : 0.4,
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <button
                onClick={handleSelfAssessmentSubmit}
                disabled={saSubmitting || saRatings.confidence === 0 || saRatings.fluency === 0 || saRatings.comprehension === 0}
                data-testid="self-assessment-submit"
                style={{
                  marginTop: 8,
                  padding: '8px 20px',
                  fontSize: 14,
                  fontWeight: 600,
                  background: (saRatings.confidence > 0 && saRatings.fluency > 0 && saRatings.comprehension > 0) ? 'var(--primary, #6366f1)' : 'var(--text-secondary, #9ca3af)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  cursor: saSubmitting ? 'wait' : (saRatings.confidence > 0 && saRatings.fluency > 0 && saRatings.comprehension > 0) ? 'pointer' : 'not-allowed',
                  opacity: saSubmitting ? 0.7 : 1,
                }}
              >
                {saSubmitting ? 'Saving…' : 'Submit Reflection'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* vs. Your Average comparison */}
      {summary.performance && averages && averages.session_count > 0 && (
        <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8 }}>
          <h4 style={{ marginBottom: 10, fontSize: '0.9rem', color: 'var(--text-secondary, #6b7280)' }}>
            vs. Your Average ({averages.session_count} sessions)
          </h4>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {summary.performance.grammar_accuracy_rate > 0 && (() => {
              const diff = summary.performance.grammar_accuracy_rate - averages.avg_grammar_accuracy_rate;
              const improving = diff > 1;
              const declining = diff < -1;
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  {improving ? <TrendingUp size={14} color="var(--success, #22c55e)" /> : declining ? <TrendingDown size={14} color="var(--danger, #ef4444)" /> : null}
                  <span style={{ color: improving ? 'var(--success, #22c55e)' : declining ? 'var(--danger, #ef4444)' : 'var(--text-secondary)' }}>
                    Grammar: {diff > 0 ? '+' : ''}{diff.toFixed(0)}% vs avg
                  </span>
                </div>
              );
            })()}
            {summary.performance.avg_words_per_message > 0 && (() => {
              const diff = summary.performance.avg_words_per_message - averages.avg_avg_words_per_message;
              const improving = diff > 0.5;
              const declining = diff < -0.5;
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  {improving ? <TrendingUp size={14} color="var(--success, #22c55e)" /> : declining ? <TrendingDown size={14} color="var(--danger, #ef4444)" /> : null}
                  <span style={{ color: improving ? 'var(--success, #22c55e)' : declining ? 'var(--danger, #ef4444)' : 'var(--text-secondary)' }}>
                    Words/msg: {diff > 0 ? '+' : ''}{diff.toFixed(1)} vs avg
                  </span>
                </div>
              );
            })()}
            {summary.performance.vocabulary_diversity > 0 && (() => {
              const diff = summary.performance.vocabulary_diversity - averages.avg_vocabulary_diversity;
              const improving = diff > 1;
              const declining = diff < -1;
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  {improving ? <TrendingUp size={14} color="var(--success, #22c55e)" /> : declining ? <TrendingDown size={14} color="var(--danger, #ef4444)" /> : null}
                  <span style={{ color: improving ? 'var(--success, #22c55e)' : declining ? 'var(--danger, #ef4444)' : 'var(--text-secondary)' }}>
                    Vocab diversity: {diff > 0 ? '+' : ''}{diff.toFixed(0)}% vs avg
                  </span>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Topic Improvement Comparison */}
      {topicProgress && (
        <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8 }}>
          <h4 style={{ marginBottom: 10, fontSize: '0.9rem', color: 'var(--text-secondary, #6b7280)' }}>
            {topicProgress.has_previous ? '📈 vs. Last Time on This Topic' : '🆕 First Time on This Topic!'}
          </h4>
          {topicProgress.has_previous && topicProgress.deltas ? (
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {topicProgress.deltas.grammar_accuracy_rate !== undefined && (() => {
                const d = topicProgress.deltas!.grammar_accuracy_rate;
                const icon = d > 1 ? '↑' : d < -1 ? '↓' : '→';
                const color = d > 1 ? 'var(--success, #22c55e)' : d < -1 ? 'var(--danger, #ef4444)' : 'var(--text-secondary)';
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                    <span style={{ color }}>{icon}</span>
                    <span style={{ color }}>Grammar: {topicProgress.previous?.grammar_accuracy_rate}% → {topicProgress.current.grammar_accuracy_rate}%</span>
                  </div>
                );
              })()}
              {topicProgress.deltas.avg_words_per_message !== undefined && (() => {
                const d = topicProgress.deltas!.avg_words_per_message;
                const icon = d > 0.5 ? '↑' : d < -0.5 ? '↓' : '→';
                const color = d > 0.5 ? 'var(--success, #22c55e)' : d < -0.5 ? 'var(--danger, #ef4444)' : 'var(--text-secondary)';
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                    <span style={{ color }}>{icon}</span>
                    <span style={{ color }}>Words/msg: {topicProgress.previous?.avg_words_per_message} → {topicProgress.current.avg_words_per_message}</span>
                  </div>
                );
              })()}
              {topicProgress.deltas.vocabulary_diversity !== undefined && (() => {
                const d = topicProgress.deltas!.vocabulary_diversity;
                const icon = d > 1 ? '↑' : d < -1 ? '↓' : '→';
                const color = d > 1 ? 'var(--success, #22c55e)' : d < -1 ? 'var(--danger, #ef4444)' : 'var(--text-secondary)';
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                    <span style={{ color }}>{icon}</span>
                    <span style={{ color }}>Vocab diversity: {topicProgress.previous?.vocabulary_diversity}% → {topicProgress.current.vocabulary_diversity}%</span>
                  </div>
                );
              })()}
              {topicProgress.deltas.total_user_messages !== undefined && (() => {
                const d = topicProgress.deltas!.total_user_messages;
                const icon = d > 0 ? '↑' : d < 0 ? '↓' : '→';
                const color = d > 0 ? 'var(--success, #22c55e)' : d < 0 ? 'var(--danger, #ef4444)' : 'var(--text-secondary)';
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                    <span style={{ color }}>{icon}</span>
                    <span style={{ color }}>Messages: {topicProgress.previous?.total_user_messages} → {topicProgress.current.total_user_messages}</span>
                  </div>
                );
              })()}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
              Complete this topic again to see your improvement!
            </p>
          )}
        </div>
      )}

      {/* Personalized Next Steps */}
      {summary.performance && (() => {
        const avgRespTime = (responseTimes ?? []).length > 0
          ? responseTimes!.reduce((a, b) => a + b, 0) / responseTimes!.length
          : undefined;
        const nextStepsData: NextStepsData = {
          grammarAccuracy: summary.performance.grammar_checked > 0
            ? summary.performance.grammar_accuracy_rate
            : undefined,
          fillerCount: fillerCount,
          avgResponseTime: avgRespTime,
          avgWordsPerMessage: summary.performance.avg_words_per_message > 0
            ? summary.performance.avg_words_per_message
            : undefined,
          vocabDiversity: summary.performance.vocabulary_diversity > 0
            ? summary.performance.vocabulary_diversity
            : undefined,
        };
        return <NextStepsCard data={nextStepsData} />;
      })()}

      {/* Corrections Review */}
      {(() => {
        const allErrors = messages
          .filter((m) => m.feedback && !m.feedback.is_correct)
          .flatMap((m) => m.feedback!.errors || []);
        const allSuggestions = messages
          .filter((m) => m.feedback?.suggestions?.length)
          .flatMap((m) => m.feedback!.suggestions || []);

        if (allErrors.length === 0 && allSuggestions.length === 0) {
          return (
            <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8, textAlign: 'center' }}>
              <span style={{ fontSize: 24 }}>✅</span>
              <p style={{ margin: '8px 0 0', fontWeight: 600, color: 'var(--success, #22c55e)' }}>Perfect grammar!</p>
            </div>
          );
        }

        return (
          <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8 }}>
            {allErrors.length > 0 && (
              <>
                <h4 style={{ marginBottom: 8 }}>Your Corrections</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: allSuggestions.length > 0 ? 16 : 0 }}>
                  {allErrors.map((err, i) => (
                    <div key={`err-${i}`} style={{ padding: 10, background: 'var(--card-bg, #fff)', borderRadius: 6, borderLeft: '3px solid var(--danger, #ef4444)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ textDecoration: 'line-through', color: 'var(--danger, #ef4444)', fontSize: 14 }}>{err.original}</span>
                        <span style={{ color: 'var(--text-secondary)' }}>→</span>
                        <span style={{ color: 'var(--success, #22c55e)', fontWeight: 600, fontSize: 14 }}>{err.correction}</span>
                        <button
                          onClick={() => tts.speak(err.correction)}
                          disabled={tts.isSpeaking}
                          aria-label={`Listen to correction: ${err.correction}`}
                          style={{ background: 'none', border: 'none', cursor: tts.isSpeaking ? 'default' : 'pointer', padding: 2, opacity: tts.isSpeaking ? 0.4 : 0.7 }}
                        >
                          <Volume2 size={14} color="var(--primary, #6366f1)" />
                        </button>
                      </div>
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>{err.explanation}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
            {allSuggestions.length > 0 && (
              <>
                <h4 style={{ marginBottom: 8 }}>Style Suggestions</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {allSuggestions.map((sug, i) => (
                    <div key={`sug-${i}`} style={{ padding: 10, background: 'var(--card-bg, #fff)', borderRadius: 6, borderLeft: '3px solid var(--primary, #6366f1)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{sug.original}</span>
                        <span style={{ color: 'var(--text-secondary)' }}>→</span>
                        <span style={{ color: 'var(--primary, #6366f1)', fontWeight: 600, fontSize: 14 }}>{sug.better}</span>
                        <button
                          onClick={() => tts.speak(sug.better)}
                          disabled={tts.isSpeaking}
                          aria-label={`Listen to suggestion: ${sug.better}`}
                          style={{ background: 'none', border: 'none', cursor: tts.isSpeaking ? 'default' : 'pointer', padding: 2, opacity: tts.isSpeaking ? 0.4 : 0.7 }}
                        >
                          <Volume2 size={14} color="var(--primary, #6366f1)" />
                        </button>
                      </div>
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>{sug.explanation}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* Correction Drill — active recall practice */}
      {(() => {
        const drillErrors = messages
          .filter((m) => m.feedback && !m.feedback.is_correct)
          .flatMap((m) => m.feedback!.errors || []);
        return drillErrors.length > 0 ? (
          <>
            <CorrectionDrill errors={drillErrors} tts={tts} />
            {speechRecognition && (
              <SpeakCorrectionDrill errors={drillErrors} tts={tts} speechRecognition={speechRecognition} />
            )}
          </>
        ) : null;
      })()}

      {/* Shadowing Exercise — listen and repeat practice */}
      {conversationId && speechRecognition && (
        <ShadowingExercise
          conversationId={conversationId}
          tts={tts}
          speechRecognition={speechRecognition}
        />
      )}

      {/* Express It Better — upgrade your expressions */}
      {conversationId && speechRecognition && (
        <ExpressItBetter
          conversationId={conversationId}
          tts={tts}
          speechRecognition={speechRecognition}
        />
      )}

      {/* Dictation Exercise — listen and type practice */}
      {conversationId && (
        <DictationExercise
          conversationId={conversationId}
          tts={tts}
        />
      )}

      {/* Cloze Exercise — fill in the blank for key phrases */}
      <ClozeExercise messages={messages} />

      {/* Rephrase Challenge — say the same thing differently */}
      {conversationId && <RephraseChallenge conversationId={conversationId} />}

      {/* Spoken Retelling — summarize the conversation in your own words */}
      {conversationId && summary?.summary && (
        <SpokenRetelling conversationId={conversationId} summaryText={summary.summary} />
      )}

      <ConversationQuiz
        questions={quizQuestions}
        quizIndex={quizIndex}
        quizAnswers={quizAnswers}
        quizRevealed={quizRevealed}
        quizFinished={quizFinished}
        quizLoading={quizLoading}
        quizError={quizError}
        onAnswer={onAnswerQuiz}
        onNext={onNextQuiz}
        onStart={onStartQuiz}
      />

      {/* Share Card Preview */}
      {showShareCard && (
        <div style={{ marginBottom: 16 }}>
          <ShareCard summary={summary} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
        <button className="btn btn-primary" onClick={onNewConversation}>
          Start New Conversation
        </button>
        {onPracticeAgain && (
          <button
            className="btn btn-secondary"
            onClick={onPracticeAgain}
            aria-label={topicLabel ? `Practice ${topicLabel} again` : 'Same topic again'}
            style={{ display: 'flex', alignItems: 'center', gap: 6, borderColor: 'rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.08)' }}
          >
            🔄 Same Topic Again{topicLabel ? ` — ${topicLabel}` : ''}
          </button>
        )}
        <button
          className="btn btn-secondary"
          onClick={() => setShowShareCard(v => !v)}
          aria-label={showShareCard ? 'Hide share card' : 'Show share card'}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {showShareCard ? <EyeOff size={16} /> : <Eye size={16} />}
          {showShareCard ? 'Hide Card' : 'Share Card'}
        </button>
        <button className="btn btn-secondary" onClick={handleCopy} aria-label="Copy summary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Copy size={16} />
          {copied ? '✓ Copied!' : 'Copy Summary'}
        </button>
        <button className="btn btn-secondary" onClick={handleDownload} aria-label="Download transcript" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Download size={16} />
          Download
        </button>
        {showStudyCardsBtn && (
          <button className="btn btn-secondary" onClick={handleDownloadStudyCards} aria-label="Download study cards" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileSpreadsheet size={16} />
            Study Cards
          </button>
        )}
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <button className="btn btn-secondary" onClick={handleShare} aria-label="Share summary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Share2 size={16} />
            Share
          </button>
        )}
      </div>
    </div>
  );
}
