import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18nContext';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

function ErrorFallbackUI({ error, onReset }: { error: Error | null; onReset: () => void }) {
  const { t } = useI18n();
  return (
    <div style={{ textAlign: 'center', padding: 40 }}>
      <h2 style={{ marginBottom: 12, color: '#b91c1c' }}>{t('errorHeading')}</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
        {error?.message || t('errorFallback')}
      </p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        <button className="btn btn-primary" onClick={onReset}>
          {t('tryAgain')}
        </button>
        <a
          href="/"
          className="btn btn-secondary"
          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
        >
          {t('goHome')}
        </a>
      </div>
    </div>
  );
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return <ErrorFallbackUI error={this.state.error} onReset={this.handleReset} />;
    }

    return this.props.children;
  }
}
