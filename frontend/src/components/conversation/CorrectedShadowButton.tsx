import { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';

type Phase = 'idle' | 'listening' | 'repeat';

/**
 * Pure helper: returns true when the corrected version is non-empty AND
 * differs from the original (after trimming whitespace). Exported for unit
 * testing the render-gating logic without a DOM-mounting library.
 */
export function shouldRenderCorrection(original: string | undefined | null, corrected: string | undefined | null): boolean {
  const c = (corrected || '').trim();
  const o = (original || '').trim();
  if (c.length === 0) return false;
  if (c === o) return false;
  return true;
}

interface Props {
  correctedText: string;
  originalText?: string;
  onShadowComplete?: () => void;
}

/**
 * Inline "Shadow correction" button rendered beneath a user message bubble
 * when grammar feedback contains a corrected version. Plays the corrected
 * sentence via window.speechSynthesis at 0.75x for micro-shadowing practice.
 *
 * States: idle → listening (audio playing) → repeat (audio finished, prompts
 * the learner to repeat) → idle (after a short pause).
 *
 * Disabled / hidden when correctedText is empty or equals originalText.
 */
export function CorrectedShadowButton({ correctedText, originalText, onShadowComplete }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const repeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trimmedCorrected = (correctedText || '').trim();
  const trimmedOriginal = (originalText || '').trim();
  const shouldRender = shouldRenderCorrection(trimmedOriginal, trimmedCorrected);
  const disabled = !shouldRender;

  useEffect(() => {
    return () => {
      if (repeatTimerRef.current) clearTimeout(repeatTimerRef.current);
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* noop */
      }
    };
  }, []);

  const handleClick = useCallback(() => {
    if (disabled) return;
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    try {
      synth.cancel();
    } catch {
      /* noop */
    }
    const utter = new (window as unknown as { SpeechSynthesisUtterance: typeof SpeechSynthesisUtterance }).SpeechSynthesisUtterance(trimmedCorrected);
    utter.rate = 0.75;
    utter.lang = 'en-US';
    utter.onend = () => {
      setPhase('repeat');
      if (repeatTimerRef.current) clearTimeout(repeatTimerRef.current);
      repeatTimerRef.current = setTimeout(() => {
        setPhase('idle');
        onShadowComplete?.();
      }, 2500);
    };
    utter.onerror = () => {
      setPhase('idle');
    };
    setPhase('listening');
    synth.speak(utter);
  }, [disabled, trimmedCorrected, onShadowComplete]);

  if (disabled) return null;

  const label =
    phase === 'listening' ? 'Listening…' : phase === 'repeat' ? 'Now repeat' : 'Shadow correction';

  return (
    <button
      type="button"
      data-testid="corrected-shadow-button"
      onClick={handleClick}
      disabled={phase === 'listening'}
      aria-label="Hear corrected version and shadow"
      title="Hear corrected version (0.75×) and repeat"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        marginTop: 4,
        background: 'transparent',
        border: '1px solid var(--primary, #6366f1)',
        borderRadius: 999,
        cursor: phase === 'listening' ? 'default' : 'pointer',
        color: 'var(--primary, #6366f1)',
        fontSize: 11,
        fontWeight: 500,
        opacity: phase === 'listening' ? 1 : 0.85,
      }}
    >
      <Volume2 size={12} />
      <span>{label}</span>
    </button>
  );
}

export default CorrectedShadowButton;
