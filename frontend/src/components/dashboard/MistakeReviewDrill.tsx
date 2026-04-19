import { useState, useCallback, useRef, useEffect } from 'react';
import { RotateCcw, Volume2, CheckCircle, XCircle, ArrowLeft, Mic, MicOff, Keyboard } from 'lucide-react';
import type { MistakeReviewItem } from '../../api';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../../hooks/useSpeechSynthesis';

interface Props {
  items: MistakeReviewItem[];
  onClose: () => void;
}

interface AttemptResult {
  userInput: string;
  correct: string;
  isMatch: boolean;
  topic: string;
}

const INPUT_MODE_KEY = 'mistake_drill_input_mode';
type InputMode = 'type' | 'speak';

export function normalizeText(text: string): string {
  // Strip basic punctuation so spoken transcripts (which lack commas/periods)
  // can still match the canonical written correction.
  return text
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:"'`()\[\]{}]/g, '')
    .replace(/\s+/g, ' ');
}

function WordDiff({ userInput, correct }: { userInput: string; correct: string }) {
  const userWords = userInput.trim().split(/\s+/);
  const correctWords = correct.trim().split(/\s+/);
  const maxLen = Math.max(userWords.length, correctWords.length);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, fontSize: 14 }}>
      {Array.from({ length: maxLen }, (_, i) => {
        const uWord = userWords[i] || '';
        const cWord = correctWords[i] || '';
        const match = normalizeText(uWord) === normalizeText(cWord);
        return (
          <span
            key={i}
            style={{
              color: match ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)',
              fontWeight: match ? 400 : 700,
              textDecoration: !match && uWord ? 'line-through' : 'none',
            }}
          >
            {uWord || '___'}
          </span>
        );
      })}
    </div>
  );
}

