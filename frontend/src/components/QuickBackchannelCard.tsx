import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { MessageCircle, Volume2, RefreshCw, Mic, Check, X } from 'lucide-react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

// ─────────────────────────────────────────────────────────────────────────────
// Backchannel prompt bank
//
// Trains learners to produce natural English listener-feedback signals
// ("uh-huh", "really?", "oh no!", "that's great!", etc.) appropriate for
// the speaker's emotional context.
// ─────────────────────────────────────────────────────────────────────────────

export type BackchannelContext =
  | 'good_news'
  | 'bad_news'
  | 'surprise'
  | 'agreement'
  | 'mild_disbelief'
  | 'sympathy';

export interface BackchannelPrompt {
  id: string;
  speaker: string;
  context: BackchannelContext;
  accepted: string[];
}

export const CONTEXT_LABELS: Record<BackchannelContext, { emoji: string; label: string }> = {
  good_news:       { emoji: '🎉', label: 'Good news' },
  bad_news:        { emoji: '😔', label: 'Bad news' },
  surprise:        { emoji: '😮', label: 'Surprise' },
  agreement:       { emoji: '👍', label: 'Agreement' },
  mild_disbelief:  { emoji: '🤨', label: 'Mild disbelief' },
  sympathy:        { emoji: '💚', label: 'Sympathy' },
};

export const BACKCHANNEL_PROMPTS: BackchannelPrompt[] = [
  // Good news
  { id: 'gn1', speaker: 'I just got promoted at work!',           context: 'good_news', accepted: ['Congratulations!', "That's great!", 'Awesome!', 'Nice!'] },
  { id: 'gn2', speaker: 'We are expecting our first baby.',        context: 'good_news', accepted: ['Congratulations!', "That's wonderful!", 'How exciting!', 'Amazing!'] },
  { id: 'gn3', speaker: 'I finally passed my driving test.',       context: 'good_news', accepted: ['Nice!', "That's great!", 'Way to go!', 'Congrats!'] },
  { id: 'gn4', speaker: 'My team won the championship yesterday.', context: 'good_news', accepted: ['Awesome!', "That's amazing!", 'Congrats!', 'Nice one!'] },

  // Bad news
  { id: 'bn1', speaker: 'I lost my wallet on the train this morning.', context: 'bad_news', accepted: ['Oh no!', "That's terrible!", "I'm sorry to hear that.", 'Oh no, really?'] },
  { id: 'bn2', speaker: 'My grandfather passed away last week.',       context: 'bad_news', accepted: ["I'm so sorry.", "That's terrible.", 'Oh no.', 'My condolences.'] },
  { id: 'bn3', speaker: 'I failed the entrance exam.',                  context: 'bad_news', accepted: ["I'm sorry to hear that.", 'Oh no.', "That's tough.", 'That sucks.'] },
  { id: 'bn4', speaker: 'I got laid off from my job.',                  context: 'bad_news', accepted: ["I'm so sorry.", "That's awful.", 'Oh no.', 'That sucks.'] },

  // Surprise
  { id: 'su1', speaker: 'I ran into my old teacher in Paris yesterday.', context: 'surprise', accepted: ['No way!', 'Really?', 'Wow!', 'Seriously?'] },
  { id: 'su2', speaker: 'I just won a free trip to Hawaii.',             context: 'surprise', accepted: ['No way!', 'Wow!', 'Seriously?', 'Are you kidding?'] },
  { id: 'su3', speaker: 'I finished a marathon in under three hours.',   context: 'surprise', accepted: ['Wow!', 'No way!', "That's incredible!", 'Really?'] },
  { id: 'su4', speaker: 'They cancelled the concert at the last minute.', context: 'surprise', accepted: ['Really?', 'No way!', 'Seriously?', 'You\u2019re kidding!'] },

  // Agreement
  { id: 'ag1', speaker: 'I think we should leave a bit earlier to avoid traffic.', context: 'agreement', accepted: ['Makes sense.', 'Good idea.', 'I agree.', "You're right."] },
  { id: 'ag2', speaker: 'Working from home actually saves a lot of time.',         context: 'agreement', accepted: ['Totally.', 'Absolutely.', 'I agree.', 'Makes sense.'] },
  { id: 'ag3', speaker: 'We should book the tickets before prices go up.',         context: 'agreement', accepted: ['Good idea.', "You're right.", 'Makes sense.', "Let's do it."] },

  // Mild disbelief
  { id: 'md1', speaker: 'I can hold my breath for five minutes underwater.',       context: 'mild_disbelief', accepted: ['Really?', 'Are you serious?', 'No way!', 'Come on!'] },
  { id: 'md2', speaker: 'I read the entire dictionary last weekend.',              context: 'mild_disbelief', accepted: ['Really?', 'Are you kidding?', 'Come on!', 'No way!'] },
  { id: 'md3', speaker: 'The CEO actually replied to my email in two minutes.',    context: 'mild_disbelief', accepted: ['Really?', 'Seriously?', 'No way!', 'Are you serious?'] },

  // Sympathy
  { id: 'sy1', speaker: "I've had a really stressful week at work.",   context: 'sympathy', accepted: ['That sounds tough.', 'I can imagine.', "I'm sorry.", 'Hang in there.'] },
  { id: 'sy2', speaker: "I haven't been sleeping well lately.",         context: 'sympathy', accepted: ['That sounds rough.', 'I can imagine.', "I'm sorry to hear that.", 'Hang in there.'] },
  { id: 'sy3', speaker: 'My back has been hurting for days.',           context: 'sympathy', accepted: ['That sounds painful.', 'I can imagine.', "I'm sorry.", 'Take care of yourself.'] },
];

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

