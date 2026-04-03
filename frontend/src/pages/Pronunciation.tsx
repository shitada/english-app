import { useState, useEffect } from 'react';
import { Volume2, MicOff, RotateCcw, ChevronRight, History } from 'lucide-react';
import { api, type PronunciationFeedback, type PronunciationAttempt, type PronunciationProgress } from '../api';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { formatDateTime } from '../utils/formatDate';

const SAMPLE_SENTENCES = [
  { text: "I'd like to check in, please. I have a reservation under Smith.", topic: 'hotel', difficulty: 'intermediate' },
  { text: "Could I see the menu, please? Do you have any specials today?", topic: 'restaurant', difficulty: 'intermediate' },
  { text: "I have three years of experience in software development.", topic: 'interview', difficulty: 'beginner' },
  { text: "I've been having a headache for the past two days.", topic: 'medical', difficulty: 'beginner' },
  { text: "Do you have this in a medium? I'd like to try it on.", topic: 'shopping', difficulty: 'intermediate' },
  { text: "What gate does the flight to London depart from?", topic: 'airport', difficulty: 'beginner' },
];

export default function Pronunciation() {
  const [phase, setPhase] = useState<'select' | 'practice' | 'result' | 'history'>('select');
  const [sentences, setSentences] = useState(SAMPLE_SENTENCES);
  const [selectedSentence, setSelectedSentence] = useState<string>('');
  const [selectedDifficulty, setSelectedDifficulty] = useState<string | undefined>(undefined);
  const [feedback, setFeedback] = useState<PronunciationFeedback | null>(null);
  const [loading, setLoading] = useState(false);
  const [shadowingState, setShadowingState] = useState<'idle' | 'listening' | 'recording' | 'done'>('idle');
  const [historyData, setHistoryData] = useState<PronunciationAttempt[]>([]);
  const [progressData, setProgressData] = useState<PronunciationProgress | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [difficultyFilter, setDifficultyFilter] = useState<'all' | 'beginner' | 'intermediate' | 'advanced'>('all');

  const speech = useSpeechRecognition();
  const tts = useSpeechSynthesis();

  // Auto-start recording when TTS finishes (shadowing flow)
  useEffect(() => {
    if (shadowingState === 'listening' && !tts.isSpeaking) {
      // TTS finished → auto-start recording after brief pause
      const timer = setTimeout(() => {
        speech.start();
        setShadowingState('recording');
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [shadowingState, tts.isSpeaking]);

  // Load sentences from conversations if available
  useEffect(() => {
    api.getPronunciationSentences().then((res) => {
      if (res.sentences.length > 0) {
        setSentences([...res.sentences, ...SAMPLE_SENTENCES]);
      }
    }).catch(() => {
      // Use sample sentences if API fails
    });
  }, []);

  const filteredSentences = difficultyFilter === 'all'
    ? sentences
    : sentences.filter(s => s.difficulty === difficultyFilter);

  const startPractice = (text: string) => {
    setSelectedSentence(text);
    const sentence = sentences.find(s => s.text === text);
    setSelectedDifficulty(sentence?.difficulty);
    setFeedback(null);
    speech.reset();
    setShadowingState('idle');
    setPhase('practice');
  };

  const checkPronunciation = async () => {
    if (!speech.transcript.trim()) return;

    speech.stop();
    setShadowingState('done');
    setLoading(true);
    try {
      const res = await api.checkPronunciation(selectedSentence, speech.transcript, selectedDifficulty);
      setFeedback(res);
      setPhase('result');
    } catch (err) {
      console.error(err);
      alert('Failed to check pronunciation. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const retry = () => {
    speech.reset();
    setFeedback(null);
    setShadowingState('idle');
    setPhase('practice');
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const [hist, prog] = await Promise.all([
        api.getPronunciationHistory(),
        api.getPronunciationProgress(),
      ]);
      setHistoryData(hist.attempts);
      setProgressData(prog);
      setPhase('history');
    } catch {
      // fallback
    } finally {
      setHistoryLoading(false);
    }
  };

  // History phase
  if (phase === 'history') {
    return (
      <div>
        <button
          onClick={() => setPhase('select')}
          style={{ marginBottom: 16, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: 'var(--text)' }}
        >
          ← Back to sentences
        </button>
        <h2 style={{ marginBottom: 16 }}>Pronunciation History</h2>

        {progressData && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 32, marginBottom: 16 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--primary)' }}>{progressData.total_attempts}</div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Attempts</p>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div className={`score-circle ${progressData.avg_score >= 8 ? 'score-high' : progressData.avg_score >= 5 ? 'score-mid' : 'score-low'}`} style={{ margin: '0 auto' }}>
                  {progressData.avg_score}
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>Avg Score</p>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div className={`score-circle ${progressData.best_score >= 8 ? 'score-high' : progressData.best_score >= 5 ? 'score-mid' : 'score-low'}`} style={{ margin: '0 auto' }}>
                  {progressData.best_score}
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>Best</p>
              </div>
            </div>

            {progressData.most_practiced.length > 0 && (
              <div>
                <h4 style={{ marginBottom: 8 }}>Most Practiced</h4>
                {progressData.most_practiced.map((mp, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 14, flex: 1 }}>{mp.text.slice(0, 50)}{mp.text.length > 50 ? '...' : ''}</span>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 8 }}>
                      {mp.attempt_count}× · avg {mp.avg_score}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {historyData.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>No attempts yet. Start practicing!</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {historyData.map((a, i) => (
              <div key={i} className="card" style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 14, flex: 1 }}>{a.reference_text.slice(0, 60)}{a.reference_text.length > 60 ? '...' : ''}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {a.score != null && (
                      <span style={{
                        padding: '2px 8px', borderRadius: 12, fontSize: 13, fontWeight: 600,
                        background: a.score >= 8 ? '#dcfce7' : a.score >= 5 ? '#fef9c3' : '#fee2e2',
                        color: a.score >= 8 ? '#15803d' : a.score >= 5 ? '#a16207' : '#b91c1c',
                      }}>
                        {a.score}/10
                      </span>
                    )}
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{formatDateTime(a.created_at)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Sentence selection
  if (phase === 'select') {
    return (
      <div>
        <h2 style={{ marginBottom: 8 }}>Pronunciation Practice</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
          Shadowing: Listen to a sentence, then repeat it immediately. The app will auto-record after playback.
        </p>

        <div style={{ marginBottom: 16, textAlign: 'right' }}>
          <button
            className="btn btn-secondary"
            onClick={loadHistory}
            disabled={historyLoading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <History size={16} /> {historyLoading ? 'Loading...' : 'View History'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {(['all', 'beginner', 'intermediate', 'advanced'] as const).map((level) => (
            <button
              key={level}
              className={`btn ${difficultyFilter === level ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDifficultyFilter(level)}
              style={{ fontSize: 13, padding: '4px 12px' }}
            >
              {level === 'all' ? 'All' : level === 'beginner' ? '🌱 Beginner' : level === 'intermediate' ? '📗 Intermediate' : '🚀 Advanced'}
            </button>
          ))}
        </div>

        <div className="sentence-list">
          {filteredSentences.map((s, i) => (
            <div
              key={i}
              className="sentence-item"
              onClick={() => startPractice(s.text)}
            >
              <p>{s.text}</p>
              <span className="topic-badge">{s.topic}</span>
              <span className="topic-badge" style={{ marginLeft: 4, opacity: 0.7 }}>{s.difficulty}</span>
              <ChevronRight size={16} color="var(--text-secondary)" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Practice phase
  if (phase === 'practice') {
    return (
      <div className="card">
        <h3 style={{ marginBottom: 16, textAlign: 'center' }}>Shadowing Practice</h3>

        <div className="sentence-display">{selectedSentence}</div>

        {speech.error && (
          <div style={{ padding: '8px 16px', marginBottom: 12, background: '#fef2f2', color: '#b91c1c', fontSize: 13, borderRadius: 8, textAlign: 'center' }}>
            {speech.error}
          </div>
        )}

        {/* Shadowing status indicator */}
        <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 14, color: 'var(--text-secondary)' }}>
          {shadowingState === 'idle' && '▶ Press "Start Shadowing" to begin'}
          {shadowingState === 'listening' && '🔊 Listening to model pronunciation...'}
          {shadowingState === 'recording' && '🎙️ Now repeat the sentence!'}
          {shadowingState === 'done' && '✅ Recording complete. Check your result!'}
        </div>

        <div className="pronunciation-actions">
          {shadowingState === 'idle' && (
            <button
              className="btn btn-primary"
              onClick={() => {
                speech.reset();
                setShadowingState('listening');
                tts.speak(selectedSentence);
              }}
              disabled={tts.isSpeaking}
              aria-label="Start shadowing practice"
            >
              <Volume2 size={18} /> Start Shadowing
            </button>
          )}

          {shadowingState === 'recording' && (
            <button
              className="btn btn-danger"
              onClick={() => {
                speech.stop();
                setShadowingState('done');
              }}
              aria-label="Stop recording"
            >
              <MicOff size={18} /> Stop Recording
            </button>
          )}

          {shadowingState !== 'idle' && shadowingState !== 'recording' && (
            <button
              className="btn btn-secondary"
              onClick={() => tts.speak(selectedSentence)}
              disabled={tts.isSpeaking}
              aria-label="Listen to sentence again"
            >
              <Volume2 size={18} /> Listen Again
            </button>
          )}

          {shadowingState === 'done' && !speech.transcript && (
            <button
              className="btn btn-primary"
              onClick={() => {
                speech.reset();
                setShadowingState('listening');
                tts.speak(selectedSentence);
              }}
            >
              <RotateCcw size={16} /> Try Again
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 16 }}>
          <Volume2 size={16} color="var(--text-secondary)" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={tts.volume}
            onChange={(e) => tts.setVolume(parseFloat(e.target.value))}
            style={{ width: 120, accentColor: 'var(--primary)' }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 36, textAlign: 'right' }}>
            {Math.round(tts.volume * 100)}%
          </span>
        </div>

        {(speech.transcript || speech.interimTranscript) && (
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 4 }}>
              What we heard:
            </p>
            <p style={{ fontSize: 18 }}>
              {speech.transcript}
              <span style={{ color: 'var(--text-secondary)' }}>{speech.interimTranscript}</span>
            </p>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button className="btn btn-secondary" onClick={() => setPhase('select')}>
            Back
          </button>
          {speech.transcript && (
            <button
              className="btn btn-primary"
              onClick={checkPronunciation}
              disabled={loading}
            >
              {loading ? (
                <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2, margin: 0 }} /> Checking...</>
              ) : (
                'Check Pronunciation'
              )}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Result phase
  if (phase === 'result' && feedback) {
    const scoreClass = feedback.overall_score != null
      ? (feedback.overall_score >= 8 ? 'score-high' : feedback.overall_score >= 5 ? 'score-mid' : 'score-low')
      : 'score-mid';

    return (
      <div className="card">
        <h3 style={{ textAlign: 'center', marginBottom: 16 }}>Pronunciation Result</h3>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 32, marginBottom: 16 }}>
          <div style={{ textAlign: 'center' }}>
            <div className={`score-circle ${scoreClass}`}>
              {feedback.overall_score != null ? feedback.overall_score : '–'}
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>Accuracy</p>
          </div>
          {feedback.fluency_score != null && (
            <div style={{ textAlign: 'center' }}>
              <div className={`score-circle ${feedback.fluency_score >= 8 ? 'score-high' : feedback.fluency_score >= 5 ? 'score-mid' : 'score-low'}`}>
                {feedback.fluency_score}
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>Fluency</p>
            </div>
          )}
        </div>

        <p style={{ textAlign: 'center', marginBottom: 8, color: 'var(--text-secondary)' }}>
          {feedback.overall_feedback}
        </p>

        {feedback.fluency_feedback && (
          <p style={{ textAlign: 'center', marginBottom: 24, color: 'var(--text-secondary)', fontStyle: 'italic', fontSize: 14 }}>
            {feedback.fluency_feedback}
          </p>
        )}

        <h4 style={{ marginBottom: 8 }}>Word-by-Word Analysis</h4>
        <div className="word-comparison">
          {feedback.word_feedback.map((w, i) => (
            <div
              key={i}
              className={`word-chip ${w.is_correct ? 'word-correct' : 'word-incorrect'}`}
              title={w.tip || 'Correct!'}
            >
              {w.expected}
              {!w.is_correct && w.heard !== 'missing' && (
                <span style={{ fontSize: 11, display: 'block' }}>→ "{w.heard}"</span>
              )}
            </div>
          ))}
        </div>

        {feedback.word_feedback.some((w) => !w.is_correct) && (
          <div style={{ marginTop: 16 }}>
            <h4 style={{ marginBottom: 8 }}>Tips</h4>
            {feedback.word_feedback
              .filter((w) => !w.is_correct && w.tip)
              .map((w, i) => (
                <p key={i} style={{ fontSize: 13, marginBottom: 4, color: 'var(--text-secondary)' }}>
                  • <strong>{w.expected}:</strong> {w.tip}
                </p>
              ))}
          </div>
        )}

        {feedback.focus_areas.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <h4 style={{ marginBottom: 8 }}>Focus Areas</h4>
            <div className="vocab-tags">
              {feedback.focus_areas.map((area, i) => (
                <span key={i}>{area}</span>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 24 }}>
          <button className="btn btn-secondary" onClick={retry}>
            <RotateCcw size={16} /> Try Again
          </button>
          <button className="btn btn-primary" onClick={() => setPhase('select')}>
            Next Sentence
          </button>
        </div>
      </div>
    );
  }

  return null;
}
