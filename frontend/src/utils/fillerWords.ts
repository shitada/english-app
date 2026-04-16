/**
 * Shared filler-word detection utilities.
 *
 * Used by SpeakingJournal (transcript highlighting) and Conversation
 * (real-time filler awareness badge).
 */

export const FILLER_REGEX =
  /\b(um|uh|erm|er|ah|like|you know|basically|i mean|sort of|kind of|actually|literally|right|okay so|well)\b/gi;

/**
 * Count filler words in a piece of text.
 * Returns total count and a per-word breakdown.
 */
export function countFillers(text: string): {
  total: number;
  words: Map<string, number>;
} {
  const words = new Map<string, number>();
  let total = 0;

  // Reset lastIndex in case the regex was used previously
  FILLER_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = FILLER_REGEX.exec(text)) !== null) {
    const word = match[1].toLowerCase();
    words.set(word, (words.get(word) ?? 0) + 1);
    total++;
  }

  return { total, words };
}

/**
 * Return HTML with filler words wrapped in highlighted `<mark>` tags.
 */
export function highlightFillers(text: string): string {
  // Reset lastIndex before use
  FILLER_REGEX.lastIndex = 0;
  return text.replace(
    FILLER_REGEX,
    '<mark style="background:#fecaca;border-radius:3px;padding:0 2px">$1</mark>',
  );
}