export const ROUNDS_PER_SESSION = 5;

export function shuffleArray<T>(arr: T[], rng: () => number = Math.random): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function pickRoundPrompts(
  pool: BackchannelPrompt[],
  n: number = ROUNDS_PER_SESSION,
  rng: () => number = Math.random,
): BackchannelPrompt[] {
  if (pool.length === 0) return [];
  return shuffleArray(pool, rng).slice(0, Math.min(n, pool.length));
}

export interface RoundChoices {
  options: string[];
  correctSet: Set<string>;
  distractor: string;
}

export function buildChoices(
  prompt: BackchannelPrompt,
  allPrompts: BackchannelPrompt[],
  rng: () => number = Math.random,
): RoundChoices {
  // 3 correct picks from the accepted list (shuffled).
  const correctPicks = shuffleArray(prompt.accepted, rng).slice(0, 3);
  const correctSet = new Set(correctPicks);

  // Distractor: pick from a different context, ensuring it doesn't collide
  // with anything already in the accepted set.
  const wrongContextPrompts = allPrompts.filter(p => p.context !== prompt.context);
  const wrongPool = shuffleArray(wrongContextPrompts, rng);
  let distractor = '';
  outer: for (const wp of wrongPool) {
    for (const candidate of shuffleArray(wp.accepted, rng)) {
      if (!correctSet.has(candidate) && !prompt.accepted.includes(candidate)) {
        distractor = candidate;
        break outer;
      }
    }
  }
  // Fallback if nothing found (shouldn't happen with our bank).
  if (!distractor) distractor = 'Hmm.';

  const options = shuffleArray([...correctPicks, distractor], rng);
  return { options, correctSet, distractor };
}

export function isAcceptedChoice(choice: string, correctSet: Set<string>): boolean {
  return correctSet.has(choice);
}

