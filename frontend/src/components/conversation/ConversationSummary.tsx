import { Volume2 } from 'lucide-react';
import type { GrammarFeedback, ConversationQuizQuestion } from '../../api';
import { ConversationQuiz } from './ConversationQuiz';
import { CorrectionDrill } from './CorrectionDrill';
import { DictationExercise } from './DictationExercise';
import { ShadowingExercise } from './ShadowingExercise';

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
          <CorrectionDrill errors={drillErrors} tts={tts} />
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

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
        <button className="btn btn-primary" onClick={onNewConversation}>
          Start New Conversation
        </button>
      </div>
    </div>
  );
}
