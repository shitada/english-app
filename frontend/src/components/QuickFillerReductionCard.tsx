import { useState, useCallback, useEffect, useRef } from 'react';
import { ShieldOff, Mic, RefreshCw, Square, Trophy } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { getFillerDrillPrompt, type FillerDrillPromptResponse } from '../api';
import { countFillers } from '../utils/fillerWords';

const MAX_SECONDS = 30;
const BEST_SCORE_KEY = 'filler-drill-best-ratio';

/** Replacement tips for common fillers. */
const FILLER_TIPS: Record<string, string> = {
  um: 'Replace "um" with a brief silent pause.',
  uh: 'Replace "uh" with a short breath.',
  erm: 'Try pausing silently instead of "erm".',
  er: 'Let yourself pause instead of saying "er".',
  ah: 'Breathe briefly instead of "ah".',
  like: 'Drop "like" — just state your point directly.',
  'you know': 'Replace "you know" with "for example".',
  basically: 'Remove "basically" — be specific instead.',
  'i mean': 'Replace "I mean" with "to clarify".',
  'sort of': 'Replace "sort of" with a precise word.',
  'kind of': 'Replace "kind of" with a specific qualifier.',
  actually: 'Only use "actually" when correcting something.',
  literally: 'Use "literally" only for literal meaning.',
  right: 'Pause instead of inserting "right".',
  'okay so': 'Start with your main point directly.',
  well: 'Replace filler "well" with a confident pause.',
};

