import { useState, useCallback, useEffect } from 'react';
import { Volume2, Mic, Square, RefreshCw, Check, X, Link2 } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import {
  getLinkerDrillRound,
  submitLinkerDrillAttempt,
  type LinkerDrillItem,
} from '../api';

type Phase = 'choose' | 'feedback' | 'speak' | 'recording' | 'speak-done';

// ---------------------------------------------------------------------------
// Pure scoring helper — exported so a unit test can verify it without a DOM.
// Returns 0–100 case-insensitive token Jaccard similarity.
// ---------------------------------------------------------------------------
export function jaccardScore(transcript: string, expected: string): number {
  const norm = (s: string): string[] =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9'\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

  const a = new Set(norm(transcript));
  const b = new Set(norm(expected));
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  const union = a.size + b.size - inter;
  if (union === 0) return 0;
  return Math.round((inter / union) * 100);
}

interface RoundSummary {
  correctChoices: number;
  totalChoices: number;
  similarities: number[]; // 0–100, only items where user spoke
  weakestCategory: string | null;
}

export default function LinkerDrill() {
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });
  const tts = useSpeechSynthesis();

  const [items, setItems] = useState<LinkerDrillItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('choose');
  const [picked, setPicked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [similarity, setSimilarity] = useState<number | null>(null);
  const [summary, setSummary] = useState<RoundSummary | null>(null);

  // Round-running totals
  const [correctChoices, setCorrectChoices] = useState(0);
  const [similarities, setSimilarities] = useState<number[]>([]);
  const [perCategory, setPerCategory] = useState<
    Record<string, { total: number; correct: number }>
  >({});

  const fetchRound = useCallback(async () => {
    setLoading(true);
    setError(false);
    setSummary(null);
    setIdx(0);
    setPicked(null);
    setSimilarity(null);
    setPhase('choose');
    setCorrectChoices(0);
    setSimilarities([]);
    setPerCategory({});
    try {
      const res = await getLinkerDrillRound(5);
      setItems(res.items);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      fetchRound();
    }
  }, [initialized, fetchRound]);

  const current: LinkerDrillItem | null = items[idx] ?? null;

  const recordAttempt = useCallback(
    async (chosen: string, isCorrect: boolean, sim: number | null) => {
      if (!current) return;
      try {
        await submitLinkerDrillAttempt({
          item_id: current.id,
          chosen_linker: chosen,
          correct_linker: current.correct_linker,
          is_correct: isCorrect,
          category: current.category,
          spoken_similarity: sim,
        });
      } catch {
        // best-effort only
      }
    },
    [current]
  );

  const handlePick = useCallback(
    async (option: string) => {
      if (!current || phase !== 'choose') return;
      const isCorrect = option === current.correct_linker;
      setPicked(option);
      setPhase('feedback');
      setCorrectChoices((c) => c + (isCorrect ? 1 : 0));
      setPerCategory((m) => {
        const cat = current.category;
        const prev = m[cat] ?? { total: 0, correct: 0 };
        return {
          ...m,
          [cat]: {
            total: prev.total + 1,
            correct: prev.correct + (isCorrect ? 1 : 0),
          },
        };
      });
      // Persist immediately (without spoken similarity yet)
      await recordAttempt(option, isCorrect, null);
    },
    [current, phase, recordAttempt]
  );

  const handleListen = useCallback(() => {
    if (!current) return;
    tts.speak(current.combined_sentence, 'en-US');
  }, [current, tts]);

  const handleStartSpeak = useCallback(() => {
    if (!current) return;
    speech.reset();
    setSimilarity(null);
    setPhase('recording');
    speech.start();
  }, [current, speech]);

  const handleStopSpeak = useCallback(async () => {
    if (!current) return;
    speech.stop();
    const sim = jaccardScore(speech.transcript || '', current.combined_sentence);
    setSimilarity(sim);
    setSimilarities((s) => [...s, sim]);
    setPhase('speak-done');
    // Persist a separate "speaking" attempt row so similarity is captured.
    await recordAttempt(picked ?? current.correct_linker, picked === current.correct_linker, sim);
  }, [current, speech, picked, recordAttempt]);

  const computeWeakestCategory = useCallback(
    (m: Record<string, { total: number; correct: number }>): string | null => {
      const entries = Object.entries(m).filter(([, v]) => v.total > 0);
      if (!entries.length) return null;
      entries.sort(
        ([, a], [, b]) => a.correct / a.total - b.correct / b.total
      );
      return entries[0][0];
    },
    []
  );

  const handleNext = useCallback(() => {
    if (idx + 1 >= items.length) {
      setSummary({
        correctChoices,
        totalChoices: items.length,
        similarities,
        weakestCategory: computeWeakestCategory(perCategory),
      });
      return;
    }
    setIdx((i) => i + 1);
    setPicked(null);
    setSimilarity(null);
    setPhase('choose');
    speech.reset();
  }, [idx, items.length, correctChoices, similarities, perCategory, computeWeakestCategory, speech]);

  // ----- Render -----

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="text-sm text-gray-500">Loading…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-red-300 dark:border-red-700 p-4">
        <div className="text-sm text-red-600 dark:text-red-300 mb-2">
          Failed to load drill.
        </div>
        <button
          type="button"
          onClick={fetchRound}
          className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  if (summary) {
    const accuracyPct = summary.totalChoices
      ? Math.round((summary.correctChoices / summary.totalChoices) * 100)
      : 0;
    const avgSim = summary.similarities.length
      ? Math.round(
          summary.similarities.reduce((a, b) => a + b, 0) / summary.similarities.length
        )
      : null;
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Link2 size={16} />
          <h3 className="text-sm font-semibold">Linker Drill — Summary</h3>
        </div>
        <div className="text-xs text-gray-700 dark:text-gray-300">
          Connector accuracy: <strong>{accuracyPct}%</strong>{' '}
          ({summary.correctChoices}/{summary.totalChoices})
        </div>
        <div className="text-xs text-gray-700 dark:text-gray-300">
          Avg speaking similarity:{' '}
          <strong>{avgSim === null ? '—' : `${avgSim}/100`}</strong>
        </div>
        <div className="text-xs text-gray-700 dark:text-gray-300">
          Weakest category:{' '}
          <strong>{summary.weakestCategory ?? '—'}</strong>
        </div>
        <button
          type="button"
          onClick={fetchRound}
          className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-blue-600 text-white"
          aria-label="Start a new round"
        >
          <RefreshCw size={12} /> New round
        </button>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="text-sm text-gray-500">No items.</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3" data-testid="linker-drill-root">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link2 size={16} />
          <h3 className="text-sm font-semibold">Linker Speak Drill</h3>
        </div>
        <span className="text-xs text-gray-500" data-testid="linker-progress">
          {idx + 1} / {items.length} · {current.category}
        </span>
      </div>

      <div className="text-sm text-gray-800 dark:text-gray-200 space-y-1">
        <div>1. {current.sentence_a}</div>
        <div>2. {current.sentence_b}</div>
      </div>

      {phase === 'choose' && (
        <div className="grid grid-cols-2 gap-2" data-testid="linker-options">
          {current.options.map((opt) => (
            <button
              type="button"
              key={opt}
              onClick={() => handlePick(opt)}
              className="px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
              aria-label={`Pick connector ${opt}`}
              data-testid={`linker-option-${opt.replace(/\s+/g, '-')}`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {phase !== 'choose' && picked !== null && (
        <div
          className={`text-xs px-2 py-1 rounded inline-flex items-center gap-1 ${
            picked === current.correct_linker
              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
              : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
          }`}
        >
          {picked === current.correct_linker ? <Check size={12} /> : <X size={12} />}
          {picked === current.correct_linker
            ? 'Correct'
            : `Best fit: ${current.correct_linker}`}
        </div>
      )}

      {phase !== 'choose' && (
        <div className="text-xs text-gray-600 dark:text-gray-400">
          {current.explanation}
        </div>
      )}

      {phase !== 'choose' && (
        <div className="rounded bg-gray-50 dark:bg-gray-800 p-2 text-sm">
          {current.combined_sentence}
        </div>
      )}

      {phase !== 'choose' && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleListen}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-gray-200 dark:bg-gray-700"
            aria-label="Listen to combined sentence"
            data-testid="linker-listen"
          >
            <Volume2 size={12} /> Listen
          </button>

          {speech.isSupported && phase !== 'recording' && (
            <button
              type="button"
              onClick={handleStartSpeak}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-blue-600 text-white"
              aria-label="Speak combined sentence"
              data-testid="linker-speak"
            >
              <Mic size={12} /> Speak
            </button>
          )}

          {phase === 'recording' && (
            <button
              type="button"
              onClick={handleStopSpeak}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-red-600 text-white"
              aria-label="Stop recording"
              data-testid="linker-stop"
            >
              <Square size={12} /> Stop
            </button>
          )}

          {similarity !== null && (
            <span className="text-xs text-gray-700 dark:text-gray-300" data-testid="linker-similarity">
              Similarity: <strong>{similarity}/100</strong>
            </span>
          )}

          <button
            type="button"
            onClick={handleNext}
            className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-gray-700 text-white"
            aria-label="Next item"
            data-testid="linker-next"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