export function evaluateSpokenMatch(transcript: string, accepted: string[]): boolean {
  const t = transcript.trim().toLowerCase();
  if (!t) return false;
  return accepted.some(a => {
    const norm = a.toLowerCase().replace(/[!?.,]/g, '').trim();
    return norm.length > 0 && t.includes(norm);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

type Phase = 'playing' | 'feedback' | 'done';

const ACCENT = '#8b5cf6'; // violet-500

export default function QuickBackchannelCard() {
  const tts = useSpeechSynthesis();
  const speech = useSpeechRecognition();

  const [rounds, setRounds] = useState<BackchannelPrompt[]>(() =>
    pickRoundPrompts(BACKCHANNEL_PROMPTS, ROUNDS_PER_SESSION),
  );
  const [roundIndex, setRoundIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('playing');
  const [score, setScore] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [spokenMatch, setSpokenMatch] = useState<boolean | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string>('');
  const wasListeningRef = useRef(false);

  const current = rounds[roundIndex] ?? null;

  const choices = useMemo<RoundChoices | null>(() => {
    if (!current) return null;
    return buildChoices(current, BACKCHANNEL_PROMPTS);
    // We intentionally rebuild only when the prompt changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // Auto-play speaker utterance at the start of each round.
  useEffect(() => {
    if (phase !== 'playing' || !current || !tts.isSupported) return;
    setHasPlayed(false);
    const t = setTimeout(() => {
      tts.speak(current.speaker);
      setHasPlayed(true);
    }, 100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, phase]);

  // Auto-evaluate spoken reply when speech recognition stops.
  useEffect(() => {
    if (
      wasListeningRef.current &&
      !speech.isListening &&
      current &&
      phase !== 'done'
    ) {
      const t = speech.transcript || speech.interimTranscript || '';
      if (t.trim()) {
        setLastTranscript(t);
        setSpokenMatch(evaluateSpokenMatch(t, current.accepted));
      }
    }
    wasListeningRef.current = speech.isListening;
  }, [speech.isListening, speech.transcript, speech.interimTranscript, current, phase]);

  const handleReplay = useCallback(() => {
    if (current) {
      tts.speak(current.speaker);
      setHasPlayed(true);
    }
  }, [current, tts]);

  const handleSelect = useCallback((choice: string) => {
    if (!choices || phase === 'feedback' || phase === 'done') return;
    setSelected(choice);
    if (isAcceptedChoice(choice, choices.correctSet)) {
      setScore(s => s + 1);
    }
    setPhase('feedback');
  }, [choices, phase]);

  const handleNext = useCallback(() => {
    speech.reset();
    setLastTranscript('');
    setSpokenMatch(null);
    setSelected(null);
    if (roundIndex + 1 >= rounds.length) {
      setPhase('done');
    } else {
      setRoundIndex(i => i + 1);
      setPhase('playing');
    }
  }, [roundIndex, rounds.length, speech]);

  const handleRestart = useCallback(() => {
    setRounds(pickRoundPrompts(BACKCHANNEL_PROMPTS, ROUNDS_PER_SESSION));
    setRoundIndex(0);
    setScore(0);
    setSelected(null);
    setLastTranscript('');
    setSpokenMatch(null);
    setHasPlayed(false);
    setPhase('playing');
    speech.reset();
  }, [speech]);

  const handleMic = useCallback(() => {
    if (!speech.isSupported) return;
    if (speech.isListening) {
      speech.stop();
    } else {
      speech.reset();
      setLastTranscript('');
      setSpokenMatch(null);
      speech.start();
    }
  }, [speech]);

  if (!tts.isSupported) return null;

  // ─── Summary ──────────────────────────────────────────────────────────────
  if (phase === 'done') {
    const total = rounds.length;
    const pct = total > 0 ? Math.round((score / total) * 100) : 0;
    return (
      <div
        data-testid="quick-backchannel-card"
        className="card"
        style={{
          background: 'var(--card-bg, white)',
          borderRadius: 16,
          padding: 20,
          border: '1px solid var(--border)',
          marginBottom: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <MessageCircle size={20} color={ACCENT} />
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Backchannel — Summary</h3>
        </div>
        <div
          data-testid="qbc-summary"
          style={{
            padding: 16,
            borderRadius: 10,
            background: 'var(--bg-secondary, #f9fafb)',
            marginBottom: 12,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: ACCENT }}>
            {score} / {total} ({pct}%)
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 4 }}>
            {pct >= 80 ? 'Excellent reactions! 🎉' : pct >= 50 ? 'Nice work — keep practicing.' : 'Keep going — try again!'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            data-testid="qbc-restart"
            onClick={handleRestart}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              cursor: 'pointer',
              border: 'none',
              background: ACCENT,
              color: 'white',
              fontSize: '0.9rem',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <RefreshCw size={14} /> Try again
          </button>
          <a
            data-testid="qbc-back-hub"
            href="#quick-practice-hub"
            onClick={(e) => {
              // Soft scroll to top of hub if anchor not found.
              const el = document.querySelector('[data-testid="qp-tabpanel-listening"], [data-testid="qp-tabpanel-favorites"]');
              if (el) {
                e.preventDefault();
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              cursor: 'pointer',
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: '0.85rem',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            ← Back to hub
          </a>
        </div>
      </div>
    );
  }

  if (!current || !choices) return null;

  const ctxMeta = CONTEXT_LABELS[current.context];
  const isCorrect = selected ? isAcceptedChoice(selected, choices.correctSet) : null;

  return (
    <div
      data-testid="quick-backchannel-card"
      className="card"
      style={{
        background: 'var(--card-bg, white)',
        borderRadius: 16,
        padding: 20,
        border: '1px solid var(--border)',
        marginBottom: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <MessageCircle size={20} color={ACCENT} />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Backchannel</h3>
        <span
          data-testid="qbc-progress"
          style={{
            marginLeft: 'auto',
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
          }}
        >
          Round {roundIndex + 1} / {rounds.length} • Score {score}
        </span>
      </div>

      {/* Speaker line + replay */}
      <div
        data-testid="qbc-speaker"
        style={{
          padding: 14,
          borderRadius: 10,
          background: 'var(--bg-secondary, #f9fafb)',
          marginBottom: 10,
          fontSize: '1rem',
          color: 'var(--text)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <button
          data-testid="qbc-replay"
          onClick={handleReplay}
          aria-label="Replay speaker line"
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '0.8rem',
          }}
        >
          <Volume2 size={14} /> 🔊 Replay
        </button>
        <span style={{ flex: 1, minWidth: 0, fontStyle: 'italic' }}>"{current.speaker}"</span>
        {hasPlayed && (
          <span
            data-testid="qbc-context-badge"
            style={{
              padding: '2px 10px',
              borderRadius: 999,
              background: ACCENT,
              color: '#fff',
              fontSize: '0.75rem',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            {ctxMeta.emoji} {ctxMeta.label}
          </span>
        )}
      </div>

      {/* Multiple-choice buttons */}
      <div
        data-testid="qbc-choices"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 8,
          marginBottom: 10,
        }}
      >
        {choices.options.map((opt) => {
          const isSelected = selected === opt;
          const isCorrectOpt = choices.correctSet.has(opt);
          let bg = 'var(--bg)';
          let color = 'var(--text)';
          let border = 'var(--border)';
          if (phase === 'feedback' && isSelected) {
            if (isCorrectOpt) {
              bg = '#dcfce7'; color = '#166534'; border = '#22c55e';
            } else {
              bg = '#fee2e2'; color = '#991b1b'; border = '#ef4444';
            }
          }
          return (
            <button
              key={opt}
              data-testid={`qbc-choice-${opt}`}
              onClick={() => handleSelect(opt)}
              disabled={phase === 'feedback'}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: `1px solid ${border}`,
                background: bg,
                color,
                cursor: phase === 'feedback' ? 'default' : 'pointer',
                fontSize: '0.85rem',
                fontWeight: 500,
                textAlign: 'center',
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>

      {/* Feedback */}
      {phase === 'feedback' && (
        <div
          data-testid="qbc-feedback"
          data-correct={isCorrect ? 'true' : 'false'}
          style={{
            padding: 10,
            marginBottom: 10,
            borderRadius: 8,
            background: isCorrect ? '#dcfce7' : '#fee2e2',
            border: `1px solid ${isCorrect ? '#22c55e' : '#ef4444'}`,
            color: isCorrect ? '#166534' : '#991b1b',
            fontSize: '0.85rem',
          }}
        >
          {isCorrect ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Check size={16} /> Nice — that's a natural reply for {ctxMeta.label.toLowerCase()}.
            </span>
          ) : (
            <div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                <X size={16} /> Not quite. Acceptable replies:
              </div>
              <div data-testid="qbc-accepted-list" style={{ marginTop: 6, fontSize: '0.85rem' }}>
                {current.accepted.join(' · ')}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Optional Say-it (speech recognition) */}
      {phase === 'feedback' && speech.isSupported && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <button
            data-testid="qbc-say-it"
            onClick={handleMic}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: speech.isListening ? '#ef4444' : 'var(--bg)',
              color: speech.isListening ? '#fff' : 'var(--text)',
              cursor: 'pointer',
              fontSize: '0.8rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Mic size={14} /> {speech.isListening ? 'Stop' : 'Say it'}
          </button>
          {lastTranscript && (
            <span data-testid="qbc-spoken-transcript" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              "{lastTranscript}"
            </span>
          )}
          {spokenMatch !== null && (
            <span
              data-testid="qbc-spoken-match"
              data-match={spokenMatch ? 'true' : 'false'}
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                color: spokenMatch ? '#166534' : '#991b1b',
              }}
            >
              {spokenMatch ? '✓ Matched' : '✗ No match'}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          data-testid="qbc-next"
          onClick={handleNext}
          disabled={phase !== 'feedback'}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            cursor: phase === 'feedback' ? 'pointer' : 'not-allowed',
            border: 'none',
            background: phase === 'feedback' ? ACCENT : 'var(--border)',
            color: 'white',
            fontSize: '0.9rem',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {roundIndex + 1 >= rounds.length ? 'Finish' : 'Next round'} <RefreshCw size={14} />
        </button>
      </div>
    </div>
  );
}
