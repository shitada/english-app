import { useState, useRef, useEffect } from 'react';
import { Volume2, Mic, MicOff } from 'lucide-react';
import type { GrammarFeedback } from '../../api';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ');
}

function InlineCorrectionDiff({ userInput, correct }: { userInput: string; correct: string }) {
  const userWords = userInput.trim().split(/\s+/);
  const correctWords = correct.trim().split(/\s+/);
  const maxLen = Math.max(userWords.length, correctWords.length);
  return (
    <span>
      {Array.from({ length: maxLen }, (_, i) => {
        const uWord = userWords[i] || '';
        const cWord = correctWords[i] || '';
        const match = normalizeText(uWord) === normalizeText(cWord);
        return (
          <span key={i} style={{ color: match ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)', fontWeight: match ? 400 : 600 }}>
            {uWord || '___'}{i < maxLen - 1 ? ' ' : ''}
          </span>
        );
      })}
    </span>
  );
}

export function FeedbackPanel({ feedback, onSpeak, onCorrectionAttempt }: {
  feedback: GrammarFeedback;
  onSpeak?: (text: string) => void;
  onCorrectionAttempt?: (success: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [tryAgainMode, setTryAgainMode] = useState(false);
  const [tryAgainInput, setTryAgainInput] = useState('');
  const [tryAgainResult, setTryAgainResult] = useState<'success' | 'retry' | null>(null);
  const [speakMode, setSpeakMode] = useState(false);
  const [speakResult, setSpeakResult] = useState<'success' | 'retry' | null>(null);
  const [spokenText, setSpokenText] = useState('');
  const [suggestDrillIdx, setSuggestDrillIdx] = useState<number | null>(null);
  const [suggestSpokenText, setSuggestSpokenText] = useState('');
  const [suggestDrillResult, setSuggestDrillResult] = useState<'success' | 'retry' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingStopRef = useRef(false);
  const activeDrillRef = useRef<'correction' | 'suggestion' | null>(null);
  const { transcript, isListening, isSupported: speechSupported, start: startListening, stop: stopListening, reset: resetSpeech } = useSpeechRecognition();

  // Capture transcript when speech recognition stops during any speak drill
  useEffect(() => {
    if (!pendingStopRef.current || isListening) return;
    const mode = activeDrillRef.current;
    pendingStopRef.current = false;
    activeDrillRef.current = null;
    const spoken = transcript;

    if (mode === 'correction' && speakMode && feedback.corrected_text) {
      setSpokenText(spoken);
      const userWords = normalizeText(spoken).split(/\s+/);
      const correctWords = normalizeText(feedback.corrected_text).split(/\s+/);
      const maxLen = Math.max(userWords.length, correctWords.length);
      let matches = 0;
      for (let i = 0; i < maxLen; i++) {
        if (userWords[i] === correctWords[i]) matches++;
      }
      const similarity = maxLen > 0 ? matches / maxLen : 1;
      const success = similarity >= 0.9;
      setSpeakResult(success ? 'success' : 'retry');
      if (success) setSpeakMode(false);
      onCorrectionAttempt?.(success);
    }

    if (mode === 'suggestion' && suggestDrillIdx !== null) {
      const sug = (feedback.suggestions ?? [])[suggestDrillIdx];
      if (!sug) return;
      setSuggestSpokenText(spoken);
      const userWords = normalizeText(spoken).split(/\s+/);
      const correctWords = normalizeText(sug.better).split(/\s+/);
      const maxLen = Math.max(userWords.length, correctWords.length);
      let matches = 0;
      for (let i = 0; i < maxLen; i++) {
        if (userWords[i] === correctWords[i]) matches++;
      }
      const similarity = maxLen > 0 ? matches / maxLen : 1;
      const success = similarity >= 0.9;
      setSuggestDrillResult(success ? 'success' : 'retry');
      if (success) setSuggestDrillIdx(null);
    }
  }, [isListening, transcript, speakMode, feedback.corrected_text, feedback.suggestions, suggestDrillIdx, onCorrectionAttempt]);

  if (feedback.is_correct && (feedback.suggestions ?? []).length === 0) {
    return (
      <div className="feedback-panel correct">
        ✅ Great! Your English is correct.
      </div>
    );
  }

  const showDrillButtons = feedback.corrected_text && !feedback.is_correct && !tryAgainMode && !speakMode && tryAgainResult !== 'success' && speakResult !== 'success';

  return (
    <div className="feedback-panel" onClick={() => setExpanded(!expanded)}>
      <div style={{ cursor: 'pointer', fontWeight: 600, marginBottom: expanded ? 8 : 0 }}>
        {feedback.is_correct ? '💡 Suggestions' : '📝 Corrections & Suggestions'}
        <span style={{ float: 'right', fontSize: 12 }}>{expanded ? '▼' : '▶'}</span>
      </div>
      {expanded && (
        <>
          {(feedback.errors ?? []).map((err, i) => (
            <div key={i} className="feedback-error">
              <strong>{err.original}</strong> → <em>{err.correction}</em>
              {onSpeak && (
                <button
                  onClick={(e) => { e.stopPropagation(); onSpeak(err.correction); }}
                  aria-label={`Listen: ${err.correction}`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', verticalAlign: 'middle' }}
                >
                  <Volume2 size={13} color="var(--primary, #6366f1)" />
                </button>
              )}
              <br />
              <span style={{ fontSize: 12 }}>{err.explanation}</span>
            </div>
          ))}
          {(feedback.suggestions ?? []).map((sug, i) => (
            <div key={i} className="feedback-suggestion">
              💡 "{sug.original}" → <em>"{sug.better}"</em>
              {onSpeak && (
                <button
                  onClick={(e) => { e.stopPropagation(); onSpeak(sug.better); }}
                  aria-label={`Listen: ${sug.better}`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', verticalAlign: 'middle' }}
                >
                  <Volume2 size={13} color="var(--primary, #6366f1)" />
                </button>
              )}
              {speechSupported && onSpeak && suggestDrillIdx !== i && (suggestDrillIdx !== null ? null : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSuggestDrillIdx(i);
                    setSuggestDrillResult(null);
                    setSuggestSpokenText('');
                    resetSpeech();
                    activeDrillRef.current = 'suggestion';
                    onSpeak(sug.better);
                  }}
                  aria-label={`Say it better: ${sug.better}`}
                  style={{
                    background: 'none', border: '1px solid var(--success, #22c55e)', borderRadius: 6,
                    cursor: 'pointer', padding: '2px 8px', verticalAlign: 'middle', fontSize: '0.75rem',
                    fontWeight: 600, color: 'var(--success, #22c55e)', display: 'inline-flex', alignItems: 'center', gap: 3,
                  }}
                >
                  🗣️ Say It Better
                </button>
              ))}
              <br />
              <span style={{ fontSize: 12 }}>{sug.explanation}</span>
              {suggestDrillIdx === i && (
                <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 6, padding: '10px 12px', background: 'var(--card-bg, #f8f9fa)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>Say the better expression aloud:</div>
                  {!isListening && !suggestDrillResult && (
                    <button
                      onClick={() => {
                        resetSpeech();
                        pendingStopRef.current = false;
                        activeDrillRef.current = 'suggestion';
                        startListening();
                      }}
                      aria-label="Start recording the better expression"
                      style={{
                        padding: '6px 14px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600,
                        background: 'var(--primary, #6366f1)', color: 'white', border: 'none', cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      <Mic size={13} /> Start Speaking
                    </button>
                  )}
                  {isListening && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <button
                          onClick={() => {
                            pendingStopRef.current = true;
                            stopListening();
                          }}
                          aria-label="Stop recording"
                          style={{
                            padding: '6px 14px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600,
                            background: 'var(--danger, #ef4444)', color: 'white', border: 'none', cursor: 'pointer',
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}
                        >
                          <MicOff size={13} /> Stop
                        </button>
                        <span style={{ fontSize: '0.8rem', color: 'var(--danger, #ef4444)', fontWeight: 500 }}>● Recording…</span>
                      </div>
                      {transcript && (
                        <div style={{ padding: 6, background: 'var(--bg, #fff)', borderRadius: 6, fontSize: '0.85rem', color: 'var(--text)' }}>
                          {transcript}
                        </div>
                      )}
                    </div>
                  )}
                  {suggestDrillResult === 'success' && (
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--success, #16a34a)' }}>
                      ✅ Nice! You said it better!
                    </div>
                  )}
                  {suggestDrillResult === 'retry' && suggestSpokenText && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontSize: '0.8rem', marginBottom: 4 }}>
                        <span style={{ color: 'var(--warning, #f59e0b)', fontWeight: 600 }}>Almost!</span>{' '}
                        <InlineCorrectionDiff userInput={suggestSpokenText} correct={sug.better} />
                      </div>
                      <button
                        onClick={() => {
                          setSuggestDrillResult(null);
                          setSuggestSpokenText('');
                          resetSpeech();
                          activeDrillRef.current = 'suggestion';
                          onSpeak?.(sug.better);
                        }}
                        style={{
                          marginTop: 4, padding: '6px 14px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600,
                          background: 'var(--primary, #6366f1)', color: 'white', border: 'none', cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                        }}
                      >
                        <Mic size={13} /> Try Again
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {feedback.corrected_text && !feedback.is_correct && (
            <div style={{ marginTop: 8, padding: '6px 10px', background: '#fefce8', borderRadius: 6, fontSize: 12 }}>
              ✏️ <strong>Corrected:</strong> {feedback.corrected_text}
              {onSpeak && (
                <button
                  onClick={(e) => { e.stopPropagation(); onSpeak(feedback.corrected_text!); }}
                  aria-label="Listen to corrected text"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', verticalAlign: 'middle' }}
                >
                  <Volume2 size={13} color="var(--primary, #6366f1)" />
                </button>
              )}
            </div>
          )}
          {showDrillButtons && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setTryAgainMode(true);
                  setTryAgainResult(null);
                  setTryAgainInput('');
                  setTimeout(() => inputRef.current?.focus(), 50);
                }}
                style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600,
                  background: 'var(--primary, #6366f1)', color: 'white', border: 'none', cursor: 'pointer',
                }}
              >
                ✏️ Try Again
              </button>
              {speechSupported && onSpeak && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSpeakMode(true);
                    setSpeakResult(null);
                    setSpokenText('');
                    resetSpeech();
                    activeDrillRef.current = 'correction';
                    onSpeak(feedback.corrected_text!);
                  }}
                  aria-label="Say it — speak the correction"
                  style={{
                    padding: '6px 14px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600,
                    background: 'var(--success, #22c55e)', color: 'white', border: 'none', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <Mic size={13} /> Say It
                </button>
              )}
            </div>
          )}
          {tryAgainMode && feedback.corrected_text && (
            <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 8, padding: '10px 12px', background: 'var(--card-bg, #f8f9fa)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>Rewrite the sentence with corrections:</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  ref={inputRef}
                  value={tryAgainInput}
                  onChange={(e) => { setTryAgainInput(e.target.value); setTryAgainResult(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && tryAgainInput.trim()) {
                      const similarity = (() => {
                        const userWords = normalizeText(tryAgainInput).split(/\s+/);
                        const correctWords = normalizeText(feedback.corrected_text!).split(/\s+/);
                        const maxLen = Math.max(userWords.length, correctWords.length);
                        if (maxLen === 0) return 1;
                        let matches = 0;
                        for (let i = 0; i < maxLen; i++) {
                          if (userWords[i] === correctWords[i]) matches++;
                        }
                        return matches / maxLen;
                      })();
                      const success = similarity >= 0.9;
                      setTryAgainResult(success ? 'success' : 'retry');
                      if (success) setTryAgainMode(false);
                      onCorrectionAttempt?.(success);
                    }
                  }}
                  placeholder="Type your correction..."
                  style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: '0.85rem' }}
                />
                <button
                  onClick={() => {
                    if (!tryAgainInput.trim()) return;
                    const userWords = normalizeText(tryAgainInput).split(/\s+/);
                    const correctWords = normalizeText(feedback.corrected_text!).split(/\s+/);
                    const maxLen = Math.max(userWords.length, correctWords.length);
                    let matches = 0;
                    for (let i = 0; i < maxLen; i++) {
                      if (userWords[i] === correctWords[i]) matches++;
                    }
                    const similarity = maxLen > 0 ? matches / maxLen : 1;
                    const success = similarity >= 0.9;
                    setTryAgainResult(success ? 'success' : 'retry');
                    if (success) setTryAgainMode(false);
                    onCorrectionAttempt?.(success);
                  }}
                  style={{ padding: '6px 12px', borderRadius: 6, background: 'var(--primary, #6366f1)', color: 'white', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                >
                  Check
                </button>
              </div>
              {tryAgainResult === 'retry' && (
                <div style={{ marginTop: 6, fontSize: '0.8rem' }}>
                  <span style={{ color: '#f59e0b', fontWeight: 600 }}>Almost!</span>{' '}
                  <InlineCorrectionDiff userInput={tryAgainInput} correct={feedback.corrected_text!} />
                </div>
              )}
            </div>
          )}
          {speakMode && feedback.corrected_text && (
            <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 8, padding: '10px 12px', background: 'var(--card-bg, #f8f9fa)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>Say the corrected sentence aloud:</div>
              {!isListening && !speakResult && (
                <button
                  onClick={() => {
                    resetSpeech();
                    pendingStopRef.current = false;
                    activeDrillRef.current = 'correction';
                    startListening();
                  }}
                  aria-label="Start recording your correction"
                  style={{
                    padding: '6px 14px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600,
                    background: 'var(--primary, #6366f1)', color: 'white', border: 'none', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <Mic size={13} /> Start Speaking
                </button>
              )}
              {isListening && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <button
                      onClick={() => {
                        pendingStopRef.current = true;
                        stopListening();
                      }}
                      aria-label="Stop recording"
                      style={{
                        padding: '6px 14px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600,
                        background: 'var(--danger, #ef4444)', color: 'white', border: 'none', cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      <MicOff size={13} /> Stop
                    </button>
                    <span style={{ fontSize: '0.8rem', color: 'var(--danger, #ef4444)', fontWeight: 500 }}>● Recording…</span>
                  </div>
                  {transcript && (
                    <div style={{ padding: 6, background: 'var(--bg, #fff)', borderRadius: 6, fontSize: '0.85rem', color: 'var(--text)' }}>
                      {transcript}
                    </div>
                  )}
                </div>
              )}
              {speakResult === 'retry' && spokenText && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: '0.8rem', marginBottom: 4 }}>
                    <span style={{ color: 'var(--warning, #f59e0b)', fontWeight: 600 }}>Almost!</span>{' '}
                    <InlineCorrectionDiff userInput={spokenText} correct={feedback.corrected_text!} />
                  </div>
                  <button
                    onClick={() => {
                      setSpeakResult(null);
                      setSpokenText('');
                      resetSpeech();
                      onSpeak?.(feedback.corrected_text!);
                    }}
                    style={{
                      marginTop: 4, padding: '6px 14px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600,
                      background: 'var(--primary, #6366f1)', color: 'white', border: 'none', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    <Mic size={13} /> Try Again
                  </button>
                </div>
              )}
            </div>
          )}
          {(tryAgainResult === 'success' || speakResult === 'success') && (
            <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--success-bg, #dcfce7)', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, color: 'var(--success, #16a34a)' }}>
              ✅ Excellent! You got it right!
            </div>
          )}
        </>
      )}
    </div>
  );
}
