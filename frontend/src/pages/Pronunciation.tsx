import { useState, useEffect, useRef } from 'react';
import { Volume2, MicOff, RotateCcw, ChevronRight, ChevronDown, History, Mic, Play, Keyboard } from 'lucide-react';
import { api, type PronunciationFeedback, type PronunciationAttempt, type PronunciationProgress, type DictationResult, type MinimalPairItem, checkDictation } from '../api';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
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
  const [expandedAttemptId, setExpandedAttemptId] = useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [difficultyFilter, setDifficultyFilter] = useState<'all' | 'beginner' | 'intermediate' | 'advanced'>('all');
  const [practiceMode, setPracticeMode] = useState<'shadowing' | 'dictation' | 'minimal-pairs' | 'tongue-twisters'>('shadowing');
  const [dictationText, setDictationText] = useState('');
  const [dictationResult, setDictationResult] = useState<DictationResult | null>(null);
  const [dictationPlayed, setDictationPlayed] = useState(false);

  const [mpPairs, setMpPairs] = useState<MinimalPairItem[]>([]);
  const [mpIndex, setMpIndex] = useState(0);
  const [mpAnswer, setMpAnswer] = useState<string | null>(null);
  const [mpRevealed, setMpRevealed] = useState(false);
  const [mpResults, setMpResults] = useState<boolean[]>([]);
  const [mpFinished, setMpFinished] = useState(false);
  const [mpLoading, setMpLoading] = useState(false);

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
  const [ttIndex, setTtIndex] = useState(0);
  const [ttSpeedTier, setTtSpeedTier] = useState(0);
  const [ttScores, setTtScores] = useState<(number | null)[]>([null, null, null]);
  const [ttStarted, setTtStarted] = useState(false);
  const [ttFinished, setTtFinished] = useState(false);
  const [ttDifficulty, setTtDifficulty] = useState<'all' | 'beginner' | 'intermediate' | 'advanced'>('all');
  const ttFiltered = TONGUE_TWISTERS.filter(t => ttDifficulty === 'all' || t.difficulty === ttDifficulty);

  const speech = useSpeechRecognition();
  const tts = useSpeechSynthesis();
  const recorder = useAudioRecorder();
  const userAudioRef = useRef<HTMLAudioElement | null>(null);
  const [comparePlaying, setComparePlaying] = useState(false);

  // Auto-start recording when TTS finishes (shadowing flow)
  useEffect(() => {
    if (shadowingState === 'listening' && !tts.isSpeaking) {
      // TTS finished → auto-start recording after brief pause
      const timer = setTimeout(() => {
        speech.start();
        recorder.startRecording();
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
    recorder.reset();
    setComparePlaying(false);
    setShadowingState('idle');
    setDictationText('');
    setDictationResult(null);
    setDictationPlayed(false);
    setPhase('practice');
  };

  const checkPronunciation = async () => {
    if (!speech.transcript.trim()) return;

    speech.stop();
    recorder.stopRecording();
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
    recorder.reset();
    setFeedback(null);
    setShadowingState('idle');
    setComparePlaying(false);
    setDictationText('');
    setDictationResult(null);
    setDictationPlayed(false);
    setPhase('practice');
  };

  const submitDictation = async () => {
    if (!dictationText.trim()) return;
    setLoading(true);
    try {
      const res = await checkDictation(selectedSentence, dictationText);
      setDictationResult(res);
      setPhase('result');
    } catch (err) {
      console.error(err);
      alert('Failed to check dictation. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
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
            {historyData.map((a) => (
              <div
                key={a.id}
                className="card"
                style={{ padding: '12px 16px', cursor: a.feedback?.word_feedback ? 'pointer' : 'default' }}
                onClick={() => a.feedback?.word_feedback && setExpandedAttemptId(expandedAttemptId === a.id ? null : a.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                    {a.feedback?.word_feedback && (
                      expandedAttemptId === a.id
                        ? <ChevronDown size={14} color="var(--text-secondary)" />
                        : <ChevronRight size={14} color="var(--text-secondary)" />
                    )}
                    <span style={{ fontSize: 14 }}>{a.reference_text.slice(0, 60)}{a.reference_text.length > 60 ? '...' : ''}</span>
                  </div>
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

                {expandedAttemptId === a.id && a.feedback?.word_feedback && (() => {
                  const wf = a.feedback!.word_feedback;
                  const total = wf.length;
                  const correct = wf.filter((w) => w.is_correct).length;
                  const partial = wf.filter((w) => !w.is_correct && w.heard !== 'missing').length;
                  const incorrect = total - correct - partial;
                  return (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                      {a.user_transcription && (
                        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
                          <strong>You said:</strong> "{a.user_transcription}"
                        </p>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                        <span style={{ color: '#22c55e' }}>✓ {correct}</span>
                        <span style={{ color: '#f59e0b' }}>~ {partial}</span>
                        <span style={{ color: '#ef4444' }}>✗ {incorrect}</span>
                      </div>
                      <div className="accuracy-bar" role="img" aria-label={`Accuracy: ${correct} correct, ${partial} partial, ${incorrect} incorrect out of ${total} words`}>
                        {correct > 0 && <div className="accuracy-segment correct" style={{ width: `${(correct / total) * 100}%` }} />}
                        {partial > 0 && <div className="accuracy-segment partial" style={{ width: `${(partial / total) * 100}%` }} />}
                        {incorrect > 0 && <div className="accuracy-segment incorrect" style={{ width: `${(incorrect / total) * 100}%` }} />}
                      </div>

                      <div className="word-comparison" style={{ marginTop: 8 }}>
                        {wf.map((w, j) => {
                          const chipClass = w.is_correct ? 'word-correct' : (w.heard !== 'missing' ? 'word-partial' : 'word-incorrect');
                          return (
                            <div key={j} className={`word-chip ${chipClass}`} title={w.tip || 'Correct!'}>
                              {w.expected}
                              {!w.is_correct && w.heard !== 'missing' && (
                                <span style={{ fontSize: 11, display: 'block' }}>→ "{w.heard}"</span>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {wf.some((w) => !w.is_correct && w.tip) && (
                        <div style={{ marginTop: 8 }}>
                          {wf.filter((w) => !w.is_correct && w.tip).map((w, j) => (
                            <p key={j} style={{ fontSize: 12, marginBottom: 2, color: 'var(--text-secondary)' }}>
                              • <strong>{w.expected}:</strong> {w.tip}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
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

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            className={`btn ${practiceMode === 'shadowing' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setPracticeMode('shadowing')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Mic size={16} /> Shadowing
          </button>
          <button
            className={`btn ${practiceMode === 'dictation' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setPracticeMode('dictation')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Keyboard size={16} /> Dictation
          </button>
          <button
            className={`btn ${practiceMode === 'minimal-pairs' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setPracticeMode('minimal-pairs')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            👂 Minimal Pairs
          </button>
          <button
            className={`btn ${practiceMode === 'tongue-twisters' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => { setPracticeMode('tongue-twisters'); setTtStarted(false); setTtFinished(false); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            🌀 Tongue Twisters
          </button>
        </div>

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

        {practiceMode === 'minimal-pairs' ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
              Listen to a word and choose which one you heard. Train your ear to distinguish similar English sounds.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
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
            <button
              className="btn btn-primary"
              disabled={mpLoading}
              onClick={async () => {
                setMpLoading(true);
                try {
                  const diff = difficultyFilter === 'all' ? undefined : difficultyFilter;
                  const res = await api.getMinimalPairs(diff, 10);
                  setMpPairs(res.pairs);
                  setMpIndex(0);
                  setMpAnswer(null);
                  setMpRevealed(false);
                  setMpResults([]);
                  setMpFinished(false);
                  setPhase('practice');
                } catch (err) {
                  console.error('Failed to load minimal pairs:', err);
                } finally {
                  setMpLoading(false);
                }
              }}
              style={{ padding: '10px 32px', fontSize: 16 }}
            >
              {mpLoading ? 'Loading…' : '🎧 Start Exercise'}
            </button>
          </div>
        ) : practiceMode === 'tongue-twisters' ? (
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
        ) : (
          <>
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
          </>
        )}
      </div>
    );
  }

  // Practice phase
  if (phase === 'practice') {
    if (practiceMode === 'minimal-pairs' && mpPairs.length > 0) {
      if (mpFinished) {
        const correct = mpResults.filter(Boolean).length;
        return (
          <div className="card" style={{ textAlign: 'center' }}>
            <h3 style={{ marginBottom: 16 }}>Minimal Pairs Results</h3>
            <div style={{ fontSize: 48, fontWeight: 700, color: 'var(--primary)', marginBottom: 8 }}>
              {correct}/{mpResults.length}
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>correct answers</p>

            {mpPairs.filter((_, i) => !mpResults[i]).length > 0 && (
              <div style={{ textAlign: 'left', marginBottom: 24 }}>
                <h4 style={{ marginBottom: 8 }}>Review missed pairs:</h4>
                {mpPairs.filter((_, i) => !mpResults[i]).map((pair, i) => (
                  <div key={i} style={{ padding: 10, marginBottom: 8, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>{pair.word_a}</span>
                      <span style={{ color: 'var(--text-secondary)', margin: '0 8px' }}>vs</span>
                      <span style={{ fontWeight: 600 }}>{pair.word_b}</span>
                      <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-secondary)' }}>({pair.phoneme_contrast})</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => tts.speak(pair.word_a)} disabled={tts.isSpeaking} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                        <Volume2 size={16} color="var(--primary)" />
                      </button>
                      <button onClick={() => tts.speak(pair.word_b)} disabled={tts.isSpeaking} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                        <Volume2 size={16} color="var(--primary)" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button className="btn btn-primary" onClick={() => setPhase('select')}>Back to Selection</button>
          </div>
        );
      }

      const currentPair = mpPairs[mpIndex];
      const playedWord = currentPair.play_word === 'a' ? currentPair.word_a : currentPair.word_b;

      return (
        <div className="card" style={{ textAlign: 'center' }}>
          <h3 style={{ marginBottom: 8 }}>Minimal Pairs ({mpIndex + 1}/{mpPairs.length})</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
            Sound contrast: <strong>{currentPair.phoneme_contrast}</strong>
          </p>

          <button
            className="btn btn-primary"
            onClick={() => tts.speak(playedWord)}
            disabled={tts.isSpeaking}
            style={{ marginBottom: 24, padding: '12px 32px', fontSize: 18 }}
          >
            🔊 {tts.isSpeaking ? 'Playing…' : 'Play Sound'}
          </button>

          <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 16 }}>Which word did you hear?</p>

          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 16 }}>
            {['a', 'b'].map((choice) => {
              const word = choice === 'a' ? currentPair.word_a : currentPair.word_b;
              const isSelected = mpAnswer === choice;
              const isCorrect = choice === currentPair.play_word;
              let bg = 'var(--card-bg, #fff)';
              let border = '2px solid var(--border, #e5e7eb)';
              if (mpRevealed) {
                if (isCorrect) { bg = '#dcfce7'; border = '2px solid var(--success, #22c55e)'; }
                else if (isSelected && !isCorrect) { bg = '#fee2e2'; border = '2px solid var(--danger, #ef4444)'; }
              }
              return (
                <button
                  key={choice}
                  onClick={() => {
                    if (mpRevealed) return;
                    setMpAnswer(choice);
                    setMpRevealed(true);
                    setMpResults((prev) => [...prev, choice === currentPair.play_word]);
                  }}
                  disabled={mpRevealed}
                  style={{ padding: '16px 32px', fontSize: 20, fontWeight: 600, background: bg, border, borderRadius: 8, cursor: mpRevealed ? 'default' : 'pointer', minWidth: 120 }}
                >
                  {word}
                </button>
              );
            })}
          </div>

          {mpRevealed && (
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontWeight: 600, marginBottom: 8 }}>
                {mpAnswer === currentPair.play_word ? '✅ Correct!' : `❌ The word was "${playedWord}"`}
              </p>
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 12 }}>
                <button onClick={() => tts.speak(currentPair.word_a)} disabled={tts.isSpeaking} className="btn btn-secondary" style={{ fontSize: 13 }}>
                  🔊 {currentPair.word_a}
                </button>
                <button onClick={() => tts.speak(currentPair.word_b)} disabled={tts.isSpeaking} className="btn btn-secondary" style={{ fontSize: 13 }}>
                  🔊 {currentPair.word_b}
                </button>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                <em>"{currentPair.example_a}"</em><br />
                <em>"{currentPair.example_b}"</em>
              </p>
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (mpIndex < mpPairs.length - 1) {
                    setMpIndex((i) => i + 1);
                    setMpAnswer(null);
                    setMpRevealed(false);
                  } else {
                    setMpFinished(true);
                  }
                }}
                style={{ marginTop: 12 }}
              >
                {mpIndex < mpPairs.length - 1 ? 'Next Pair →' : 'See Results'}
              </button>
            </div>
          )}
        </div>
      );
    }

    if (practiceMode === 'tongue-twisters' && ttStarted && ttFiltered.length > 0) {
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
                <button className="btn btn-primary" onClick={() => { setPhase('select'); setTtStarted(false); }}>
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

    if (practiceMode === 'dictation') {
      return (
        <div className="card">
          <h3 style={{ marginBottom: 16, textAlign: 'center' }}>Dictation Practice</h3>

          <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 14, marginBottom: 16 }}>
            Listen to the sentence, then type what you hear.
          </p>

          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <button
              className="btn btn-primary"
              onClick={() => { tts.speak(selectedSentence); setDictationPlayed(true); }}
              disabled={tts.isSpeaking}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Volume2 size={18} /> {dictationPlayed ? 'Play Again' : 'Play Sentence'}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 16 }}>
            <Volume2 size={16} color="var(--text-secondary)" />
            <input
              type="range" min={0} max={1} step={0.05}
              value={tts.volume}
              onChange={(e) => tts.setVolume(parseFloat(e.target.value))}
              style={{ width: 120, accentColor: 'var(--primary)' }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 36, textAlign: 'right' }}>
              {Math.round(tts.volume * 100)}%
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 8 }} role="group" aria-label="Speech speed">
              {([
                { label: '🐢', value: 0.7 },
                { label: '1×', value: 0.9 },
                { label: '🐇', value: 1.2 },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => tts.setRate(opt.value)}
                  aria-label={`Speed ${opt.label}`}
                  aria-pressed={tts.rate === opt.value}
                  style={{
                    padding: '2px 6px',
                    fontSize: 12,
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    background: tts.rate === opt.value ? 'var(--primary)' : 'transparent',
                    color: tts.rate === opt.value ? '#fff' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    lineHeight: 1.2,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {dictationPlayed && (
            <textarea
              value={dictationText}
              onChange={(e) => setDictationText(e.target.value)}
              placeholder="Type what you heard..."
              rows={3}
              style={{
                width: '100%', padding: '12px', fontSize: 16, borderRadius: 8,
                border: '1px solid var(--border)', resize: 'vertical',
                fontFamily: 'inherit', marginBottom: 16, boxSizing: 'border-box',
              }}
              autoFocus
            />
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="btn btn-secondary" onClick={() => setPhase('select')}>Back</button>
            {dictationText.trim() && (
              <button className="btn btn-primary" onClick={submitDictation} disabled={loading}>
                {loading ? (
                  <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2, margin: 0 }} /> Checking...</>
                ) : 'Check Dictation'}
              </button>
            )}
          </div>
        </div>
      );
    }

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
                recorder.stopRecording();
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 8 }} role="group" aria-label="Speech speed">
            {([
              { label: '🐢', value: 0.7 },
              { label: '1×', value: 0.9 },
              { label: '🐇', value: 1.2 },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                onClick={() => tts.setRate(opt.value)}
                aria-label={`Speed ${opt.label}`}
                aria-pressed={tts.rate === opt.value}
                style={{
                  padding: '2px 6px',
                  fontSize: 12,
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  background: tts.rate === opt.value ? 'var(--primary)' : 'transparent',
                  color: tts.rate === opt.value ? '#fff' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  lineHeight: 1.2,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
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
  if (phase === 'result' && (feedback || dictationResult)) {
    // Dictation result
    if (dictationResult) {
      const dScoreClass = dictationResult.score >= 8 ? 'score-high' : dictationResult.score >= 5 ? 'score-mid' : 'score-low';
      return (
        <div className="card">
          <h3 style={{ textAlign: 'center', marginBottom: 16 }}>Dictation Result</h3>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 32, marginBottom: 16 }}>
            <div style={{ textAlign: 'center' }}>
              <div className={`score-circle ${dScoreClass}`}>{dictationResult.score}</div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>Score</p>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--primary)' }}>
                {dictationResult.correct_words}/{dictationResult.total_words}
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>Words Correct</p>
            </div>
          </div>

          <div style={{ marginBottom: 16, padding: '12px', background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8 }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Reference:</p>
            <p style={{ fontSize: 15, fontWeight: 500 }}>{selectedSentence}</p>
          </div>

          <h4 style={{ marginBottom: 8 }}>Word-by-Word Comparison</h4>
          <div className="word-comparison">
            {dictationResult.word_results.map((w, i) => {
              const chipClass = w.is_correct ? 'word-correct' : 'word-incorrect';
              return (
                <div key={i} className={`word-chip ${chipClass}`}>
                  {w.expected || '(extra)'}
                  {!w.is_correct && w.typed && (
                    <span style={{ fontSize: 11, display: 'block' }}>→ "{w.typed}"</span>
                  )}
                  {!w.is_correct && !w.typed && (
                    <span style={{ fontSize: 11, display: 'block', color: '#999' }}>(missed)</span>
                  )}
                </div>
              );
            })}
          </div>

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

    // Shadowing result (existing)
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

        {(() => {
          const total = feedback.word_feedback.length;
          const correct = feedback.word_feedback.filter((w) => w.is_correct).length;
          const partial = feedback.word_feedback.filter((w) => !w.is_correct && w.heard !== 'missing').length;
          const incorrect = total - correct - partial;
          return (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                <span style={{ color: '#22c55e' }}>✓ {correct}</span>
                <span style={{ color: '#f59e0b' }}>~ {partial}</span>
                <span style={{ color: '#ef4444' }}>✗ {incorrect}</span>
              </div>
              <div className="accuracy-bar" role="img" aria-label={`Accuracy: ${correct} correct, ${partial} partial, ${incorrect} incorrect out of ${total} words`}>
                {correct > 0 && <div className="accuracy-segment correct" style={{ width: `${(correct / total) * 100}%` }} />}
                {partial > 0 && <div className="accuracy-segment partial" style={{ width: `${(partial / total) * 100}%` }} />}
                {incorrect > 0 && <div className="accuracy-segment incorrect" style={{ width: `${(incorrect / total) * 100}%` }} />}
              </div>
            </>
          );
        })()}

        <h4 style={{ marginBottom: 8 }}>Word-by-Word Analysis</h4>
        <div className="word-comparison">
          {feedback.word_feedback.map((w, i) => {
            const chipClass = w.is_correct ? 'word-correct' : (w.heard !== 'missing' ? 'word-partial' : 'word-incorrect');
            return (
              <div key={i} className={`word-chip ${chipClass}`} title={w.tip || 'Correct!'}>
                {w.expected}
                {!w.is_correct && w.heard !== 'missing' && (
                  <span style={{ fontSize: 11, display: 'block' }}>→ "{w.heard}"</span>
                )}
                {!w.is_correct && w.phoneme_issues && w.phoneme_issues.length > 0 && (
                  <div>
                    {w.phoneme_issues.map((p, j) => (
                      <span key={j} className="phoneme-badge">
                        {p.target && p.produced ? `${p.target}→${p.produced}` : p.tip || '?'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
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

        {/* Comparison Playback */}
        <div style={{ marginTop: 20, padding: '1rem', background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8 }}>
          <h4 style={{ marginBottom: 10, fontSize: '0.9rem' }}>🎧 Comparison Playback</h4>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              className="btn btn-secondary"
              onClick={() => tts.speak(selectedSentence)}
              disabled={tts.isSpeaking || comparePlaying}
              style={{ fontSize: '0.85rem' }}
            >
              <Volume2 size={16} /> Model
            </button>
            {recorder.audioUrl && (
              <button
                className="btn btn-secondary"
                onClick={() => {
                  if (userAudioRef.current) {
                    userAudioRef.current.pause();
                    userAudioRef.current.currentTime = 0;
                  }
                  const audio = new Audio(recorder.audioUrl!);
                  userAudioRef.current = audio;
                  audio.play();
                }}
                disabled={comparePlaying}
                style={{ fontSize: '0.85rem' }}
              >
                <Mic size={16} /> Your Recording
              </button>
            )}
            {recorder.audioUrl && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  setComparePlaying(true);
                  tts.speak(selectedSentence);
                  // Poll native API (not React state) to avoid stale closure
                  const checkTts = setInterval(() => {
                    if (!window.speechSynthesis.speaking) {
                      clearInterval(checkTts);
                      setTimeout(() => {
                        const audio = new Audio(recorder.audioUrl!);
                        userAudioRef.current = audio;
                        audio.onended = () => setComparePlaying(false);
                        audio.play();
                      }, 500);
                    }
                  }, 100);
                }}
                disabled={tts.isSpeaking || comparePlaying}
                style={{ fontSize: '0.85rem' }}
              >
                <Play size={16} /> Compare
              </button>
            )}
          </div>
          {!recorder.audioUrl && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center', marginTop: 8 }}>
              Audio recording not available — try again with microphone permission
            </p>
          )}
        </div>

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
