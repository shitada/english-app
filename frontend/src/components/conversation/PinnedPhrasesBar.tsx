import React from 'react';

/**
 * "Try to use" sticky bar for the conversation chat page.
 *
 * Learners can pin up to 2 key phrases (from helpers panel / grammar notes /
 * highlighted assistant messages). The bar shows each phrase as a chip with
 * a 📌 icon, status indicator (○ pending / ✓ used) and a ✕ to unpin.
 * The bar hides itself when no phrases are pinned.
 *
 * Pure frontend — no backend state. The parent owns `pinned` + `usedPhrases`
 * and is responsible for toggling/eviction logic; helpers exported below
 * keep that logic deterministic and unit-testable.
 */

export const MAX_PINNED_PHRASES = 2;

/**
 * Normalize a phrase for substring matching against a user message.
 * Lowercases, strips punctuation, and collapses whitespace.
 */
export function normalizePhrase(text: string): string {
  return text
    .toLowerCase()
    // Strip punctuation (keep word characters, spaces, and apostrophes inside words via word chars).
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check whether a pinned phrase appears as a substring of a user message.
 */
export function phraseUsedInMessage(phrase: string, message: string): boolean {
  const np = normalizePhrase(phrase);
  if (!np) return false;
  const nm = normalizePhrase(message);
  return nm.includes(np);
}

/**
 * Toggle a phrase in the pinned list.
 * - If already pinned: remove it (unpin).
 * - Otherwise append it. If at capacity, evict the oldest (FIFO).
 */
export function togglePin(
  pinned: string[],
  phrase: string,
  max: number = MAX_PINNED_PHRASES,
): string[] {
  const np = normalizePhrase(phrase);
  const idx = pinned.findIndex((p) => normalizePhrase(p) === np);
  if (idx >= 0) {
    return pinned.filter((_, i) => i !== idx);
  }
  const next = [...pinned, phrase];
  if (next.length > max) next.splice(0, next.length - max);
  return next;
}

/** True if a phrase is currently pinned (case/punctuation-insensitive). */
export function isPinned(pinned: string[], phrase: string): boolean {
  const np = normalizePhrase(phrase);
  return pinned.some((p) => normalizePhrase(p) === np);
}

interface PinnedPhrasesBarProps {
  pinned: string[];
  usedPhrases: Set<string>;
  onUnpin: (phrase: string) => void;
}

export function PinnedPhrasesBar({ pinned, usedPhrases, onUnpin }: PinnedPhrasesBarProps) {
  if (!pinned || pinned.length === 0) return null;

  return (
    <div
      data-testid="pinned-phrases-bar"
      role="region"
      aria-label="Phrases to try"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        padding: '8px 16px',
        borderTop: '1px solid var(--border, #e2e8f0)',
        background: 'var(--bg-secondary, #f8fafc)',
        position: 'sticky',
        bottom: 0,
        zIndex: 5,
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-secondary, #64748b)',
          flexShrink: 0,
        }}
      >
        Try to use:
      </span>
      {pinned.map((phrase) => {
        const used = usedPhrases.has(normalizePhrase(phrase));
        return (
          <span
            key={phrase}
            data-testid="pinned-phrase-chip"
            data-used={used ? 'true' : 'false'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px 4px 10px',
              borderRadius: 16,
              fontSize: 13,
              border: `1px solid ${used ? '#10b981' : 'var(--primary, #3b82f6)'}`,
              background: used ? 'rgba(16,185,129,0.12)' : 'transparent',
              color: used ? '#047857' : 'var(--primary, #3b82f6)',
              fontWeight: 500,
              maxWidth: '100%',
            }}
          >
            <span aria-hidden="true">📌</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {phrase}
            </span>
            <span
              aria-label={used ? 'Used' : 'Pending'}
              title={used ? 'Used in your reply!' : 'Try to use this in your next reply'}
              style={{ fontWeight: 700 }}
            >
              {used ? '✓' : '○'}
            </span>
            <button
              type="button"
              onClick={() => onUnpin(phrase)}
              aria-label={`Unpin "${phrase}"`}
              data-testid="pinned-phrase-unpin"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                marginLeft: 2,
                color: 'inherit',
                fontSize: 14,
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </span>
        );
      })}
    </div>
  );
}

export default PinnedPhrasesBar;
