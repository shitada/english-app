interface GrammarError {
  original: string;
  correction: string;
  explanation: string;
}

interface StyleSuggestion {
  original: string;
  better: string;
  explanation: string;
}

interface Message {
  role: string;
  content: string;
  feedback?: {
    errors?: GrammarError[];
    suggestions?: StyleSuggestion[];
  } | null;
  key_phrases?: string[];
}

interface Summary {
  key_vocabulary?: string[];
}

export function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export function generateStudyCardsCSV(messages: Message[], summary: Summary): string {
  const rows: string[][] = [['Front', 'Back', 'Tag']];

  // Grammar corrections from message feedback
  for (const msg of messages) {
    if (msg.role !== 'user' || !msg.feedback) continue;
    if (msg.feedback.errors) {
      for (const err of msg.feedback.errors) {
        rows.push([
          err.original,
          `${err.correction} — ${err.explanation}`,
          'grammar',
        ]);
      }
    }
    if (msg.feedback.suggestions) {
      for (const sug of msg.feedback.suggestions) {
        rows.push([
          sug.original,
          `${sug.better} — ${sug.explanation}`,
          'style',
        ]);
      }
    }
  }

  // Key vocabulary from summary
  if (summary.key_vocabulary) {
    for (const word of summary.key_vocabulary) {
      rows.push([word, word, 'vocabulary']);
    }
  }

  return rows.map(row => row.map(escapeCSV).join(',')).join('\n');
}

export function hasStudyCards(messages: Message[], summary: Summary): boolean {
  for (const msg of messages) {
    if (msg.role !== 'user' || !msg.feedback) continue;
    if (msg.feedback.errors && msg.feedback.errors.length > 0) return true;
    if (msg.feedback.suggestions && msg.feedback.suggestions.length > 0) return true;
  }
  if (summary.key_vocabulary && summary.key_vocabulary.length > 0) return true;
  return false;
}
