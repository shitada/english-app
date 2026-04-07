import { useState, useEffect } from 'react';
import { onRetryStateChange } from '../api';

export default function RetryBanner() {
  const [retrying, setRetrying] = useState(false);

  useEffect(() => onRetryStateChange(setRetrying), []);

  if (!retrying) return null;

  return (
    <div className="retry-banner" role="alert">
      ⟳ Connection issue, retrying…
    </div>
  );
}
