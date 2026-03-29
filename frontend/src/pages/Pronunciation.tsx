import { useState, useEffect } from 'react';
import { Volume2, MicOff, RotateCcw, ChevronRight } from 'lucide-react';
import { api, type PronunciationFeedback } from '../api';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';

const SAMPLE_SENTENCES = [
  { text: "I'd like to check in, please. I have a reservation under Smith.", topic: 'hotel' },
  { text: "Could I see the menu, please? Do you have any specials today?", topic: 'restaurant' },
  { text: "I have three years of experience in software development.", topic: 'interview' },
  { text: "I've been having a headache for the past two days.", topic: 'medical' },
  { text: "Do you have this in a medium? I'd like to try it on.", topic: 'shopping' },
  { text: "What gate does the flight to London depart from?", topic: 'airport' },
];

export default function Pronunciation() {
  const [phase, setPhase] = useState<'select' | 'practice' | 'result'>('select');
  const [sentences, setSentences] = useState(SAMPLE_SENTENCES);
  const [selectedSentence, setSelectedSentence] = useState<string>('');
  const [feedback, setFeedback] = useState<PronunciationFeedback | null>(null);
  const [loading, setLoading] = useState(false);
  const [shadowingState, setShadowingState] = useState<'idle' | 'listening' | 'recording' | 'done'>('idle');

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

  const startPractice = (text: string) => {
    setSelectedSentence(text);
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
      const res = await api.checkPronunciation(selectedSentence, speech.transcript);
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

  // Sentence selection
  if (phase === 'select') {
    return (
      <div>
        <h2 style={{ marginBottom: 8 }}>Pronunciation Practice</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
          Shadowing: Listen to a sentence, then repeat it immediately. The app will auto-record after playback.
        </p>

        <div className="sentence-list">
          {sentences.map((s, i) => (
            <div
              key={i}
              className="sentence-item"
              onClick={() => startPractice(s.text)}
            >
              <p>{s.text}</p>
              <span className="topic-badge">{s.topic}</span>
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
            >
              <MicOff size={18} /> Stop Recording
            </button>
          )}

          {shadowingState !== 'idle' && shadowingState !== 'recording' && (
            <button
              className="btn btn-secondary"
              onClick={() => tts.speak(selectedSentence)}
              disabled={tts.isSpeaking}
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
    const scoreClass = feedback.overall_score >= 8 ? 'score-high' : feedback.overall_score >= 5 ? 'score-mid' : 'score-low';

    return (
      <div className="card">
        <h3 style={{ textAlign: 'center', marginBottom: 16 }}>Pronunciation Result</h3>

        <div className={`score-circle ${scoreClass}`}>
          {feedback.overall_score}
        </div>

        <p style={{ textAlign: 'center', marginBottom: 24, color: 'var(--text-secondary)' }}>
          {feedback.overall_feedback}
        </p>

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
