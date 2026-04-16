interface ConfirmDialogProps {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function ConfirmDialog({
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmDialogProps) {
  return (
    <div
      role="alertdialog"
      aria-label={message}
      style={{
        padding: '14px 18px',
        borderRadius: 12,
        background: 'var(--danger-bg, #fef2f2)',
        border: '1px solid var(--danger-border, #fecaca)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ color: 'var(--danger-text, #b91c1c)', fontSize: '0.9rem', fontWeight: 500 }}>
        ⚠️ {message}
      </span>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={onCancel}
          disabled={loading}
          style={{
            padding: '6px 14px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--card-bg)',
            color: 'var(--text-primary)',
            fontSize: '0.85rem',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          style={{
            padding: '6px 14px',
            borderRadius: 8,
            border: '1px solid var(--danger-border, #fecaca)',
            background: 'var(--danger-text, #b91c1c)',
            color: '#fff',
            fontSize: '0.85rem',
            cursor: loading ? 'wait' : 'pointer',
            fontWeight: 600,
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? 'Deleting…' : confirmLabel}
        </button>
      </div>
    </div>
  );
}
