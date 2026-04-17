import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, type PronunciationWeaknessItem, type MistakePatternItem } from '../../api';
import { PronunciationWordDrill } from './PronunciationWordDrill';

export function PronunciationWeakSpots() {
  const [weaknesses, setWeaknesses] = useState<PronunciationWeaknessItem[]>([]);
  const [patterns, setPatterns] = useState<MistakePatternItem[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [drillWord, setDrillWord] = useState<string | null>(null);

  useEffect(() => {
    api.getPronunciationWeaknesses().then(r => setWeaknesses(r.weaknesses)).catch(() => {});
    api.getPronunciationCommonMistakes().then(r => setPatterns(r.patterns)).catch(() => {});
  }, []);

  if (weaknesses.length === 0 && patterns.length === 0) return null;

  const visibleWords = expanded ? weaknesses : weaknesses.slice(0, 5);
  const maxWordCount = Math.max(...weaknesses.map(w => w.occurrence_count), 1);

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        🗣️ Pronunciation Weak Spots
      </h3>

      {/* Sound confusion patterns */}
      {patterns.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Sound Confusions
          </h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {patterns.map((p, i) => (
              <div
                key={i}
                style={{
                  padding: '6px 12px',
                  background: 'var(--bg-secondary)',
                  borderRadius: 8,
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span style={{ fontWeight: 700, color: '#ef4444' }}>{p.target_sound}</span>
                <span style={{ color: 'var(--text-secondary)' }}>→</span>
                <span style={{ fontWeight: 700, color: '#f59e0b' }}>{p.produced_sound}</span>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 4 }}>
                  ×{p.occurrence_count}
                </span>
                {p.example_words.length > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                    ({p.example_words.slice(0, 2).join(', ')})
                  </span>
                )}
                <Link
                  to={`/pronunciation?phoneme=${encodeURIComponent(p.target_sound)}`}
                  style={{
                    background: 'none',
                    color: 'var(--accent, #6366f1)',
                    border: '1px solid var(--accent, #6366f1)',
                    borderRadius: 4,
                    padding: '1px 6px',
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: 'pointer',
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                    marginLeft: 4,
                  }}
                >
                  Practice
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mispronounced words */}
      {weaknesses.length > 0 && (
        <div>
          <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Commonly Mispronounced Words
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {visibleWords.map((w) => (
              <div key={w.word}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {w.word}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                    {w.occurrence_count} {w.occurrence_count === 1 ? 'time' : 'times'}
                    {w.common_heard_as.length > 0 && (
                      <> · heard as: {w.common_heard_as.slice(0, 2).map(h => h[0]).join(', ')}</>
                    )}
                    <button
                      onClick={() => setDrillWord(drillWord === w.word ? null : w.word)}
                      style={{
                        background: drillWord === w.word ? 'var(--accent, #6366f1)' : 'none',
                        color: drillWord === w.word ? '#fff' : 'var(--accent, #6366f1)',
                        border: '1px solid var(--accent, #6366f1)',
                        borderRadius: 4,
                        padding: '2px 8px',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {drillWord === w.word ? 'Close ✕' : 'Practice 🎤'}
                    </button>
                  </span>
                </div>
                <div style={{ width: '100%', height: 16, background: 'var(--bg-secondary)', borderRadius: 6, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${(w.occurrence_count / maxWordCount) * 100}%`,
                      height: '100%',
                      background: '#ef4444',
                      borderRadius: 6,
                      opacity: 0.7,
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
                {w.tips.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, fontStyle: 'italic' }}>
                    💡 {w.tips[0]}
                  </div>
                )}

                {/* Inline pronunciation drill */}
                {drillWord === w.word && (
                  <PronunciationWordDrill
                    words={[w]}
                    onClose={() => setDrillWord(null)}
                  />
                )}
              </div>
            ))}
          </div>

          {weaknesses.length > 5 && (
            <button
              onClick={() => setExpanded(!expanded)}
              style={{
                marginTop: 12,
                background: 'none',
                border: 'none',
                color: 'var(--accent)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                padding: 0,
              }}
            >
              {expanded ? '▲ Show less' : `▼ Show all ${weaknesses.length} words`}
            </button>
          )}
        </div>
      )}

      {/* Practice link */}
      <div style={{ marginTop: 16, textAlign: 'center' }}>
        <Link
          to="/pronunciation"
          style={{
            color: 'var(--accent)',
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Practice Pronunciation →
        </Link>
      </div>
    </div>
  );
}
