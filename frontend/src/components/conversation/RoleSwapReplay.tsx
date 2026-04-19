import { useEffect, useRef, useState } from 'react';
import { api, type RoleSwapScript, type RoleSwapTurn } from '../../api';
import { useSpeechSynthesis } from '../../hooks/useSpeechSynthesis';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useI18n } from '../../i18n/I18nContext';

interface RoleSwapReplayProps {
  conversationId: number;
  onClose: () => void;
}

/**
 * Role-Swap Replay: walks through the original conversation with roles reversed.
 *  - Turns originally spoken by the user → played back via TTS so the learner
 *    hears their own previous lines (now coming from the "other side").
 *  - Turns originally spoken by the assistant → hidden target text the learner
 *    must speak (or reveal), with optional mic capture.
 */
export function RoleSwapReplay({ conversationId, onClose }: RoleSwapReplayProps) {
  const { t } = useI18n();
  const [script, setScript] = useState<RoleSwapScript | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [turnIdx, setTurnIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [finished, setFinished] = useState(false);
  const tts = useSpeechSynthesis();
  const speech = useSpeechRecognition({ continuous: false });
  const autoPlayedRef = useRef<number>(-1);

  // Load script on mount.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getRoleSwapScript(conversationId)
      .then((data) => {
        if (cancelled) return;
        setScript(data);
        setLoading(false);
        if (!data.turns || data.turns.length === 0) {
          setFinished(true);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || 'Failed to load role-swap script');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const currentTurn: RoleSwapTurn | null =
    script && !finished && turnIdx < script.turns.length ? script.turns[turnIdx] : null;

  // For user-original turns: auto-play TTS once when entering the turn.
  useEffect(() => {
    if (!currentTurn) return;
    if (currentTurn.original_speaker !== 'user') return;
    if (autoPlayedRef.current === currentTurn.index) return;
    autoPlayedRef.current = currentTurn.index;
    if (tts.isSupported) {
      tts.speak(currentTurn.text);
    }
  }, [currentTurn, tts]);

  // Reset per-turn UI when turn changes.
  useEffect(() => {
    setRevealed(false);
    speech.reset();
    speech.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnIdx]);

  // Stop TTS / speech recognition on unmount.
  useEffect(() => {
    return () => {
      tts.stop();
      speech.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNext = () => {
    if (!script) return;
    tts.stop();
    speech.stop();
    if (turnIdx + 1 >= script.turns.length) {
      setFinished(true);
    } else {
      setTurnIdx((i) => i + 1);
    }
  };

  const handleClose = () => {
    tts.stop();
    speech.stop();
    onClose();
  };

  const handleReplay = () => {
    if (!currentTurn) return;
    if (tts.isSupported) {
      tts.speak(currentTurn.text);
    }
  };

  const toggleMic = () => {
    if (speech.isListening) {
      speech.stop();
    } else {
      speech.reset();
      speech.start();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('roleSwapReplayTitle')}
      data-testid="role-swap-replay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        className="card"
        style={{
          background: 'var(--bg-card, white)',
          color: 'var(--text-primary, inherit)',
          width: '100%',
          maxWidth: 560,
          padding: 20,
          borderRadius: 12,
          boxShadow: '0 8px 28px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{t('roleSwapReplayTitle')}</h3>
          <button
            className="btn btn-secondary"
            onClick={handleClose}
            aria-label={t('roleSwapClose')}
            data-testid="role-swap-close"
          >
            ✕
          </button>
        </div>

        {loading && <p>{t('roleSwapLoading')}</p>}
        {error && (
          <p role="alert" style={{ color: 'crimson' }}>
            {error}
          </p>
        )}

        {!loading && !error && script && script.turns.length === 0 && (
          <p>{t('roleSwapEmpty')}</p>
        )}

        {!loading && !error && script && currentTurn && (
          <>
            <div style={{ fontSize: 12, color: 'var(--text-secondary, #888)', marginBottom: 8 }}>
              {t('roleSwapTurnProgress')
                .replace('{n}', String(turnIdx + 1))
                .replace('{total}', String(script.turns.length))}
            </div>

            {currentTurn.original_speaker === 'user' ? (
              <div data-testid="role-swap-listen-card">
                <p style={{ fontWeight: 600, marginBottom: 6 }}>
                  🎧 {t('roleSwapListenPrompt')}
                </p>
                <blockquote
                  style={{
                    margin: '8px 0',
                    padding: '10px 12px',
                    borderLeft: '4px solid var(--primary, #6366f1)',
                    background: 'rgba(99,102,241,0.08)',
                    borderRadius: 6,
                  }}
                >
                  {currentTurn.text}
                </blockquote>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-secondary"
                    onClick={handleReplay}
                    disabled={!tts.isSupported}
                  >
                    🔊 {t('roleSwapReplayAudio')}
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleNext}
                    data-testid="role-swap-listened-next"
                  >
                    {t('roleSwapListened')}
                  </button>
                </div>
              </div>
            ) : (
              <div data-testid="role-swap-speak-card">
                <p style={{ fontWeight: 600, marginBottom: 6 }}>
                  🎤 {t('roleSwapSpeakPrompt')}
                </p>
                {revealed ? (
                  <blockquote
                    style={{
                      margin: '8px 0',
                      padding: '10px 12px',
                      borderLeft: '4px solid var(--success, #10b981)',
                      background: 'rgba(16,185,129,0.08)',
                      borderRadius: 6,
                    }}
                    data-testid="role-swap-revealed-text"
                  >
                    {currentTurn.text}
                  </blockquote>
                ) : (
                  <div
                    style={{
                      margin: '8px 0',
                      padding: '10px 12px',
                      background: 'rgba(0,0,0,0.05)',
                      borderRadius: 6,
                      fontStyle: 'italic',
                      color: 'var(--text-secondary, #888)',
                    }}
                  >
                    {t('roleSwapHidden')}
                  </div>
                )}
                {speech.transcript && (
                  <div style={{ marginTop: 8, fontSize: 14 }}>
                    <strong>{t('roleSwapYouSaid')}:</strong> {speech.transcript}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  {speech.isSupported && (
                    <button
                      className="btn btn-secondary"
                      onClick={toggleMic}
                      aria-pressed={speech.isListening}
                      data-testid="role-swap-mic"
                    >
                      {speech.isListening ? '⏹ ' + t('roleSwapStopMic') : '🎙 ' + t('roleSwapStartMic')}
                    </button>
                  )}
                  {!revealed && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => setRevealed(true)}
                      data-testid="role-swap-reveal"
                    >
                      👁 {t('roleSwapReveal')}
                    </button>
                  )}
                  <button
                    className="btn btn-secondary"
                    onClick={handleNext}
                    data-testid="role-swap-skip"
                  >
                    ⏭ {t('roleSwapSkip')}
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleNext}
                    data-testid="role-swap-next"
                  >
                    {t('roleSwapNext')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {!loading && !error && finished && script && script.turns.length > 0 && (
          <div data-testid="role-swap-finished">
            <p style={{ fontWeight: 600 }}>✅ {t('roleSwapFinished')}</p>
            <button className="btn btn-primary" onClick={handleClose}>
              {t('roleSwapDone')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default RoleSwapReplay;
