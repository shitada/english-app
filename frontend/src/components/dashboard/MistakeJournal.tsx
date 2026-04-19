import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Volume2, Mic } from 'lucide-react';
import type { MistakeItem } from '../../api';
import { formatRelativeTime } from '../../utils/formatDate';
import { sanitizeForSpeech } from '../../utils/sanitizeForSpeech';
import { wordSimilarity, classifySimilarity } from '../../utils/similarity';
import { useSpeechSynthesis } from '../../hooks/useSpeechSynthesis';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';

export function getTargetText(item: MistakeItem): string {
  const d = (item.detail || {}) as Record<string, string | number>;
  if (item.module === 'grammar') return String(d.correction || '');
  if (item.module === 'pronunciation') return String(d.reference_text || '');
  if (item.module === 'vocabulary') return String(d.word || '');
  return '';
}

export function shadowBadge(percent: number): { emoji: '✅' | '👍' | '🔁'; label: string } {
  if (percent >= 90) return { emoji: '✅', label: `${percent}% match` };
  if (percent >= 60) return { emoji: '👍', label: `${percent}%` };
  return { emoji: '🔁', label: `${percent}% — try again` };
}

interface MistakeJournalProps {
  mistakes: MistakeItem[];
  filter: 'all' | 'grammar' | 'pronunciation' | 'vocabulary';
  setFilter: (f: 'all' | 'grammar' | 'pronunciation' | 'vocabulary') => void;
  total: number;
  onLoadMore: () => void;
  onStartReview?: () => void;
  hasGrammarMistakes?: boolean;
}

export function MistakeJournal({ mistakes, filter, setFilter, total, onLoadMore, onStartReview, hasGrammarMistakes }: MistakeJournalProps) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <AlertTriangle size={20} color="#f59e0b" />
        <h3 style={{ margin: 0 }}>Mistake Journal</h3>
        {total > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
            {total} total
          </span>
        )}
        {onStartReview && hasGrammarMistakes && (
          <button
            onClick={onStartReview}
            className="btn btn-primary"
            style={{ fontSize: 12, padding: '3px 10px', marginLeft: total > 0 ? 8 : 'auto' }}
          >
            ✏️ Practice Mistakes
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['all', 'grammar', 'pronunciation', 'vocabulary'] as const).map(f => (
          <button
            key={f}
            className={`btn ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter(f)}
            style={{ fontSize: 12, padding: '3px 10px' }}
          >
            {f === 'all' ? 'All' : f === 'grammar' ? '📝 Grammar' : f === 'pronunciation' ? '🎙️ Pronunciation' : '📚 Vocabulary'}
          </button>
        ))}
      </div>

      {mistakes.length === 0 ? (
        <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 14, padding: 16 }}>
          No mistakes recorded yet. Keep practicing!
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mistakes.map((m, i) => (
            <MistakeCard key={`${m.module}-${i}`} item={m} />
          ))}
          {mistakes.length < total && (
            <button className="btn btn-secondary" onClick={onLoadMore} style={{ alignSelf: 'center', marginTop: 8 }}>
              Load More
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MistakeCard({ item }: { item: MistakeItem }) {
  const d = (item.detail || {}) as Record<string, string | number>;
  const icon = item.module === 'grammar' ? '📝' : item.module === 'pronunciation' ? '🎙️' : '📚';
  const targetText = getTargetText(item);

  const tts = useSpeechSynthesis();
  const speech = useSpeechRecognition({ continuous: false });
  const [shadowResult, setShadowResult] = useState<
    { transcript: string; percent: number; emoji: '✅' | '👍' | '🔁'; label: string } | null
  >(null);

  // Score the transcript when the user finishes speaking.
  useEffect(() => {
    if (!speech.isListening && speech.transcript && targetText) {
      const sim = wordSimilarity(targetText, speech.transcript);
      const v = classifySimilarity(sim);
      const badge = shadowBadge(v.percent);
      setShadowResult({
        transcript: speech.transcript,
        percent: v.percent,
        emoji: badge.emoji,
        label: badge.label,
      });
    }
  }, [speech.isListening, speech.transcript, targetText]);

  // Stop TTS / ASR if the card unmounts mid-playback.
  useEffect(() => {
    return () => {
      try { speech.stop(); } catch { /* noop */ }
      try { tts.stop(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleListen = useCallback(() => {
    if (!targetText) return;
    tts.speak(sanitizeForSpeech(targetText));
  }, [targetText, tts]);

  const handleShadow = useCallback(() => {
    setShadowResult(null);
    speech.reset();
    speech.start();
  }, [speech]);

  const handleStopShadow = useCallback(() => {
    speech.stop();
  }, [speech]);

  const canShadow = speech.isSupported && !!targetText;

  return (
    <div
      data-testid="mistake-card"
      style={{ padding: '8px 12px', background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8, fontSize: 13 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span>{icon}</span>
        <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{item.module}</span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {formatRelativeTime(item.created_at)}
        </span>
      </div>
      {item.module === 'grammar' && (
        <div>
          <p><span style={{ color: '#ef4444', textDecoration: 'line-through' }}>{String(d.original || '')}</span> → <span style={{ color: '#22c55e' }}>{String(d.correction || '')}</span></p>
          {d.explanation && <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{String(d.explanation)}</p>}
        </div>
      )}
      {item.module === 'pronunciation' && (
        <div>
          <p>Expected: <strong>{String(d.reference_text || '')}</strong></p>
          <p>You said: "{String(d.user_transcription || '')}" <span style={{ color: Number(d.score) >= 5 ? '#f59e0b' : '#ef4444', fontWeight: 600 }}>({d.score}/10)</span></p>
        </div>
      )}
      {item.module === 'vocabulary' && (
        <p><strong>{String(d.word || '')}</strong> — {String(d.meaning || '')}</p>
      )}

      {targetText && (
        <div
          data-testid="mistake-card-shadow-row"
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}
        >
          <button
            type="button"
            data-testid="mistake-card-listen"
            onClick={handleListen}
            disabled={!tts.isSupported}
            aria-label="Listen to correct form"
            className="btn btn-secondary"
            style={{ fontSize: 11, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <Volume2 size={12} /> {tts.isSpeaking ? 'Playing…' : 'Listen 🔊'}
          </button>
          {canShadow && (
            <button
              type="button"
              data-testid="mistake-card-shadow"
              onClick={speech.isListening ? handleStopShadow : handleShadow}
              aria-pressed={speech.isListening}
              aria-label={speech.isListening ? 'Stop shadow recording' : 'Start shadow recording'}
              className={`btn ${speech.isListening ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: 11, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <Mic size={12} /> {speech.isListening ? 'Stop' : 'Shadow 🎤'}
            </button>
          )}
          {speech.isListening && (
            <span
              data-testid="mistake-card-interim"
              aria-live="polite"
              style={{ fontSize: 11, color: 'var(--text-secondary)' }}
            >
              🎙️ {speech.interimTranscript || speech.transcript || 'Listening…'}
            </span>
          )}
          {shadowResult && !speech.isListening && (
            <span
              data-testid="mistake-card-shadow-result"
              style={{ fontSize: 11, color: 'var(--text-secondary)' }}
            >
              <span aria-label={`shadow score ${shadowResult.percent} percent`}>
                {shadowResult.emoji}
              </span>{' '}
              {shadowResult.label} — "{shadowResult.transcript}"
            </span>
          )}
          {speech.error && !speech.isListening && (
            <span
              data-testid="mistake-card-shadow-error"
              style={{ fontSize: 11, color: '#ef4444' }}
            >
              {speech.error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
