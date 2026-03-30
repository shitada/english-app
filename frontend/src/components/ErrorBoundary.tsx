import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
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

      return (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <h2 style={{ marginBottom: 12, color: '#b91c1c' }}>Something went wrong</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={this.handleReset}>
              Try Again
            </button>
            <a
              href="/"
              className="btn btn-secondary"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
            >
              Go Home
            </a>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
