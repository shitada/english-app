import { Volume2 } from 'lucide-react';
import type { GrammarNote } from '../../api';

interface GrammarNotesPanelProps {
  notes: GrammarNote[];
  onSpeak: (text: string) => void;
  onClose: () => void;
}

export function GrammarNotesPanel({ notes, onSpeak, onClose }: GrammarNotesPanelProps) {
  if (notes.length === 0) {
    return (
      <div style={{
        padding: 16, background: 'var(--bg-card, #fff)', border: '1px solid var(--border, #e5e7eb)',
        borderRadius: 8, marginBottom: 12,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h4 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-primary, #111827)' }}>📖 Grammar Notes</h4>
          <button onClick={onClose} className="btn-touch" aria-label="Close grammar notes"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-secondary)' }}>×</button>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary, #6b7280)' }}>
          No grammar notes yet. Keep chatting to discover grammar patterns!
        </p>
      </div>
    );
  }

  return (
    <div style={{
      padding: 16, background: 'var(--bg-card, #fff)', border: '1px solid var(--border, #e5e7eb)',
      borderRadius: 8, marginBottom: 12, maxHeight: 300, overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h4 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-primary, #111827)' }}>
          📖 Grammar Notes ({notes.length})
        </h4>
        <button onClick={onClose} className="btn-touch" aria-label="Close grammar notes"
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-secondary)' }}>×</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {notes.map((note, i) => (
          <div key={`${note.phrase}-${i}`} style={{
            padding: '10px 12px', borderRadius: 8,
            background: 'var(--bg-secondary, #f9fafb)',
            border: '1px solid var(--border, #e5e7eb)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <button
                onClick={() => onSpeak(note.phrase)}
                className="btn-touch"
                aria-label={`Listen to: ${note.phrase}`}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                  color: 'var(--primary, #6366f1)', flexShrink: 0,
                }}
              >
                <Volume2 size={14} />
              </button>
              <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary, #111827)' }}>
                "{note.phrase}"
              </span>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary, #6366f1)', marginBottom: 2, paddingLeft: 30 }}>
              {note.grammar_point}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary, #6b7280)', lineHeight: 1.4, paddingLeft: 30 }}>
              {note.explanation}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
