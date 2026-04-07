import { useState } from 'react';
import { Volume2, Mic } from 'lucide-react';
import { api } from '../../api';

const TONGUE_TWISTERS = [
  { text: "She sells seashells by the seashore.", difficulty: "beginner", focus: "s/sh" },
  { text: "Red lorry, yellow lorry.", difficulty: "beginner", focus: "r/l" },
  { text: "Toy boat, toy boat, toy boat.", difficulty: "beginner", focus: "t/b" },
  { text: "Fresh French fried fish.", difficulty: "beginner", focus: "f/fr" },
  { text: "Six sticky skeletons.", difficulty: "beginner", focus: "s/sk" },
  { text: "Peter Piper picked a peck of pickled peppers.", difficulty: "intermediate", focus: "p" },
  { text: "Betty Botter bought some butter but the butter was bitter.", difficulty: "intermediate", focus: "b/t" },
  { text: "Three thin thieves thought a thousand thoughts.", difficulty: "intermediate", focus: "th" },
  { text: "A proper copper coffee pot.", difficulty: "intermediate", focus: "p/k" },
  { text: "How much wood would a woodchuck chuck if a woodchuck could chuck wood?", difficulty: "intermediate", focus: "w/ch" },
  { text: "The sixth sick sheikh's sixth sheep's sick.", difficulty: "advanced", focus: "s/sh/th" },
  { text: "Pad kid poured curd pulled cod.", difficulty: "advanced", focus: "p/k/d" },
  { text: "Brisk brave brigadiers brandished broad bright blades.", difficulty: "advanced", focus: "br/bl" },
  { text: "Imagine an imaginary menagerie manager managing an imaginary menagerie.", difficulty: "advanced", focus: "m/n/j" },
  { text: "Unique New York, unique New York, you know you need unique New York.", difficulty: "advanced", focus: "n/y" },
];

const TT_SPEEDS = [0.7, 0.9, 1.2];
const TT_LABELS = ['🐢 Slow', '1× Normal', '🐇 Fast'];

interface TongueTwisterDrillProps {
  speech: {
    transcript: string;
    listening: boolean;
    start: () => void;
    reset: () => void;
  };
  tts: {
    speak: (text: string) => void;
    isSpeaking: boolean;
    setRate: (r: number) => void;
  };
  onBack: () => void;
}

