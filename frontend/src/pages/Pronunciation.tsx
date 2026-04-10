import { useState, useEffect, useRef } from 'react';
import { Volume2, MicOff, RotateCcw, ChevronRight, History, Mic, Play, Keyboard } from 'lucide-react';
import { api, type PronunciationFeedback, type PronunciationAttempt, type PronunciationProgress, type DictationResult, checkDictation } from '../api';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import AudioWaveform from '../components/AudioWaveform';
import { MinimalPairsExercise, QuickSpeakExercise, ResponseDrill, SentenceExpandDrill, TongueTwisterDrill, PronunciationHistory, RecordingHistory } from '../components/pronunciation';
import { useRecordingStorage } from '../hooks/useRecordingStorage';

const SAMPLE_SENTENCES = [
  { text: "I'd like to check in, please. I have a reservation under Smith.", topic: 'hotel', difficulty: 'intermediate' },
  { text: "Could I see the menu, please? Do you have any specials today?", topic: 'restaurant', difficulty: 'intermediate' },
  { text: "I have three years of experience in software development.", topic: 'interview', difficulty: 'beginner' },
  { text: "I've been having a headache for the past two days.", topic: 'medical', difficulty: 'beginner' },
  { text: "Do you have this in a medium? I'd like to try it on.", topic: 'shopping', difficulty: 'intermediate' },
  { text: "What gate does the flight to London depart from?", topic: 'airport', difficulty: 'beginner' },
];

export default function Pronunciation() {
  const [phase, setPhase] = useState<'select' | 'practice' | 'result' | 'history' | 'recordings'>('select');
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
  const [practiceMode, setPracticeMode] = useState<'shadowing' | 'dictation' | 'minimal-pairs' | 'tongue-twisters' | 'quick-speak' | 'response-drill' | 'sentence-expand'>('shadowing');
  const [dictationText, setDictationText] = useState('');
  const [dictationResult, setDictationResult] = useState<DictationResult | null>(null);
  const [dictationPlayed, setDictationPlayed] = useState(false);

  const speech = useSpeechRecognition();
  const tts = useSpeechSynthesis();
  const recorder = useAudioRecorder();
  const recordingStorage = useRecordingStorage();
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
      // Save recording to IndexedDB if blob is available
      if (recorder.audioBlob) {
        recordingStorage.saveRecording(
          recorder.audioBlob, selectedSentence, res.overall_score ?? null, selectedDifficulty ?? 'intermediate',
        ).catch(err => console.error('Failed to save recording:', err));
      }
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
      <PronunciationHistory
        historyData={historyData}
        progressData={progressData}
        onBack={() => setPhase('select')}
      />
    );
  }

  if (phase === 'recordings') {
    return <RecordingHistory onBack={() => setPhase('select')} />;
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
            onClick={() => { setPracticeMode('tongue-twisters'); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            🌀 Tongue Twisters
          </button>
          <button
            className={`btn ${practiceMode === 'quick-speak' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setPracticeMode('quick-speak')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            🗣️ Quick Speak
          </button>
          <button
            className={`btn ${practiceMode === 'response-drill' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setPracticeMode('response-drill')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            💬 Response Drill
          </button>
          <button
            className={`btn ${practiceMode === 'sentence-expand' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setPracticeMode('sentence-expand')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            📝 Expand
          </button>
        </div>

        <div style={{ marginBottom: 16, textAlign: 'right', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            className="btn btn-secondary"
            onClick={() => setPhase('recordings')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Mic size={16} /> My Recordings
          </button>
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
          <MinimalPairsExercise
            tts={tts}
            difficultyFilter={difficultyFilter}
            setDifficultyFilter={setDifficultyFilter}
            onBack={() => setPhase('select')}
          />
        ) : practiceMode === 'tongue-twisters' ? (
          <TongueTwisterDrill
            speech={speech}
            tts={tts}
            onBack={() => setPhase('select')}
          />
        ) : practiceMode === 'quick-speak' ? (
          <QuickSpeakExercise speechRecognition={speech} />
        ) : practiceMode === 'response-drill' ? (
          <ResponseDrill speechRecognition={speech} />
        ) : practiceMode === 'sentence-expand' ? (
          <SentenceExpandDrill speechRecognition={speech} />
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
    if (practiceMode === 'minimal-pairs') {
      return (
        <MinimalPairsExercise
          tts={tts}
          difficultyFilter={difficultyFilter}
          setDifficultyFilter={setDifficultyFilter}
          onBack={() => setPhase('select')}
        />
      );
    }

    if (practiceMode === 'tongue-twisters') {
      return (
        <TongueTwisterDrill
          speech={speech}
          tts={tts}
          onBack={() => setPhase('select')}
        />
      );
    }

    if (practiceMode === 'quick-speak') {
      return <QuickSpeakExercise speechRecognition={speech} />;
    }

    if (practiceMode === 'response-drill') {
      return <ResponseDrill speechRecognition={speech} />;
    }

    if (practiceMode === 'sentence-expand') {
      return <SentenceExpandDrill speechRecognition={speech} />;
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

          {shadowingState === 'recording' && (
            <div style={{ marginTop: 12 }}>
              <AudioWaveform analyser={recorder.analyserNode} isActive={recorder.isRecording} />
            </div>
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
    if (!feedback) return null;
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
