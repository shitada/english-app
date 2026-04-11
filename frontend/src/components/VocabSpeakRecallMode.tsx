import { useState, useCallback } from 'react';
import { Mic, Check, X, ArrowRight, SkipForward, RotateCcw } from 'lucide-react';
import VocabSRSProgress, { type SRSChange } from './VocabSRSProgress';
import { api } from '../api';

interface DrillWord {
  id: number;
  word: string;
  meaning: string;
  topic: string;
  difficulty: number;
}

interface VocabSpeakRecallModeProps {
  initialWords: DrillWord[];
  speech: {
    isListening: boolean;
    transcript: string;
    start: () => void;
    stop: () => void;
    reset: () => void;
  };
  onBack: () => void;
}

export default function VocabSpeakRecallMode({ initialWords, speech, onBack }: VocabSpeakRecallModeProps) {
  const [words] = useState(initialWords);
  const [index, setIndex] = useState(0);
  const [checked, setChecked] = useState(false);
  const [results, setResults] = useState<{ word: string; matched: boolean; skipped: boolean }[]>([]);
  const [srsChanges, setSrsChanges] = useState<SRSChange[]>([]);
  const [phase, setPhase] = useState<'practice' | 'result'>('practice');

  const w = words[index];
  const transcript = speech.transcript.trim().toLowerCase();
  const matched = checked && transcript === w?.word.toLowerCase();

  const handleRecord = useCallback(() => {
    if (speech.isListening) { speech.stop(); return; }
    setChecked(false);
    speech.reset();
    speech.start();
  }, [speech]);

  const handleCheck = useCallback(() => {
    speech.stop();
    setChecked(true);
    if (w) {
      const isCorrect = speech.transcript.trim().toLowerCase() === w.word.toLowerCase();
      api.submitAnswer(w.id, isCorrect).then(res => {
        setSrsChanges(prev => [...prev, { word: w.word, newLevel: res.new_level, isCorrect, nextReview: res.next_review }]);
      }).catch(() => {});
    }
  }, [speech, w]);

  const advance = useCallback((skipped: boolean) => {
    const result = { word: w.word, matched: !skipped && matched, skipped };
    const newResults = [...results, result];
    setResults(newResults);
    if (index + 1 >= words.length) {
      setPhase('result');
    } else {
      setIndex(index + 1);
      setChecked(false);
      speech.reset();
    }
  }, [w, matched, results, index, words.length, speech]);

  if (phase === 'result') {
    const correct = results.filter(r => r.matched).length;
    const skipped = results.filter(r => r.skipped).length;
    const pct = Math.round((correct / results.length) * 100);
    return (
      <div className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
        <h2 style={{ marginBottom: 16 }}>🧠 Speak from Memory — Results</h2>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <p style={{ fontSize: '2rem', fontWeight: 700, color: pct >= 70 ? 'var(--success, #22c55e)' : 'var(--warning, #f59e0b)' }}>{pct}%</p>
          <p style={{ color: 'var(--text-secondary)' }}>{correct}/{results.length} correct · {skipped} skipped</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
          {results.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, background: r.matched ? 'rgba(34,197,94,0.1)' : r.skipped ? 'rgba(156,163,175,0.1)' : 'rgba(239,68,68,0.1)' }}>
              {r.matched ? <Check size={16} color="#22c55e" /> : r.skipped ? <SkipForward size={16} color="#9ca3af" /> : <X size={16} color="#ef4444" />}
              <span style={{ fontWeight: 500 }}>{r.word}</span>
            </div>
          ))}
        </div>
        {srsChanges.length > 0 && <VocabSRSProgress changes={srsChanges} />}
        <button className="btn btn-primary" onClick={onBack} style={{ width: '100%' }}>← Back to Topics</button>
      </div>
    );
  }

  if (!w) return null;

  return (
    <div className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>🧠 Speak from Memory</h2>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{index + 1} / {words.length}</span>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 20, padding: '20px 16px', background: 'var(--bg-secondary, #f9fafb)', borderRadius: 12 }}>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>What word means…</p>
        <p style={{ fontSize: '1.3rem', fontWeight: 600, margin: 0 }}>{w.meaning}</p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <button
          className={`btn ${speech.isListening ? 'btn-danger' : 'btn-primary'}`}
          onClick={handleRecord}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Mic size={18} /> {speech.isListening ? 'Stop' : 'Say the Word'}
        </button>
        {speech.transcript && !checked && (
          <button className="btn btn-primary" onClick={handleCheck} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Check size={18} /> Check
          </button>
        )}
      </div>

      {speech.transcript && (
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>You said:</p>
          <p style={{ fontSize: '1.2rem', fontWeight: 600 }}>&ldquo;{speech.transcript}&rdquo;</p>
        </div>
      )}

      {checked && (
        <div style={{ textAlign: 'center', marginBottom: 16, padding: 16, background: matched ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', borderRadius: 8 }}>
          {matched ? (
            <p style={{ color: 'var(--success, #22c55e)', fontWeight: 700, fontSize: '1.1rem' }}><Check size={20} style={{ verticalAlign: 'middle' }} /> Correct!</p>
          ) : (
            <p style={{ color: 'var(--danger, #ef4444)', fontWeight: 700, fontSize: '1.1rem' }}><X size={20} style={{ verticalAlign: 'middle' }} /> The word was &ldquo;{w.word}&rdquo;</p>
          )}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
        {checked && !matched && (
          <button className="btn btn-secondary" onClick={() => { setChecked(false); speech.reset(); }} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <RotateCcw size={16} /> Retry
          </button>
        )}
        <button className="btn btn-secondary" onClick={() => advance(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SkipForward size={16} /> Skip
        </button>
        {checked && (
          <button className="btn btn-primary" onClick={() => advance(false)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {index + 1 >= words.length ? 'See Results' : 'Next'} <ArrowRight size={16} />
          </button>
        )}
      </div>

      <button className="btn btn-secondary" onClick={onBack} style={{ marginTop: 16, fontSize: '0.85rem' }}>
        ← Back to Topics
      </button>
    </div>
  );
}
