import { useState } from 'react';
import { PlayCircle, Download, RotateCcw } from 'lucide-react';
import type { ChatMessage, ConversationSummary as ConversationSummaryType } from '../../api';
import { api } from '../../api';
import { FeedbackPanel } from './FeedbackPanel';
import { TurnRepracticeDrill } from './TurnRepracticeDrill';
import { formatDateTime } from '../../utils/formatDate';

interface ConversationHistoryProps {
  historyMessages: ChatMessage[];
  historySummary: ConversationSummaryType | null;
  conversationId: number | null;
  replayLoading: boolean;
  onBack: () => void;
  onReplay: (id: number) => void;
  tts: { speak: (text: string) => void; isSpeaking: boolean };
}

export function ConversationHistory({
  historyMessages,
  historySummary,
  conversationId,
  replayLoading,
  onBack,
  onReplay,
  tts,
}: ConversationHistoryProps) {
  const [downloading, setDownloading] = useState(false);
  const [repracticeIdx, setRepracticeIdx] = useState<number | null>(null);

  async function handleDownload() {
    if (!conversationId || downloading) return;
    setDownloading(true);
    try {
      const data = await api.exportConversation(conversationId);
      const lines: string[] = ['📝 English Practice Session', ''];
      if (historySummary) {
        if (historySummary.communication_level) lines.push(`Level: ${historySummary.communication_level}`);
        lines.push('', '--- Summary ---', historySummary.summary || '', '');
        if (historySummary.key_vocabulary?.length) lines.push('--- Key Vocabulary ---', historySummary.key_vocabulary.join(', '), '');
        if (historySummary.tip) lines.push('--- Tip ---', historySummary.tip, '');
      }
      const msgLines = data.messages?.map((m: { role: string; content: string }) => `[${m.role}] ${m.content}`) ?? [];
      if (msgLines.length) lines.push('--- Transcript ---', ...msgLines, '');
      const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conversation-${conversationId}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* download failed */ }
    setDownloading(false);
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={onBack}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: 'var(--text)' }}
        >
          ← Back to scenarios
        </button>
        {conversationId && (
          <button
            onClick={() => onReplay(conversationId)}
            disabled={replayLoading}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: replayLoading ? 'not-allowed' : 'pointer', background: 'var(--primary, #6366f1)', color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <PlayCircle size={16} />
            {replayLoading ? 'Loading…' : 'Replay'}
          </button>
        )}
        {conversationId && (
          <button
            onClick={handleDownload}
            disabled={downloading}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', cursor: downloading ? 'not-allowed' : 'pointer', background: 'transparent', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}
            aria-label="Download transcript"
          >
            <Download size={16} />
            {downloading ? 'Downloading…' : 'Download'}
          </button>
        )}
      </div>
      <h2 style={{ marginBottom: 16 }}>Conversation History</h2>

      {historySummary && (
        <div className="card summary-card" style={{ marginBottom: 24 }}>
          <p style={{ marginBottom: 12 }}>{historySummary.summary}</p>
          {historySummary.key_vocabulary?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <strong style={{ fontSize: 13 }}>Key Vocabulary:</strong>
              <div className="vocab-tags" style={{ marginTop: 4 }}>
                {historySummary.key_vocabulary.map((w: string) => (
                  <span key={w}>{w}</span>
                ))}
              </div>
            </div>
          )}
          <p style={{ fontSize: 13, marginBottom: 4 }}>
            <strong>Level:</strong> {historySummary.communication_level}
          </p>
          <p style={{ fontSize: 13, color: 'var(--primary-dark)' }}>
            <strong>Tip:</strong> {historySummary.tip}
          </p>
          {historySummary.performance && historySummary.performance.total_user_messages > 0 && (
            <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8 }}>
              <strong style={{ fontSize: 13 }}>Performance:</strong>
              <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 13 }}>
                <span>{historySummary.performance.total_user_messages} messages</span>
                {historySummary.performance.grammar_checked > 0 && (
                  <span>{historySummary.performance.grammar_accuracy_rate}% grammar accuracy ({historySummary.performance.grammar_correct}/{historySummary.performance.grammar_checked})</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="chat-container" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        {historyMessages.map((msg, i) => {
          const isUser = msg.role === 'user';
          const prevMsg = i > 0 ? historyMessages[i - 1] : null;
          const hasAiContext = isUser && prevMsg && prevMsg.role === 'assistant';

          return (
            <div key={i} className={`chat-message ${msg.role}`} style={{ marginBottom: 12 }}>
              <div className={`message-bubble ${msg.role}`}>
                <p>{msg.content}</p>
                {msg.feedback && <FeedbackPanel feedback={msg.feedback} onSpeak={tts.speak} />}
                {isUser && hasAiContext && (
                  <button
                    onClick={() => setRepracticeIdx(repracticeIdx === i ? null : i)}
                    style={{
                      marginTop: 6, padding: '4px 10px', borderRadius: 6,
                      border: '1px solid var(--border)', background: 'transparent',
                      color: 'var(--primary)', cursor: 'pointer', fontSize: 12,
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    <RotateCcw size={12} /> Re-practice
                  </button>
                )}
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {formatDateTime(msg.created_at)}
              </span>
              {repracticeIdx === i && hasAiContext && prevMsg && (
                <TurnRepracticeDrill
                  aiMessage={prevMsg.content}
                  originalUserMessage={msg.content}
                  ttsSpeak={tts.speak}
                  onClose={() => setRepracticeIdx(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
