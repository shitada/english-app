import { useState } from 'react';
import { Volume2 } from 'lucide-react';
import type { GrammarFeedback } from '../../api';

export function FeedbackPanel({ feedback, onSpeak }: { feedback: GrammarFeedback; onSpeak?: (text: string) => void }) {
  const [expanded, setExpanded] = useState(true);

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
        </>
      )}
    </div>
  );
}