export default function QuickFillerReductionCard() {
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });

  const [prompt, setPrompt] = useState<FillerDrillPromptResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'speaking' | 'done'>('idle');
  const [secondsLeft, setSecondsLeft] = useState(MAX_SECONDS);
  const [initialized, setInitialized] = useState(false);
  const [liveFillerCount, setLiveFillerCount] = useState(0);
  const [fillerPulse, setFillerPulse] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevFillerCountRef = useRef(0);
  const startTimeRef = useRef<number>(0);

  // ── Results state ──
  const [totalFillers, setTotalFillers] = useState(0);
  const [wordCount, setWordCount] = useState(0);
  const [breakdown, setBreakdown] = useState<Map<string, number>>(new Map());
  const [personalBest, setPersonalBest] = useState<number | null>(() => {
    try {
      const stored = localStorage.getItem(BEST_SCORE_KEY);
      return stored ? parseFloat(stored) : null;
    } catch { return null; }
  });
  const [isNewBest, setIsNewBest] = useState(false);

  const fetchPrompt = useCallback(async () => {
    setLoading(true);
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const res = await getFillerDrillPrompt(difficulty);
      setPrompt(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      fetchPrompt();
    }
  }, [initialized, fetchPrompt]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'quick-practice-difficulty') {
        setPhase('idle');
        fetchPrompt();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [fetchPrompt]);

  // ── Live filler tracking while speaking ──
  useEffect(() => {
    if (phase !== 'speaking') return;
    const fullText = (speech.transcript || '') + ' ' + (speech.interimTranscript || '');
    const { total } = countFillers(fullText);
    setLiveFillerCount(total);

    if (total > prevFillerCountRef.current) {
      setFillerPulse(true);
      setTimeout(() => setFillerPulse(false), 400);
    }
    prevFillerCountRef.current = total;
  }, [phase, speech.transcript, speech.interimTranscript]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleFinish = useCallback(() => {
    stopTimer();
    speech.stop();

    const transcript = speech.transcript || speech.interimTranscript || '';
    const words = transcript.trim().split(/\s+/).filter(Boolean);
    const wc = words.length;
    const { total, words: fillerBreakdown } = countFillers(transcript);

    setTotalFillers(total);
    setWordCount(wc);
    setBreakdown(fillerBreakdown);

    // Words-per-filler ratio (higher is better; Infinity → perfect)
    const ratio = total > 0 ? wc / total : wc > 0 ? Infinity : 0;

    // Check personal best (higher ratio = better)
    let newBest = false;
    if (wc >= 5) {
      const prev = personalBest;
      if (prev === null || ratio > prev) {
        newBest = true;
        setPersonalBest(ratio);
        setIsNewBest(true);
        try {
          localStorage.setItem(BEST_SCORE_KEY, ratio === Infinity ? 'Infinity' : String(ratio));
        } catch { /* ignore */ }
      }
    }
    if (!newBest) setIsNewBest(false);

    setPhase('done');
  }, [speech, stopTimer, personalBest]);

  const handleFinishRef = useRef(handleFinish);
  handleFinishRef.current = handleFinish;

  const handleStart = useCallback(async () => {
    if (!prompt) return;
    speech.reset();
    setSecondsLeft(MAX_SECONDS);
    setLiveFillerCount(0);
    prevFillerCountRef.current = 0;
    startTimeRef.current = Date.now();
    setPhase('speaking');

    await speech.start();

    timerRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          handleFinishRef.current();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [prompt, speech]);

  const handleNewPrompt = useCallback(() => {
    setPhase('idle');
    setLiveFillerCount(0);
    prevFillerCountRef.current = 0;
    speech.reset();
    fetchPrompt();
  }, [fetchPrompt, speech]);

  useEffect(() => {
    return () => stopTimer();
  }, [stopTimer]);

  if (!speech.isSupported) return null;

  const wordsPerFiller = totalFillers > 0 ? (wordCount / totalFillers) : wordCount > 0 ? Infinity : 0;
  const ratioDisplay = wordsPerFiller === Infinity ? '∞' : wordsPerFiller.toFixed(1);
  const fillerColor = totalFillers === 0 ? '#22c55e' : totalFillers <= 3 ? '#f59e0b' : '#ef4444';

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <ShieldOff size={20} color="#ec4899" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Filler Reduction</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading prompt…</p>
      ) : !prompt ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No prompts available.</p>
      ) : phase === 'idle' ? (
        <div>
          <p style={{ color: 'var(--text)', fontSize: '0.95rem', margin: '0 0 0.25rem', fontWeight: 600 }}>
            {prompt.question}
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 0.75rem', fontStyle: 'italic' }}>
            💡 {prompt.tip}
          </p>
          <button onClick={handleStart} className="btn btn-primary">
            <Mic size={16} /> Start Speaking ({MAX_SECONDS}s)
          </button>
        </div>
      ) : phase === 'speaking' ? (
        <div>
          <p style={{ color: 'var(--text)', fontSize: '0.95rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
            {prompt.question}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#ec4899', display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'pulse 1.5s infinite',
            }}>
              <Mic size={18} color="white" />
            </div>
            <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
              {secondsLeft}s
            </span>
            {/* Live filler counter */}
            <span
              data-testid="filler-live-count"
              style={{
                fontSize: '0.85rem',
                fontWeight: 700,
                color: liveFillerCount === 0 ? '#22c55e' : '#ef4444',
                background: fillerPulse ? 'rgba(239,68,68,0.15)' : 'transparent',
                padding: '0.2rem 0.5rem',
                borderRadius: '0.5rem',
                transition: 'background 0.3s',
              }}
            >
              🚫 Fillers: {liveFillerCount}
            </span>
          </div>
          {(speech.transcript || speech.interimTranscript) && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontStyle: 'italic', margin: '0 0 0.5rem' }}>
              {speech.transcript}{speech.interimTranscript && <span style={{ opacity: 0.5 }}> {speech.interimTranscript}</span>}
            </p>
          )}
          <button onClick={handleFinish} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Square size={14} /> Done
          </button>
        </div>
      ) : (
        /* phase === 'done' */
        <div>
          {/* Summary stats */}
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: fillerColor }}>{totalFillers}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Fillers</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text)' }}>{wordCount}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Words</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--primary, #3b82f6)' }}>{ratioDisplay}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Words/Filler</div>
            </div>
          </div>

          {/* Personal best */}
          {isNewBest && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.4rem 0.6rem', marginBottom: '0.5rem',
              background: 'rgba(34,197,94,0.1)', borderRadius: '0.5rem',
              fontSize: '0.85rem', fontWeight: 600, color: '#22c55e',
            }}>
              <Trophy size={16} /> New personal best!
            </div>
          )}

          {personalBest !== null && !isNewBest && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>
              🏆 Personal best: {personalBest === Infinity ? '∞' : personalBest.toFixed(1)} words/filler
            </p>
          )}

          {/* Per-filler breakdown */}
          {breakdown.size > 0 && (
            <div style={{
              background: 'var(--bg-secondary, #f9fafb)', borderRadius: '0.5rem',
              padding: '0.5rem 0.75rem', marginBottom: '0.5rem',
              borderLeft: '3px solid #ec4899',
            }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.35rem', fontWeight: 600 }}>
                Filler Breakdown
              </p>
              {Array.from(breakdown.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([word, count]) => (
                  <div key={word} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', marginBottom: '0.2rem' }}>
                    <span style={{ color: 'var(--text)' }}>
                      &quot;{word}&quot; <span style={{ color: 'var(--text-secondary)' }}>×{count}</span>
                    </span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontStyle: 'italic', maxWidth: '60%', textAlign: 'right' }}>
                      {FILLER_TIPS[word] || `Try pausing instead of "${word}".`}
                    </span>
                  </div>
                ))}
            </div>
          )}

          {totalFillers === 0 && wordCount > 0 && (
            <p style={{ fontSize: '0.9rem', color: '#22c55e', fontWeight: 600, margin: '0 0 0.5rem' }}>
              🎉 Perfect — zero fillers detected!
            </p>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => { setPhase('idle'); }} className="btn btn-secondary">
              Try Again
            </button>
            <button onClick={handleNewPrompt} className="btn btn-primary">
              <RefreshCw size={14} /> New Prompt
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
