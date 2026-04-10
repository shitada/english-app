import { useState, useEffect } from 'react';
import { Volume2, Copy, Download, Share2, TrendingUp, TrendingDown, Eye, EyeOff, FileSpreadsheet } from 'lucide-react';
import type { GrammarFeedback, ConversationQuizQuestion, SessionAveragesResponse } from '../../api';
import { api, getSessionAverages } from '../../api';
import { generateStudyCardsCSV, hasStudyCards } from '../../utils/csvExport';
import { ConversationQuiz } from './ConversationQuiz';
import { CorrectionDrill } from './CorrectionDrill';
import { SpeakCorrectionDrill } from './SpeakCorrectionDrill';
import { DictationExercise } from './DictationExercise';
import { ShadowingExercise } from './ShadowingExercise';
import { ClozeExercise } from './ClozeExercise';
import { RephraseChallenge } from './RephraseChallenge';
import { ShareCard } from './ShareCard';

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
  tts: { speak: (text: string) => void; isSpeaking: boolean };
  conversationId?: number;
  speechRecognition?: {
    isListening: boolean;
    transcript: string;
    startListening: () => void;
    stopListening: () => void;
    reset?: () => void;
  };
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
  tts,
  conversationId,
  speechRecognition,
}: ConversationSummaryProps) {
  const [copied, setCopied] = useState(false);
  const [showShareCard, setShowShareCard] = useState(false);
  const [averages, setAverages] = useState<SessionAveragesResponse | null>(null);

  useEffect(() => {
    getSessionAverages().then(setAverages).catch(() => {});
  }, []);

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

  return (
    <div className="card summary-card">
      <h2 style={{ marginBottom: 16 }}>Conversation Complete!</h2>
      <p style={{ marginBottom: 16 }}>{summary.summary}</p>

      {summary.key_vocabulary?.length > 0 && (
        <>
          <h4>Key Vocabulary</h4>
          <div className="vocab-tags">
            {summary.key_vocabulary.map((w: string) => (
              <span key={w}>{w}</span>
            ))}
          </div>
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
