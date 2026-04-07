import { Keyboard, X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ['Ctrl', 'Enter'], description: 'Send message' },
  { keys: ['Escape'], description: 'End conversation' },
  { keys: ['M'], description: 'Toggle microphone' },
  { keys: ['?'], description: 'Show/hide this panel' },
];

export default function KeyboardShortcutsPanel({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="shortcuts-overlay" onClick={onClose} role="dialog" aria-label="Keyboard shortcuts">
      <div className="shortcuts-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Keyboard size={18} /> Keyboard Shortcuts
          </h3>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close shortcuts panel">
            <X size={16} />
          </button>
        </div>
        <div className="shortcuts-grid">
          {SHORTCUTS.map((s, i) => (
            <div key={i} className="shortcut-row">
              <span className="shortcut-keys">
                {s.keys.map((k, j) => (
                  <span key={j}>
                    {j > 0 && <span style={{ margin: '0 2px', color: 'var(--text-secondary)' }}>+</span>}
                    <kbd className="kbd">{k}</kbd>
                  </span>
                ))}
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>{s.description}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
