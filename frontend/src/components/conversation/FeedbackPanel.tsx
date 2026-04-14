import { useState, useRef } from 'react';
import { Volume2 } from 'lucide-react';
import type { GrammarFeedback } from '../../api';

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ');
}

function InlineCorrectionDiff({ userInput, correct }: { userInput: string; correct: string }) {
  const userWords = userInput.trim().split(/\s+/);
  const correctWords = correct.trim().split(/\s+/);
  const maxLen = Math.max(userWords.length, correctWords.length);
  return (
    <span>
      {Array.from({ length: maxLen }, (_, i) => {
        const uWord = userWords[i] || '';
        const cWord = correctWords[i] || '';
        const match = normalizeText(uWord) === normalizeText(cWord);
        return (
          <span key={i} style={{ color: match ? '#22c55e' : '#ef4444', fontWeight: match ? 400 : 600 }}>
            {uWord || '___'}{i < maxLen - 1 ? ' ' : ''}
          </span>
        );
      })}
    </span>
  );
}

export function FeedbackPanel({ feedback, onSpeak, onCorrectionAttempt }: {
  feedback: GrammarFeedback;
  onSpeak?: (text: string) => void;
  onCorrectionAttempt?: (success: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [tryAgainMode, setTryAgainMode] = useState(false);
  const [tryAgainInput, setTryAgainInput] = useState('');
  const [tryAgainResult, setTryAgainResult] = useState<'success' | 'retry' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (feedback.is_correct && (feedback.suggestions ?? []).length === 0) {
    return (
      <div className="feedback-panel correct">
        ✅ Great! Your English is correct.
      </div>
    );
  }

  return (
    <div className="feedback-panel" onClick={() => setExpanded(!expanded)}>
      <div style={{ cursor: 'pointer', fontWeight: 600, marginBottom: expanded ? 8 : 0 }}>
        {feedback.is_correct ? '💡 Suggestions' : '📝 Corrections & Suggestions'}
        <span style={{ float: 'right', fontSize: 12 }}>{expanded ? '▼' : '▶'}</span>
      </div>
      {expanded && (
        <>
          {(feedback.errors ?? []).map((err, i) => (
            <div key={i} className="feedback-error">
              <strong>{err.original}</strong> → <em>{err.correction}</em>
              {onSpeak && (
                <button
                  onClick={(e) => { e.stopPropagation(); onSpeak(err.correction); }}
                  aria-label={`Listen: ${err.correction}`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', verticalAlign: 'middle' }}
                >
                  <Volume2 size={13} color="var(--primary, #6366f1)" />
                </button>
              )}
              <br />
              <span style={{ fontSize: 12 }}>{err.explanation}</span>
            </div>
          ))}
          {(feedback.suggestions ?? []).map((sug, i) => (
            <div key={i} className="feedback-suggestion">
              💡 "{sug.original}" → <em>"{sug.better}"</em>
              {onSpeak && (
                <button
                  onClick={(e) => { e.stopPropagation(); onSpeak(sug.better); }}
                  aria-label={`Listen: ${sug.better}`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', verticalAlign: 'middle' }}
                >
                  <Volume2 size={13} color="var(--primary, #6366f1)" />
                </button>
              )}
              <br />
              <span style={{ fontSize: 12 }}>{sug.explanation}</span>
            </div>
          ))}
          {feedback.corrected_text && !feedback.is_correct && (
            <div style={{ marginTop: 8, padding: '6px 10px', background: '#fefce8', borderRadius: 6, fontSize: 12 }}>
              ✏️ <strong>Corrected:</strong> {feedback.corrected_text}
              {onSpeak && (
                <button
                  onClick={(e) => { e.stopPropagation(); onSpeak(feedback.corrected_text!); }}
                  aria-label="Listen to corrected text"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', verticalAlign: 'middle' }}
                >
                  <Volume2 size={13} color="var(--primary, #6366f1)" />
                </button>
              )}
            </div>
          )}
          {feedback.corrected_text && !feedback.is_correct && !tryAgainMode && tryAgainResult !== 'success' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setTryAgainMode(true);
                setTryAgainResult(null);
                setTryAgainInput('');
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
              style={{
                marginTop: 8, padding: '6px 14px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600,
                background: 'var(--primary, #6366f1)', color: 'white', border: 'none', cursor: 'pointer',
              }}
            >
              ✏️ Try Again
            </button>
          )}
          {tryAgainMode && feedback.corrected_text && (
            <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 8, padding: '10px 12px', background: 'var(--card-bg, #f8f9fa)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>Rewrite the sentence with corrections:</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  ref={inputRef}
                  value={tryAgainInput}
                  onChange={(e) => { setTryAgainInput(e.target.value); setTryAgainResult(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && tryAgainInput.trim()) {
                      const similarity = (() => {
                        const userWords = normalizeText(tryAgainInput).split(/\s+/);
                        const correctWords = normalizeText(feedback.corrected_text!).split(/\s+/);
                        const maxLen = Math.max(userWords.length, correctWords.length);
                        if (maxLen === 0) return 1;
                        let matches = 0;
                        for (let i = 0; i < maxLen; i++) {
                          if (userWords[i] === correctWords[i]) matches++;
                        }
                        return matches / maxLen;
                      })();
                      const success = similarity >= 0.9;
                      setTryAgainResult(success ? 'success' : 'retry');
                      if (success) setTryAgainMode(false);
                      onCorrectionAttempt?.(success);
                    }
                  }}
                  placeholder="Type your correction..."
                  style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: '0.85rem' }}
                />
                <button
                  onClick={() => {
                    if (!tryAgainInput.trim()) return;
                    const userWords = normalizeText(tryAgainInput).split(/\s+/);
                    const correctWords = normalizeText(feedback.corrected_text!).split(/\s+/);
                    const maxLen = Math.max(userWords.length, correctWords.length);
                    let matches = 0;
                    for (let i = 0; i < maxLen; i++) {
                      if (userWords[i] === correctWords[i]) matches++;
                    }
                    const similarity = maxLen > 0 ? matches / maxLen : 1;
                    const success = similarity >= 0.9;
                    setTryAgainResult(success ? 'success' : 'retry');
                    if (success) setTryAgainMode(false);
                    onCorrectionAttempt?.(success);
                  }}
                  style={{ padding: '6px 12px', borderRadius: 6, background: 'var(--primary, #6366f1)', color: 'white', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                >
                  Check
                </button>
              </div>
              {tryAgainResult === 'retry' && (
                <div style={{ marginTop: 6, fontSize: '0.8rem' }}>
                  <span style={{ color: '#f59e0b', fontWeight: 600 }}>Almost!</span>{' '}
                  <InlineCorrectionDiff userInput={tryAgainInput} correct={feedback.corrected_text!} />
                </div>
              )}
            </div>
          )}
          {tryAgainResult === 'success' && (
            <div style={{ marginTop: 8, padding: '6px 10px', background: '#dcfce7', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, color: '#16a34a' }}>
              ✅ Excellent! You got it right!
            </div>
          )}
        </>
      )}
    </div>
  );
}
