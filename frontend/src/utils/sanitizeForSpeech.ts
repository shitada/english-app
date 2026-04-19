/**
 * Strip emoji and decorative icons from a string before passing it to
 * SpeechSynthesis. Without this, browsers read emoji aloud as their
 * literal Unicode names (e.g. "😄" → "smiling face"), which is jarring
 * during listening practice.
 *
 * Display text is unaffected — only the argument passed to speak() is
 * sanitized via this helper.
 */

// Regex matching the Unicode emoji/decorative ranges we want to strip.
// Combined into a single character class for performance. Built once at
// module load and reused across calls (the regex is stateless because it
// is not /g/flagged for /test/ — we use replaceAll-style /g for /replace/).
const EMOJI_RE = new RegExp(
  '[' +
    // Emoticons
    '\u{1F600}-\u{1F64F}' +
    // Misc Symbols & Pictographs
    '\u{1F300}-\u{1F5FF}' +
    // Transport & Map Symbols
    '\u{1F680}-\u{1F6FF}' +
    // Supplemental Symbols & Pictographs
    '\u{1F900}-\u{1F9FF}' +
    // Symbols & Pictographs Extended-A
    '\u{1FA70}-\u{1FAFF}' +
    // Dingbats
    '\u{2700}-\u{27BF}' +
    // Misc Symbols
    '\u{2600}-\u{26FF}' +
    // Regional Indicator Symbols (flag halves)
    '\u{1F1E6}-\u{1F1FF}' +
    // Skin-tone modifiers
    '\u{1F3FB}-\u{1F3FF}' +
    // Variation selector (e.g. emoji-style heart)
    '\u{FE0F}' +
    // Zero-width joiner (used in family/profession sequences)
    '\u{200D}' +
    ']',
  'gu',
);

/**
 * Remove emoji and decorative symbols and collapse the resulting
 * whitespace. Returns an empty string if nothing speakable remains.
 */
export function sanitizeForSpeech(text: string): string {
  if (!text) return '';
  const stripped = text.replace(EMOJI_RE, '');
  // Collapse runs of whitespace introduced by removed characters.
  return stripped.replace(/\s+/g, ' ').trim();
}
