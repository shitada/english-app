/**
 * Date formatting utilities for consistent display across the app.
 * Handles SQLite datetime format ("YYYY-MM-DD HH:MM:SS") and ISO 8601.
 */

function parseDate(input: string): Date {
  // SQLite datetime('now') produces "YYYY-MM-DD HH:MM:SS" (no T separator)
  const normalized = input.includes('T') ? input : input.replace(' ', 'T');
  return new Date(normalized);
}

/** Relative time string for activity feeds: "Just now", "5 min ago", "Yesterday", "Jan 15" */
export function formatRelativeTime(timestamp: string): string {
  const date = parseDate(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Consistent date+time: "Mar 30, 2026 3:45 PM" */
export function formatDateTime(timestamp: string): string {
  const date = parseDate(timestamp);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