export function MistakeReviewDrill({ items, onClose }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userInput, setUserInput] = useState('');
  const [results, setResults] = useState<AttemptResult[]>([]);
  const [showResult, setShowResult] = useState(false);
  const [finished, setFinished] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const speech = useSpeechRecognition({ continuous: false, interimResults: true });
  const tts = useSpeechSynthesis();

  const [inputMode, setInputMode] = useState<InputMode>(() => {
    if (typeof window === 'undefined') return 'type';
    try {
      const saved = window.localStorage.getItem(INPUT_MODE_KEY);
      if (saved === 'speak' || saved === 'type') return saved;
    } catch (_) { /* ignore */ }
    return 'type';
  });

  // If speech recognition is not supported, force type mode.
  const effectiveMode: InputMode = speech.isSupported ? inputMode : 'type';

  const persistMode = useCallback((mode: InputMode) => {
    setInputMode(mode);
    try { window.localStorage.setItem(INPUT_MODE_KEY, mode); } catch (_) { /* ignore */ }
  }, []);

  useEffect(() => {
    if (effectiveMode === 'type' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [currentIndex, effectiveMode]);

  const handleSubmit = useCallback((overrideInput?: string) => {
    const raw = (overrideInput ?? userInput).trim();
    if (!raw) return;
    const item = items[currentIndex];
    const isMatch = normalizeText(raw) === normalizeText(item.correction);
    setResults(prev => [...prev, { userInput: raw, correct: item.correction, isMatch, topic: item.topic }]);
    setShowResult(true);
  }, [userInput, currentIndex, items]);

  // Auto-submit when speech recognition produces a final transcript while in
  // Speak Mode and we are still on the input phase.
  useEffect(() => {
    if (effectiveMode !== 'speak') return;
    if (showResult) return;
    if (speech.isListening) return;
    const finalText = speech.transcript.trim();
    if (!finalText) return;
    handleSubmit(finalText);
    speech.reset();
    // We intentionally only react to transcript / listening changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.transcript, speech.isListening, effectiveMode, showResult]);

  const handleNext = useCallback(() => {
    setShowResult(false);
    setUserInput('');
    speech.reset();
    if (currentIndex < items.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setFinished(true);
    }
  }, [currentIndex, items.length, speech]);

  const handleRestart = useCallback(() => {
    setCurrentIndex(0);
    setUserInput('');
    setResults([]);
    setShowResult(false);
    setFinished(false);
    speech.reset();
  }, [speech]);

  const handleSpeak = useCallback((text: string) => {
    if (tts.isSupported) {
      tts.speak(text, 'en-US', 0.9);
    } else if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  }, [tts]);

  const handleMicToggle = useCallback(() => {
    if (speech.isListening) {
      speech.stop();
    } else {
      speech.reset();
      speech.start();
    }
  }, [speech]);

  const handleTryAgainAloud = useCallback(() => {
    setShowResult(false);
    setUserInput('');
    // Pop the failed attempt off the results list so it doesn't double-count.
    setResults(prev => prev.slice(0, -1));
    speech.reset();
    // Defer the start so re-render commits before mic begins.
    setTimeout(() => { speech.start(); }, 0);
  }, [speech]);

  // Spacebar shortcut: start/stop mic when in Speak Mode and no input is focused.
  useEffect(() => {
    if (effectiveMode !== 'speak') return;
    if (showResult || finished) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return;
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (document.activeElement as HTMLElement | null)?.isContentEditable) return;
      e.preventDefault();
      handleMicToggle();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [effectiveMode, showResult, finished, handleMicToggle]);

  if (items.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 32 }}>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>No grammar mistakes to review yet.</p>
        <button className="btn btn-secondary" onClick={onClose}>
          <ArrowLeft size={14} /> Back to Journal
        </button>
      </div>
    );
  }

  if (finished) {
    const correctCount = results.filter(r => r.isMatch).length;
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', padding: 4 }}>
            <ArrowLeft size={18} />
          </button>
          <h3 style={{ margin: 0 }}>Mistake Review Complete!</h3>
        </div>

        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <span style={{ fontSize: 40, fontWeight: 700, color: correctCount === items.length ? 'var(--success, #22c55e)' : 'var(--primary, #6366f1)' }}>
            {correctCount}/{items.length}
          </span>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>
            corrections nailed {correctCount === items.length ? '🎉' : ''}
          </p>
        </div>

        {results.map((r, i) => (
          <div key={i} style={{ padding: 8, marginBottom: 6, background: 'var(--bg-secondary, #f9fafb)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            {r.isMatch
              ? <CheckCircle size={16} color="var(--success, #22c55e)" />
              : <XCircle size={16} color="var(--danger, #ef4444)" />}
            <span style={{ fontSize: 13, flex: 1 }}>
              {r.isMatch ? r.correct : (
                <>
                  <span style={{ textDecoration: 'line-through', color: 'var(--danger, #ef4444)' }}>{r.userInput}</span>
                  {' → '}
                  <span style={{ color: 'var(--success, #22c55e)', fontWeight: 600 }}>{r.correct}</span>
                </>
              )}
            </span>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
          <button onClick={handleRestart} className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <RotateCcw size={14} /> Try Again
          </button>
          <button onClick={onClose} className="btn btn-primary">
            Done
          </button>
        </div>
      </div>
    );
  }

  const currentItem = items[currentIndex];
  const lastResult = results[results.length - 1];

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', padding: 4 }}>
          <ArrowLeft size={18} />
        </button>
        <h3 style={{ margin: 0 }}>📝 Mistake Review Drill</h3>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {currentIndex + 1} / {items.length}
        </span>
      </div>

      {speech.isSupported && (
        <div
          role="group"
          aria-label="Answer input mode"
          style={{ display: 'flex', gap: 6, marginBottom: 12, justifyContent: 'flex-end' }}
        >
          <button
            type="button"
            onClick={() => persistMode('type')}
            aria-pressed={effectiveMode === 'type'}
            aria-label="Switch to typing mode"
            data-testid="mistake-drill-mode-type"
            className={`btn ${effectiveMode === 'type' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '4px 10px' }}
          >
            <Keyboard size={12} /> Type
          </button>
          <button
            type="button"
            onClick={() => persistMode('speak')}
            aria-pressed={effectiveMode === 'speak'}
            aria-label="Switch to speak mode"
            data-testid="mistake-drill-mode-speak"
            className={`btn ${effectiveMode === 'speak' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '4px 10px' }}
          >
            🎤 Speak
          </button>
        </div>
      )}

      <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8 }}>
        <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--text-secondary)' }}>
          You wrote ({currentItem.topic}):
        </p>
        <p style={{ margin: 0, fontSize: 15, color: 'var(--danger, #ef4444)', fontStyle: 'italic' }}>
          "{currentItem.original}"
        </p>
      </div>

      <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-secondary)' }}>
        💡 {currentItem.explanation}
      </p>
      <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
        {effectiveMode === 'speak' ? 'Say the corrected version aloud:' : 'Type the corrected version:'}
      </p>

      {!showResult ? (
        effectiveMode === 'speak' ? (
          <div data-testid="mistake-drill-speak-panel">
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button
                type="button"
                onClick={() => handleSpeak(currentItem.correction)}
                className="btn btn-secondary"
                aria-label="Play correction audio"
                data-testid="mistake-drill-tts-preview"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Volume2 size={14} /> Hear it
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
              <button
                type="button"
                onClick={handleMicToggle}
                aria-pressed={speech.isListening}
                aria-label={speech.isListening ? 'Stop recording' : 'Start recording'}
                data-testid="mistake-drill-mic"
                className={`btn ${speech.isListening ? 'btn-danger' : 'btn-primary'}`}
                style={{
                  width: 88, height: 88, borderRadius: '50%',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {speech.isListening ? <MicOff size={32} /> : <Mic size={32} />}
              </button>
            </div>
            <p
              aria-live="polite"
              data-testid="mistake-drill-transcript"
              style={{
                minHeight: 20, textAlign: 'center', fontSize: 13,
                color: 'var(--text-secondary)', fontStyle: 'italic', margin: '0 0 6px',
              }}
            >
              {speech.isListening
                ? (speech.interimTranscript || speech.transcript || 'Listening…')
                : (speech.transcript || 'Press the mic (or Space) to begin')}
            </p>
            {speech.error && (
              <p style={{ fontSize: 12, color: 'var(--danger, #ef4444)', textAlign: 'center', margin: 0 }}>
                {speech.error}
              </p>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={inputRef}
              type="text"
              value={userInput}
              onChange={e => setUserInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder="Type the correction..."
              style={{
                flex: 1, padding: '0.5rem 0.75rem', borderRadius: 6,
                border: '1px solid var(--border)', fontSize: 14,
                background: 'var(--card-bg, #fff)', color: 'var(--text)',
              }}
            />
            <button
              onClick={() => handleSubmit()}
              disabled={!userInput.trim()}
              className="btn btn-primary"
              style={{ opacity: userInput.trim() ? 1 : 0.5 }}
            >
              Check
            </button>
          </div>
        )
      ) : (
        <div>
          {lastResult?.isMatch ? (
            <div style={{ padding: 10, borderRadius: 6, background: 'var(--success-bg, #f0fdf4)', border: '1px solid var(--success, #22c55e)', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <CheckCircle size={18} color="var(--success, #22c55e)" />
                <span style={{ fontWeight: 600, color: 'var(--success, #22c55e)' }}>Correct!</span>
              </div>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--text)' }}>{currentItem.correction}</p>
            </div>
          ) : (
            <div style={{ padding: 10, borderRadius: 6, background: 'var(--danger-bg, #fef2f2)', border: '1px solid var(--danger, #ef4444)', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <XCircle size={18} color="var(--danger, #ef4444)" />
                <span style={{ fontWeight: 600, color: 'var(--danger, #ef4444)' }}>Not quite</span>
              </div>
              <div style={{ marginBottom: 6 }}>
                <p style={{ margin: '0 0 2px', fontSize: 12, color: 'var(--text-secondary)' }}>Your attempt:</p>
                <WordDiff userInput={lastResult?.userInput || ''} correct={currentItem.correction} />
              </div>
              <div>
                <p style={{ margin: '0 0 2px', fontSize: 12, color: 'var(--text-secondary)' }}>Correct version:</p>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--success, #22c55e)' }}>
                  {currentItem.correction}
                </p>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => handleSpeak(currentItem.correction)}
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Volume2 size={14} /> Listen
            </button>
            {effectiveMode === 'speak' && lastResult && !lastResult.isMatch && (
              <button
                type="button"
                onClick={handleTryAgainAloud}
                data-testid="mistake-drill-try-again-aloud"
                className="btn btn-secondary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Mic size={14} /> Try Again Aloud
              </button>
            )}
            <button onClick={handleNext} className="btn btn-primary">
              {currentIndex < items.length - 1 ? 'Next' : 'See Results'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
