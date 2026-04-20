import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Volume2, ArrowLeft, CheckCircle, XCircle, RefreshCw, Home as HomeIcon, Headphones } from 'lucide-react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import {
  api,
  type MinimalPairsDrillItem,
  type MinimalPairsContrastStat,
} from '../api';

type Phase = 'select' | 'loading' | 'drill' | 'feedback' | 'summary' | 'error';

interface AnswerRecord {
  item: MinimalPairsDrillItem;
  chosen: 'a' | 'b';
  correct: boolean;
}

const SESSION_SIZE = 8;
const CONTRAST_LABELS: Record<string, string> = {
  IY_vs_IH: '/ɪ/ vs /iː/  (ship / sheep)',
  AE_vs_EH: '/æ/ vs /e/  (bat / bet)',
  L_vs_R: '/l/ vs /r/  (light / right)',
  B_vs_V: '/b/ vs /v/  (berry / very)',
  S_vs_SH: '/s/ vs /ʃ/  (sip / ship)',
  TH_vs_S: '/θ/ vs /s/  (think / sink)',
  N_vs_NG: '/n/ vs /ŋ/  (thin / thing)',
};

function contrastLabel(key: string): string {
  return CONTRAST_LABELS[key] ?? key;
}

export default function MinimalPairsPage() {
  const tts = useSpeechSynthesis();
  const [phase, setPhase] = useState<Phase>('select');
  const [contrastFilter, setContrastFilter] = useState<string>('');
  const [items, setItems] = useState<MinimalPairsDrillItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [feedback, setFeedback] = useState<{ correct: boolean; streak: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [availableContrasts, setAvailableContrasts] = useState<string[]>([]);
  const [statsByContrast, setStatsByContrast] = useState<MinimalPairsContrastStat[]>([]);

  // Load available contrasts once on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getMinimalPairsDrillContrasts();
        if (!cancelled) setAvailableContrasts(data.contrasts);
      } catch {
        if (!cancelled) setAvailableContrasts(Object.keys(CONTRAST_LABELS));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const startSession = useCallback(async (contrast: string) => {
    setPhase('loading');
    setErrorMsg('');
    setAnswers([]);
    setIdx(0);
    setFeedback(null);
    try {
      const data = await api.getMinimalPairsDrillSession(contrast || undefined, SESSION_SIZE);
      if (!data.items.length) {
        setErrorMsg('No items available for that contrast.');
        setPhase('error');
        return;
      }
      setItems(data.items);
      setPhase('drill');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load session');
      setPhase('error');
    }
  }, []);

  const currentItem: MinimalPairsDrillItem | null = items[idx] ?? null;

  const playTarget = useCallback(() => {
    if (!currentItem) return;
    tts.speak(currentItem.target_word);
  }, [currentItem, tts]);

  // Auto-play the first time the drill item changes
  useEffect(() => {
    if (phase === 'drill' && currentItem) {
      const t = setTimeout(() => tts.speak(currentItem.target_word), 250);
      return () => clearTimeout(t);
    }
  }, [phase, currentItem, tts]);

  const submitChoice = useCallback(async (chosen: 'a' | 'b') => {
    if (!currentItem) return;
    try {
      const res = await api.submitMinimalPairsDrillAnswer({
        item_id: currentItem.item_id,
        contrast: currentItem.contrast,
        target: currentItem.target,
        chosen,
      });
      setAnswers(prev => [...prev, { item: currentItem, chosen, correct: res.correct }]);
      setFeedback({ correct: res.correct, streak: res.streak });
      setPhase('feedback');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Submit failed');
      setPhase('error');
    }
  }, [currentItem]);

  const nextItem = useCallback(async () => {
    setFeedback(null);
    if (idx + 1 >= items.length) {
      // Load stats for summary
      try {
        const stats = await api.getMinimalPairsDrillStats();
        setStatsByContrast(stats.stats);
      } catch {
        setStatsByContrast([]);
      }
      setPhase('summary');
    } else {
      setIdx(i => i + 1);
      setPhase('drill');
    }
  }, [idx, items.length]);

  const overallAccuracy = useMemo(() => {
    if (!answers.length) return 0;
    return Math.round((answers.filter(a => a.correct).length / answers.length) * 100);
  }, [answers]);

  const sessionPerContrast = useMemo(() => {
    const map: Record<string, { total: number; correct: number }> = {};
    for (const a of answers) {
      const c = a.item.contrast;
      if (!map[c]) map[c] = { total: 0, correct: 0 };
      map[c].total += 1;
      if (a.correct) map[c].correct += 1;
    }
    return Object.entries(map).map(([contrast, v]) => ({
      contrast,
      total: v.total,
      correct: v.correct,
      accuracy: v.total ? v.correct / v.total : 0,
    }));
  }, [answers]);

  const weakestContrast = useMemo(() => {
    if (!statsByContrast.length) {
      // Fall back to current session's weakest
      const sorted = [...sessionPerContrast].sort((a, b) => a.accuracy - b.accuracy);
      return sorted[0]?.contrast ?? '';
    }
    const eligible = statsByContrast.filter(s => s.attempts >= 3);
    if (!eligible.length) return '';
    const sorted = [...eligible].sort((a, b) => a.accuracy - b.accuracy);
    return sorted[0]?.contrast ?? '';
  }, [statsByContrast, sessionPerContrast]);

  // ---------------------- Render ----------------------

  if (phase === 'error') {
    return (
      <div className="page-container" style={{ padding: '1.5rem', maxWidth: 720, margin: '0 auto' }}>
        <h2>Minimal Pairs Drill</h2>
        <p style={{ color: 'var(--error, #ef4444)' }}>{errorMsg || 'An error occurred.'}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => setPhase('select')}>Back to start</button>
          <Link to="/" className="btn-ghost">Home</Link>
        </div>
      </div>
    );
  }

  if (phase === 'select') {
    return (
      <div className="page-container" style={{ padding: '1.5rem', maxWidth: 720, margin: '0 auto' }}>
        <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          <ArrowLeft size={14} /> Home
        </Link>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Headphones size={24} color="#8b5cf6" /> Minimal Pairs Drill
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
          Train your ear to hear subtle phoneme contrasts like <em>ship</em> vs <em>sheep</em>.
          Pick a contrast to focus on, or choose "Mixed" for a random selection.
        </p>

        <div
          data-testid="mp-drill-contrast-picker"
          style={{ display: 'grid', gap: 8, marginBottom: 16 }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>
            <input
              type="radio"
              name="contrast"
              value=""
              checked={contrastFilter === ''}
              onChange={() => setContrastFilter('')}
            />
            <span style={{ fontWeight: 600 }}>Mixed</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>— all contrasts</span>
          </label>
          {availableContrasts.map(c => (
            <label
              key={c}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}
            >
              <input
                type="radio"
                name="contrast"
                value={c}
                checked={contrastFilter === c}
                onChange={() => setContrastFilter(c)}
              />
              <span>{contrastLabel(c)}</span>
            </label>
          ))}
        </div>

        <button
          type="button"
          className="btn"
          data-testid="mp-drill-start-btn"
          onClick={() => startSession(contrastFilter)}
          style={{ padding: '12px 20px', fontSize: 15, fontWeight: 600 }}
        >
          Start drill ({SESSION_SIZE} items)
        </button>
      </div>
    );
  }

  if (phase === 'loading') {
    return (
      <div className="page-container" style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Loading session…</p>
      </div>
    );
  }

  if ((phase === 'drill' || phase === 'feedback') && currentItem) {
    const showFeedback = phase === 'feedback' && feedback;
    const targetLetter = currentItem.target;
    const targetExample = targetLetter === 'a' ? currentItem.example_a : currentItem.example_b;
    return (
      <div
        className="page-container"
        style={{ padding: '1.5rem', maxWidth: 720, margin: '0 auto' }}
        data-testid="mp-drill-round"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {idx + 1} / {items.length}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {contrastLabel(currentItem.contrast)}
          </span>
        </div>

        <div style={{ textAlign: 'center', margin: '1.5rem 0' }}>
          <button
            type="button"
            onClick={playTarget}
            data-testid="mp-drill-play-btn"
            className="btn"
            style={{
              padding: '16px 24px', borderRadius: 999, fontSize: 16,
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}
            aria-label="Play audio"
          >
            <Volume2 size={20} /> Play
          </button>
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={playTarget}
              data-testid="mp-drill-replay-btn"
              style={{
                background: 'none', border: 'none', color: 'var(--text-secondary)',
                cursor: 'pointer', fontSize: 13, textDecoration: 'underline',
              }}
            >
              Replay
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {(['a', 'b'] as const).map((letter) => {
            const word = letter === 'a' ? currentItem.word_a : currentItem.word_b;
            const isChosen = showFeedback && answers[answers.length - 1]?.chosen === letter;
            const isTarget = showFeedback && letter === currentItem.target;
            let bg = 'var(--surface)';
            let color = 'var(--text)';
            if (showFeedback) {
              if (isTarget) { bg = '#16a34a'; color = 'white'; }
              else if (isChosen) { bg = '#ef4444'; color = 'white'; }
            }
            return (
              <button
                key={letter}
                type="button"
                data-testid={`mp-drill-choice-${letter}`}
                onClick={() => !showFeedback && submitChoice(letter)}
                disabled={showFeedback !== null && showFeedback !== false}
                style={{
                  padding: '28px 12px',
                  fontSize: 22,
                  fontWeight: 700,
                  border: '2px solid var(--border)',
                  borderRadius: 12,
                  background: bg,
                  color,
                  cursor: showFeedback ? 'default' : 'pointer',
                  transition: 'all 150ms',
                }}
              >
                {word}
              </button>
            );
          })}
        </div>

        {showFeedback && feedback && (
          <div
            data-testid="mp-drill-feedback"
            style={{
              marginTop: 16, padding: 12, borderRadius: 8,
              background: feedback.correct ? 'rgba(22,163,74,0.12)' : 'rgba(239,68,68,0.12)',
              border: `1px solid ${feedback.correct ? '#16a34a' : '#ef4444'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
              {feedback.correct ? <CheckCircle size={18} color="#16a34a" /> : <XCircle size={18} color="#ef4444" />}
              {feedback.correct ? `Correct! Streak: ${feedback.streak}` : 'Not quite.'}
            </div>
            <div style={{ marginTop: 6, fontSize: 14, color: 'var(--text-secondary)' }}>
              You heard <strong>{currentItem.target_word}</strong>: “{targetExample}”
            </div>
            <button
              type="button"
              className="btn"
              data-testid="mp-drill-next-btn"
              onClick={nextItem}
              style={{ marginTop: 10 }}
            >
              {idx + 1 >= items.length ? 'See results' : 'Next →'}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (phase === 'summary') {
    return (
      <div
        className="page-container"
        style={{ padding: '1.5rem', maxWidth: 720, margin: '0 auto' }}
        data-testid="mp-drill-summary"
      >
        <h2>Session summary</h2>
        <div
          style={{
            padding: '1rem', borderRadius: 12, background: 'var(--surface)',
            border: '1px solid var(--border)', marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 36, fontWeight: 700 }}>
            {overallAccuracy}%
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            {answers.filter(a => a.correct).length} of {answers.length} correct
          </div>
        </div>

        <h3 style={{ fontSize: 15, marginBottom: 8 }}>By contrast (this session)</h3>
        <div style={{ display: 'grid', gap: 6, marginBottom: 16 }}>
          {sessionPerContrast.map(s => (
            <div key={s.contrast} data-testid={`mp-drill-bar-${s.contrast}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>{contrastLabel(s.contrast)}</span>
                <span>{s.correct}/{s.total}</span>
              </div>
              <div style={{ height: 6, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.round(s.accuracy * 100)}%`,
                    height: '100%',
                    background: s.accuracy >= 0.75 ? '#16a34a' : s.accuracy >= 0.5 ? '#eab308' : '#ef4444',
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {weakestContrast && (
            <button
              type="button"
              className="btn"
              data-testid="mp-drill-retry-weakest-btn"
              onClick={() => startSession(weakestContrast)}
            >
              Retry weakest: {contrastLabel(weakestContrast)}
            </button>
          )}
          <button
            type="button"
            className="btn-ghost"
            data-testid="mp-drill-retry-btn"
            onClick={() => startSession(contrastFilter)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <RefreshCw size={14} /> Retry
          </button>
          <Link
            to="/"
            className="btn-ghost"
            data-testid="mp-drill-home-btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <HomeIcon size={14} /> Home
          </Link>
        </div>
      </div>
    );
  }

  return null;
}
