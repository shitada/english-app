import { useEffect } from 'react';

interface InlineErrorBannerProps {
  error: string | null;
  onDismiss: () => void;
}

export default function InlineErrorBanner({ error, onDismiss }: InlineErrorBannerProps) {
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(onDismiss, 8000);
    return () => clearTimeout(timer);
  }, [error, onDismiss]);

  if (!error) return null;

  return (
    <div role="alert" style={{
      padding: '0.75rem 1rem',
      marginBottom: '1rem',
      borderRadius: '0.5rem',
      backgroundColor: 'var(--danger-bg, #fee2e2)',
      border: '1px solid var(--danger-border, #fca5a5)',
      color: 'var(--danger-text, #dc2626)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}>
      <span>{error}</span>
      <button
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          color: 'inherit',
          fontSize: '1.25rem',
          cursor: 'pointer',
          padding: '0 0.25rem',
        }}
        aria-label="Dismiss error"
      >
        ×
      </button>
    </div>
  );
}