export function TongueTwisterDrill({ speech, tts, onBack }: TongueTwisterDrillProps) {
  const [phase, setPhase] = useState<'select' | 'practice' | 'finished'>('select');
  const [ttIndex, setTtIndex] = useState(0);
  const [ttSpeedTier, setTtSpeedTier] = useState(0);
  const [ttScores, setTtScores] = useState<(number | null)[]>([null, null, null]);
  const [ttStarted, setTtStarted] = useState(false);
  const [ttFinished, setTtFinished] = useState(false);
  const [ttDifficulty, setTtDifficulty] = useState<'all' | 'beginner' | 'intermediate' | 'advanced'>('all');
  const [loading, setLoading] = useState(false);

  const ttFiltered = TONGUE_TWISTERS.filter(t => ttDifficulty === 'all' || t.difficulty === ttDifficulty);

  if (phase === 'select') {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
          Practice tongue twisters at increasing speed. Score ≥ 7 to advance!
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          {(['all', 'beginner', 'intermediate', 'advanced'] as const).map((level) => (
            <button
              key={level}
              className={`btn ${ttDifficulty === level ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTtDifficulty(level)}
              style={{ fontSize: 13, padding: '4px 12px' }}
            >
              {level === 'all' ? 'All' : level === 'beginner' ? '🌱 Beginner' : level === 'intermediate' ? '📗 Intermediate' : '🚀 Advanced'}
            </button>
          ))}
        </div>
        <button
          className="btn btn-primary"
          onClick={() => { setTtIndex(0); setTtSpeedTier(0); setTtScores([null, null, null]); setTtStarted(true); setTtFinished(false); speech.reset(); setPhase('practice'); }}
          style={{ padding: '10px 32px', fontSize: 16 }}
          disabled={ttFiltered.length === 0}
        >
          🌀 Start Drill
        </button>
      </div>
    );
  }

  if (!ttStarted || ttFiltered.length === 0) {
    return null;
  }

  const currentTwister = ttFiltered[ttIndex % ttFiltered.length];

  if (ttFinished) {
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <h3 style={{ marginBottom: 16 }}>🌀 Tongue Twister Complete!</h3>
        <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>"{currentTwister.text}"</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 24 }}>
          {TT_LABELS.map((label, i) => (
            <div key={i} style={{ padding: '8px 16px', borderRadius: 8, background: ttScores[i] !== null && ttScores[i]! >= 7 ? 'var(--success, #4caf50)' : 'var(--bg-secondary, #f0f0f0)', color: ttScores[i] !== null && ttScores[i]! >= 7 ? 'white' : 'var(--text)' }}>
              <div style={{ fontSize: 13 }}>{label}</div>
              <div style={{ fontWeight: 700, fontSize: 20 }}>{ttScores[i] !== null ? `${ttScores[i]}/10` : '—'}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {ttIndex < ttFiltered.length - 1 ? (
            <button className="btn btn-primary" onClick={() => { setTtIndex(ttIndex + 1); setTtSpeedTier(0); setTtScores([null, null, null]); setTtFinished(false); speech.reset(); }}>
              Next Twister →
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => { onBack(); setTtStarted(false); }}>
              ← Back to Selection
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <h3 style={{ marginBottom: 8 }}>🌀 Tongue Twister Drill</h3>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
        Twister {ttIndex + 1}/{ttFiltered.length} · Focus: {currentTwister.focus} · {currentTwister.difficulty}
      </p>

      <div style={{ padding: 20, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 12, marginBottom: 16 }}>
        <p style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.5 }}>"{currentTwister.text}"</p>
      </div>

      <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginBottom: 16 }}>
        {TT_LABELS.map((label, i) => (
          <span key={i} style={{
            padding: '4px 10px', borderRadius: 6, fontSize: 13,
            background: i === ttSpeedTier ? 'var(--primary)' : i < ttSpeedTier ? 'var(--success, #4caf50)' : 'var(--bg-secondary, #e0e0e0)',
            color: i <= ttSpeedTier ? 'white' : 'var(--text-secondary)',
            fontWeight: i === ttSpeedTier ? 600 : 400,
          }}>
            {label} {ttScores[i] !== null ? `(${ttScores[i]}/10)` : ''}
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <button className="btn btn-secondary" onClick={() => { tts.setRate(TT_SPEEDS[ttSpeedTier]); tts.speak(currentTwister.text); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Volume2 size={16} /> Listen ({TT_LABELS[ttSpeedTier]})
        </button>
        <button className="btn btn-primary" onClick={() => { speech.reset(); speech.start(); }} disabled={speech.listening} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Mic size={16} /> {speech.listening ? 'Listening…' : 'Record & Speak'}
        </button>
      </div>

      {speech.transcript && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 4 }}>You said:</p>
          <p style={{ fontStyle: 'italic', marginBottom: 8 }}>{speech.transcript}</p>
          <button className="btn btn-primary" disabled={loading} onClick={async () => {
            setLoading(true);
            try {
              const res = await api.checkPronunciation(currentTwister.text, speech.transcript, currentTwister.difficulty as 'beginner' | 'intermediate' | 'advanced');
              const score = res.overall_score ?? 0;
              const newScores = [...ttScores];
              newScores[ttSpeedTier] = score;
              setTtScores(newScores);
              if (score >= 7 && ttSpeedTier < 2) {
                setTtSpeedTier(ttSpeedTier + 1);
                speech.reset();
              } else if (score >= 7 && ttSpeedTier === 2) {
                setTtFinished(true);
              }
            } catch (err) { console.error('Check failed:', err); }
            finally { setLoading(false); }
          }}>
            {loading ? 'Checking…' : '✓ Check Pronunciation'}
          </button>
        </div>
      )}

      <button className="btn btn-secondary" onClick={() => {
        if (ttSpeedTier < 2) { setTtSpeedTier(ttSpeedTier + 1); speech.reset(); }
        else { setTtFinished(true); }
      }} style={{ fontSize: 13 }}>
        Skip Speed →
      </button>
    </div>
  );
}
