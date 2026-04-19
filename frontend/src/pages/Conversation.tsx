import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useBlocker } from 'react-router-dom';
import { Mic, MicOff, Send, Square, Volume2, History, Trash2, Headphones, Star, Keyboard, ChevronDown, Bookmark, BookOpen, Lightbulb, X } from 'lucide-react';
import { api, ApiError, type GrammarFeedback, type ConversationListItem, type ConversationQuizQuestion, getDifficultyRecommendation, type DifficultyRecommendation, getTopicRecommendations, type TopicRecommendation, getTopicMastery, type TopicMasteryMap } from '../api';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { formatDateTime, formatRelativeTime } from '../utils/formatDate';
import { getCache, setCache } from '../utils/localStorageCache';
import { BookmarksReview, FeedbackPanel, GrammarNotesPanel, HighlightedMessage, ConversationReplay, ConversationSummary as ConversationSummaryView, ConversationHistory, PhaseTransition, ConversationWarmUp, VocabTargetBar, ConversationCoach, ResponseTimer, GoalSelector, GoalTracker, GoalSummary, ReplaySpeakWalkthrough, FillerWordBadge, ListenModeCloze, LiveFluencyRing, GrammarStreakBadge, ConversationMemory } from '../components/conversation';
import KeyboardShortcutsPanel from '../components/KeyboardShortcutsPanel';
import ConfirmDialog from '../components/ConfirmDialog';
import { countFillers } from '../utils/fillerWords';
import { categorizeGrammarError } from '../utils/grammarPatterns';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  feedback?: GrammarFeedback;
  key_phrases?: string[];
  grammar_notes?: import('../api').GrammarNote[];
}

const TOPIC_EMOJIS: Record<string, string> = {
  hotel_checkin: '🏨',
  restaurant_order: '🍽️',
  job_interview: '💼',
  doctor_visit: '🏥',
  shopping: '🛍️',
  airport: '✈️',
};

type DurationOption = { value: number; label: string; description: string };
const DURATION_OPTIONS: DurationOption[] = [
  { value: 3 * 60, label: '3 min', description: 'Quick practice' },
  { value: 5 * 60, label: '5 min', description: 'Standard session' },
  { value: 10 * 60, label: '10 min', description: 'Deep conversation' },
  { value: 0, label: 'No limit', description: 'Practice at your own pace' },
];

type Difficulty = 'beginner' | 'intermediate' | 'advanced';

const DIFFICULTY_OPTIONS: { value: Difficulty; label: string; description: string }[] = [
  { value: 'beginner', label: '🌱 Beginner', description: 'Simple vocabulary, short sentences' },
  { value: 'intermediate', label: '📗 Intermediate', description: 'Natural conversation pace' },
  { value: 'advanced', label: '🚀 Advanced', description: 'Idioms, complex grammar, nuanced' },
];

type Personality = 'patient_teacher' | 'chatty_friend' | 'professional' | 'challenging';

const PERSONALITY_OPTIONS: { value: Personality; label: string; emoji: string; description: string }[] = [
  { value: 'patient_teacher', label: 'Patient Teacher', emoji: '🧑‍🏫', description: 'Speaks simply, gently corrects mistakes' },
  { value: 'chatty_friend', label: 'Chatty Friend', emoji: '😄', description: 'Casual, uses slang and idioms' },
  { value: 'professional', label: 'Professional', emoji: '👔', description: 'Formal register, business-like' },
  { value: 'challenging', label: 'Challenging', emoji: '🧠', description: 'Complex vocab, pushes you to improve' },
];

export default function Conversation() {
  const [phase, setPhase] = useState<'select' | 'warmup' | 'chat' | 'summary' | 'history' | 'replay' | 'bookmarks'>('select');
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [duration, setDuration] = useState(5 * 60);
  const [timeLeft, setTimeLeft] = useState(5 * 60);
  const [summary, setSummary] = useState<any>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [diffRec, setDiffRec] = useState<DifficultyRecommendation | null>(null);
  const [roleSwap, setRoleSwap] = useState(false);
  const [personality, setPersonality] = useState<Personality>('patient_teacher');
  const [sessionGoals, setSessionGoals] = useState<string[]>([]);
  const [pastConversations, setPastConversations] = useState<ConversationListItem[]>([]);
  const [historyMessages, setHistoryMessages] = useState<import('../api').ChatMessage[]>([]);
  const [historySummary, setHistorySummary] = useState<import('../api').ConversationSummary | null>(null);
  const [topics, setTopics] = useState<{ id: string; label: string; description: string; is_custom?: boolean }[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [favoriteTopics, setFavoriteTopics] = useState<Set<string>>(new Set());
  const [showCreateScenario, setShowCreateScenario] = useState(false);
  const [customForm, setCustomForm] = useState({ label: '', description: '', scenario: '', goal: '' });
  const [customSaving, setCustomSaving] = useState(false);
  const [topicSuggestions, setTopicSuggestions] = useState<TopicRecommendation[]>([]);
  const [phraseSuggestions, setPhraseSuggestions] = useState<string[]>([]);
  const [helpersLoading, setHelpersLoading] = useState(false);
  const [userRoleName, setUserRoleName] = useState('');
  const [roleBriefing, setRoleBriefing] = useState<string[]>([]);
  const [showBriefing, setShowBriefing] = useState(false);
  const [replayTurns, setReplayTurns] = useState<import('../api').ReplayTurn[]>([]);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replayLoading, setReplayLoading] = useState(false);
  const [speakWalkthrough, setSpeakWalkthrough] = useState(false);
  const [listenMode, setListenMode] = useState(false);
  const [revealedMessages, setRevealedMessages] = useState<Set<number>>(new Set());
  const [listenCorrect, setListenCorrect] = useState(0);
  const [listenTotal, setListenTotal] = useState(0);
  const [quizQuestions, setQuizQuestions] = useState<ConversationQuizQuestion[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<(number | null)[]>([]);
  const [quizRevealed, setQuizRevealed] = useState(false);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizFinished, setQuizFinished] = useState(false);
  const [quizError, setQuizError] = useState('');
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [headerExpanded, setHeaderExpanded] = useState(false);
  const [correctionAttempts, setCorrectionAttempts] = useState(0);
  const [correctionSuccesses, setCorrectionSuccesses] = useState(0);
  const [showGrammarPanel, setShowGrammarPanel] = useState(false);
  const [lastAssistantAt, setLastAssistantAt] = useState<number>(0);
  const [wpmValues, setWpmValues] = useState<number[]>([]);
  const [responseTimes, setResponseTimes] = useState<number[]>([]);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'ai-speaking' | 'listening' | 'sending' | 'reconnecting'>('idle');
  const [warmupTopicId, setWarmupTopicId] = useState<string>('');
  const [currentTopicId, setCurrentTopicId] = useState<string>('');
  const [currentTopicLabel, setCurrentTopicLabel] = useState<string>('');
  const [vocabTargets, setVocabTargets] = useState<string[]>([]);
  const [usedVocabWords, setUsedVocabWords] = useState<Set<string>>(new Set());
  const [failedMessage, setFailedMessage] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [fillerCount, setFillerCount] = useState(0);
  const [fillerDetails, setFillerDetails] = useState<Record<string, number>>({});
  const [startError, setStartError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ message: string; onConfirm: () => Promise<void> } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [hintText, setHintText] = useState<string | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [hintUsedThisTurn, setHintUsedThisTurn] = useState(false);
  const [hintCount, setHintCount] = useState(0);
  const [savedChatPhrases, setSavedChatPhrases] = useState<Set<string>>(new Set());
  const [errorPatterns, setErrorPatterns] = useState<Map<string, number>>(new Map());
  const [topicMastery, setTopicMastery] = useState<TopicMasteryMap>({});
  const [grammarStreak, setGrammarStreak] = useState(0);
  const [bestGrammarStreak, setBestGrammarStreak] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const conversationIdRef = useRef<number | null>(null);
  const phaseRef = useRef(phase);
  const autoEndAttempted = useRef(false);

  // Keep refs in sync with state
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Warn before tab close/refresh during active chat
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (phaseRef.current === 'chat') {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Gracefully end conversation on unmount
  useEffect(() => {
    return () => {
      const cid = conversationIdRef.current;
      if (cid && phaseRef.current === 'chat') {
        fetch('/api/conversation/end', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversation_id: cid, skip_summary: true }),
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, []);

  // Block SPA navigation while chat is active
  const blocker = useBlocker(phase === 'chat');

  const speech = useSpeechRecognition({ continuous: true });
  const tts = useSpeechSynthesis();

  useKeyboardShortcuts([
    {
      key: 'Escape',
      handler: () => { if (phase === 'chat' && !loading) endConversation(); },
      enabled: phase === 'chat',
    },
    {
      key: '?',
      handler: () => setShowShortcuts((v) => !v),
      enabled: phase === 'chat',
    },
    {
      key: 'm',
      handler: () => { speech.isListening ? speech.stop() : speech.start(); },
      enabled: phase === 'chat',
    },
    {
      key: 'Enter',
      ctrlKey: true,
      handler: () => sendMessage(),
      enabled: phase === 'chat',
      allowInInput: true,
    },
  ]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const endConversation = useCallback(async () => {
    if (!conversationId) return;
    speech.stop();
    tts.stop();
    setLoading(true);
    try {
      const res = await api.endConversation(conversationId);
      setSummary(res.summary);
      setPhase('summary');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        try {
          const sumRes = await api.getConversationSummary(conversationId);
          setSummary(sumRes.summary);
          setPhase('summary');
        } catch {
          setPhase('select');
        }
      } else {
        console.error(err);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'Failed to end conversation. Please try again.' },
        ]);
      }
    } finally {
      setLoading(false);
      clearInterval(timerRef.current);
    }
  }, [conversationId, speech, tts]);

  const startQuiz = useCallback(async () => {
    if (!conversationId) return;
    setQuizLoading(true);
    setQuizQuestions([]);
    setQuizIndex(0);
    setQuizAnswers([]);
    setQuizRevealed(false);
    setQuizFinished(false);
    setQuizError('');
    try {
      const res = await api.generateConversationQuiz(conversationId);
      setQuizQuestions(res.questions);
      setQuizAnswers(new Array(res.questions.length).fill(null));
    } catch (err) {
      console.error('Quiz generation failed:', err);
      setQuizError('Quiz generation failed. Please try again.');
    } finally {
      setQuizLoading(false);
    }
  }, [conversationId]);

  const answerQuiz = useCallback((optionIndex: number) => {
    if (quizRevealed) return;
    setQuizAnswers((prev) => {
      const next = [...prev];
      next[quizIndex] = optionIndex;
      return next;
    });
    setQuizRevealed(true);
  }, [quizIndex, quizRevealed]);

  const nextQuizQuestion = useCallback(() => {
    if (quizIndex < quizQuestions.length - 1) {
      setQuizIndex((i) => i + 1);
      setQuizRevealed(false);
    } else {
      setQuizFinished(true);
    }
  }, [quizIndex, quizQuestions.length]);

  // Timer (skip when no limit)
  useEffect(() => {
    if (phase === 'chat' && duration > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [phase, duration]);

  // Auto-end conversation when timer expires (only once per timer expiry)
  useEffect(() => {
    if (phase === 'chat' && duration > 0 && timeLeft === 0 && !loading && !autoEndAttempted.current) {
      autoEndAttempted.current = true;
      endConversation();
    }
  }, [timeLeft, phase, loading, endConversation]);

  // Sync speech recognition transcript to input
  useEffect(() => {
    if (speech.transcript) {
      setInput(speech.transcript);
    }
  }, [speech.transcript]);

  // Voice Mode: update status indicator
  useEffect(() => {
    if (!voiceMode || phase !== 'chat') { setVoiceStatus('idle'); return; }
    if (tts.isSpeaking) setVoiceStatus('ai-speaking');
    else if (speech.isListening) setVoiceStatus('listening');
    else if (loading) setVoiceStatus('sending');
    else setVoiceStatus('idle');
  }, [voiceMode, phase, tts.isSpeaking, speech.isListening, loading]);

  // Voice Mode: auto-start listening after AI finishes speaking
  const prevSpeakingRef = useRef(false);
  useEffect(() => {
    const wasSpeaking = prevSpeakingRef.current;
    prevSpeakingRef.current = tts.isSpeaking;
    if (voiceMode && phase === 'chat' && wasSpeaking && !tts.isSpeaking && !loading && speech.isSupported) {
      const timer = setTimeout(() => {
        speech.reset();
        speech.start();
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [tts.isSpeaking, voiceMode, phase, loading, speech.isSupported]);

  // Voice Mode: auto-send when user stops speaking
  const prevListeningRef = useRef(false);
  useEffect(() => {
    const wasListening = prevListeningRef.current;
    prevListeningRef.current = speech.isListening;
    if (voiceMode && phase === 'chat' && wasListening && !speech.isListening && !loading && input.trim()) {
      const timer = setTimeout(() => sendMessage(), 300);
      return () => clearTimeout(timer);
    }
  }, [speech.isListening, voiceMode, phase, loading, input]);

  // Voice Mode: auto-recover when speech recognition fails or times out
  useEffect(() => {
    if (!voiceMode || phase !== 'chat' || speech.isListening || tts.isSpeaking || loading || !speech.isSupported) return;
    setVoiceStatus('reconnecting');
    const timer = setTimeout(() => {
      speech.reset();
      speech.start();
    }, 2000);
    return () => clearTimeout(timer);
  }, [voiceMode, phase, speech.isListening, tts.isSpeaking, loading, speech.isSupported]);

  // Turn off voice mode when leaving chat
  useEffect(() => {
    if (phase !== 'chat') setVoiceMode(false);
  }, [phase]);

  // Fetch topics and favorites with stale-while-revalidate cache (10 min TTL)
  useEffect(() => {
    const CACHE_TTL = 10 * 60 * 1000;
    const cachedTopics = getCache<{ id: string; label: string; description: string }[]>('conv_topics', CACHE_TTL);
    const cachedFavs = getCache<string[]>('conv_favorites', CACHE_TTL);
    if (cachedTopics) {
      setTopics(cachedTopics);
      if (cachedFavs) setFavoriteTopics(new Set(cachedFavs));
      setTopicsLoading(false);
    }
    Promise.all([
      api.getConversationTopics(),
      api.getFavoriteTopics().catch(() => ({ favorites: [] as string[] })),
    ])
      .then(([topicsData, favData]) => {
        setTopics(topicsData);
        setFavoriteTopics(new Set(favData.favorites));
        setCache('conv_topics', topicsData);
        setCache('conv_favorites', favData.favorites);
      })
      .catch(() => {})
      .finally(() => setTopicsLoading(false));
    getTopicRecommendations()
      .then(recs => setTopicSuggestions(recs.filter(r => r.reason !== 'continue_practice').slice(0, 3)))
      .catch(() => {});
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleToggleFavorite = async (e: React.MouseEvent, topicId: string) => {
    e.stopPropagation();
    const next = new Set(favoriteTopics);
    if (next.has(topicId)) next.delete(topicId); else next.add(topicId);
    setFavoriteTopics(next);
    try {
      const res = await api.toggleTopicFavorite(topicId);
      setFavoriteTopics(new Set(res.favorites));
    } catch {
      setFavoriteTopics(favoriteTopics);
    }
  };

  const handleCreateCustomTopic = async () => {
    if (!customForm.label.trim() || !customForm.scenario.trim()) return;
    setCustomSaving(true);
    try {
      const created = await api.createCustomTopic({
        label: customForm.label.trim(),
        description: customForm.description.trim(),
        scenario: customForm.scenario.trim(),
        goal: customForm.goal.trim() || 'Have a natural conversation',
      });
      setTopics(prev => [...prev, { id: created.id, label: created.label, description: created.description, is_custom: true }]);
      setCustomForm({ label: '', description: '', scenario: '', goal: '' });
      setShowCreateScenario(false);
    } catch { /* ignore */ }
    setCustomSaving(false);
  };

  const handleDeleteCustomTopic = async (e: React.MouseEvent, topicId: string) => {
    e.stopPropagation();
    try {
      await api.deleteCustomTopic(topicId);
      setTopics(prev => prev.filter(t => t.id !== topicId));
    } catch { /* ignore */ }
  };

  const sortedTopics = [...topics].sort((a, b) => {
    const aFav = favoriteTopics.has(a.id) ? 0 : 1;
    const bFav = favoriteTopics.has(b.id) ? 0 : 1;
    return aFav - bFav;
  });

  // Load past conversations for history browsing (only on select phase)
  useEffect(() => {
    if (phase !== 'select') return;
    api.listConversations().then((res) => {
      setPastConversations(res.conversations.filter((c) => c.status === 'ended'));
    }).catch(() => {});
    getDifficultyRecommendation().then((rec) => {
      setDiffRec(rec);
      if (rec.recommended_difficulty && rec.recommended_difficulty !== rec.current_difficulty) {
        setDifficulty(rec.recommended_difficulty as Difficulty);
      }
    }).catch(() => {});
    getTopicMastery().then(setTopicMastery).catch(() => {});
  }, [phase]);

  // Compute per-topic practice stats from past conversations
  const topicStats = useMemo(() => {
    const stats: Record<string, { count: number; lastPracticed: string; totalMessages: number }> = {};
    for (const c of pastConversations) {
      const prev = stats[c.topic_id];
      if (!prev) {
        stats[c.topic_id] = { count: 1, lastPracticed: c.started_at, totalMessages: c.message_count };
      } else {
        prev.count++;
        prev.totalMessages += c.message_count;
        if (c.started_at > prev.lastPracticed) prev.lastPracticed = c.started_at;
      }
    }
    return stats;
  }, [pastConversations]);

  const allGrammarNotes = useMemo(() => {
    return messages.flatMap(m => m.grammar_notes || []);
  }, [messages]);

  const viewConversationHistory = async (id: number) => {
    try {
      const [histRes, sumRes] = await Promise.allSettled([
        api.getHistory(id),
        api.getConversationSummary(id),
      ]);
      setHistoryMessages(histRes.status === 'fulfilled' ? histRes.value.messages : []);
      setHistorySummary(sumRes.status === 'fulfilled' ? sumRes.value.summary : null);
      setConversationId(id);
      setPhase('history');
    } catch (err) {
      console.error(err);
    }
  };

  const startReplay = async (id: number) => {
    setReplayLoading(true);
    try {
      const data = await api.getConversationReplay(id);
      setReplayTurns(data.turns);
      setReplayIndex(0);
      setPhase('replay');
    } catch (err) {
      console.error(err);
    } finally {
      setReplayLoading(false);
    }
  };

  const handleDeleteConversation = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setConfirmAction({
      message: 'Delete this conversation?',
      onConfirm: async () => {
        try {
          await api.deleteConversation(id);
          setPastConversations((prev) => prev.filter((c) => c.id !== id));
        } catch (err) {
          setStartError(err instanceof Error ? err.message : 'Failed to delete conversation');
        }
      },
    });
  };

  const handleClearEnded = () => {
    setConfirmAction({
      message: 'Delete all past conversations?',
      onConfirm: async () => {
        try {
          await api.clearEndedConversations();
          setPastConversations([]);
        } catch (err) {
          setStartError(err instanceof Error ? err.message : 'Failed to clear conversations');
        }
      },
    });
  };

  // --- Session / conversation reset helpers ---
  const resetSessionScopedState = () => {
    setFillerCount(0);
    setFillerDetails({});
    setCorrectionAttempts(0);
    setCorrectionSuccesses(0);
    setErrorPatterns(new Map());
    setListenCorrect(0);
    setListenTotal(0);
    setRevealedMessages(new Set());
    setSavedChatPhrases(new Set());
    setHintText(null);
    setHintUsedThisTurn(false);
    setHintCount(0);
    setFailedMessage(null);
    setSendError(null);
    setGrammarStreak(0);
    setBestGrammarStreak(0);
  };

  const resetConversationState = () => {
    setMessages([]);
    setSummary(null);
    setConversationId(null);
    setQuizQuestions([]);
    setQuizIndex(0);
    setQuizAnswers([]);
    setQuizRevealed(false);
    setQuizFinished(false);
    setQuizError('');
    setResponseTimes([]);
    setSessionGoals([]);
    resetSessionScopedState();
  };

  // Lazily fetch reply helpers (suggestions/key_phrases/grammar_notes) for the latest
  // assistant message after /start or /message has rendered. Silent on failure.
  const loadHelpersInBackground = (convId: number) => {
    setHelpersLoading(true);
    api.fetchConversationHelpers(convId)
      .then((helpers) => {
        setPhraseSuggestions(helpers.phrase_suggestions || []);
        const kp = helpers.key_phrases || [];
        const gn = helpers.grammar_notes || [];
        if (kp.length > 0 || gn.length > 0) {
          setMessages((prev) => {
            const updated = [...prev];
            const lastAssistant = updated.findLastIndex((m) => m.role === 'assistant');
            if (lastAssistant >= 0) {
              updated[lastAssistant] = {
                ...updated[lastAssistant],
                key_phrases: kp,
                grammar_notes: gn,
              };
            }
            return updated;
          });
        }
      })
      .catch((err) => {
        console.warn('fetchConversationHelpers failed (non-fatal):', err);
      })
      .finally(() => {
        setHelpersLoading(false);
      });
  };

  const startConversation = async (topicId: string) => {
    setLoading(true);
    setStartError(null);
    autoEndAttempted.current = false;
    resetSessionScopedState();
    try {
      const res = await api.startConversation(topicId, difficulty, roleSwap, personality);
      setCurrentTopicId(topicId);
      const matchedTopic = topics.find(t => t.id === topicId);
      setCurrentTopicLabel(matchedTopic?.label || topicId);
      setConversationId(res.conversation_id);
      setMessages([{ role: 'assistant', content: res.message, key_phrases: res.key_phrases || [], grammar_notes: res.grammar_notes || [] }]);
      setLastAssistantAt(Date.now());
      setWpmValues([]);
      setResponseTimes([]);
      setPhase('chat');
      setTimeLeft(duration);
      setPhraseSuggestions(res.phrase_suggestions || []);
      if (roleSwap && res.user_role) {
        setUserRoleName(res.user_role);
        setRoleBriefing(res.role_briefing || []);
        setShowBriefing(true);
      } else {
        setUserRoleName('');
        setRoleBriefing([]);
        setShowBriefing(false);
      }
      tts.speak(res.message);
      // Fetch reply helpers in background (does not block UI)
      loadHelpersInBackground(res.conversation_id);
      // Fetch vocab target words for this topic
      try {
        const vocabRes = await api.getVocabularyProgress(topicId);
        const words = vocabRes.progress
          .filter((w) => w.level >= 1 && w.level <= 3)
          .slice(0, 5)
          .map((w) => w.word);
        setVocabTargets(words);
        setUsedVocabWords(new Set());
      } catch {
        setVocabTargets([]);
        setUsedVocabWords(new Set());
      }
    } catch (err) {
      setStartError('Failed to start conversation. Make sure the backend is running.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (retryContent?: string) => {
    const messageContent = retryContent || input.trim();
    if (!messageContent || !conversationId || loading) return;

    // Stop recognition and capture current text before resetting
    speech.stop();
    const userMsg = messageContent;
    setInput('');
    speech.reset();
    setPhraseSuggestions([]);
    // Clear any previous error state
    setFailedMessage(null);
    setSendError(null);
    // Only append user message if it's not a retry (retry message is already in the list)
    if (!retryContent) {
      setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
    }
    // Check for target vocabulary words used
    if (vocabTargets.length > 0) {
      const lowerMsg = userMsg.toLowerCase();
      setUsedVocabWords((prev) => {
        const next = new Set(prev);
        for (const w of vocabTargets) {
          if (lowerMsg.includes(w.toLowerCase())) next.add(w.toLowerCase());
        }
        return next;
      });
    }
    if (lastAssistantAt > 0) {
      const elapsed = (Date.now() - lastAssistantAt) / 1000;
      const wordCount = userMsg.split(/\s+/).length;
      if (elapsed >= 2 && wordCount > 0) {
        setWpmValues((prev) => [...prev, Math.round((wordCount / elapsed) * 60)]);
      }
    }
    // Count filler words in user message
    const { total: msgFillers, words: msgFillerWords } = countFillers(userMsg);
    if (msgFillers > 0) {
      setFillerCount((prev) => prev + msgFillers);
      setFillerDetails((prev) => {
        const next = { ...prev };
        msgFillerWords.forEach((count, word) => {
          next[word] = (next[word] ?? 0) + count;
        });
        return next;
      });
    }
    setLoading(true);
    try {
      const res = await api.sendMessage(conversationId, userMsg);
      setMessages((prev) => {
        const updated = [...prev];
        // Add feedback to the last user message
        const lastUser = updated.findLastIndex((m) => m.role === 'user');
        if (lastUser >= 0) {
          updated[lastUser] = { ...updated[lastUser], feedback: res.feedback };
        }
        // Add AI response
        updated.push({ role: 'assistant', content: res.message, key_phrases: res.key_phrases || [], grammar_notes: res.grammar_notes || [] });
        return updated;
      });
      setLastAssistantAt(Date.now());
      setPhraseSuggestions(res.phrase_suggestions || []);
      setHintUsedThisTurn(false);
      setHintText(null);
      // Track grammar error patterns for coaching
      if (res.feedback && !res.feedback.is_correct && res.feedback.errors.length > 0) {
        setErrorPatterns((prev) => {
          const next = new Map(prev);
          for (const err of res.feedback.errors) {
            const category = categorizeGrammarError(err);
            next.set(category, (next.get(category) ?? 0) + 1);
          }
          return next;
        });
      }
      // Update grammar streak counter
      if (res.feedback) {
        if (res.feedback.is_correct) {
          setGrammarStreak((prev) => {
            const next = prev + 1;
            setBestGrammarStreak((best) => Math.max(best, next));
            return next;
          });
        } else {
          setGrammarStreak(0);
        }
      }
      tts.speak(res.message);
      // Fetch reply helpers in background (does not block UI)
      if (conversationId) loadHelpersInBackground(conversationId);
    } catch (err) {
      console.error(err);
      if (err instanceof ApiError && err.status === 409) {
        try {
          const sumRes = await api.getConversationSummary(conversationId!);
          setSummary(sumRes.summary);
          setPhase('summary');
        } catch {
          setSendError('This conversation has ended. Please start a new one.');
        }
      } else if (err instanceof ApiError && err.status === 429) {
        setFailedMessage(userMsg);
        setSendError('Too many requests. Please wait a moment before trying again.');
      } else {
        setFailedMessage(userMsg);
        setSendError('Sorry, something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchHint = useCallback(async () => {
    if (!conversationId || hintLoading || hintUsedThisTurn) return;
    setHintLoading(true);
    try {
      const res = await api.getConversationHint(conversationId);
      setHintText(res.hint);
      setHintUsedThisTurn(true);
      setHintCount((c) => c + 1);
    } catch {
      setHintText('Could not load hint. Try again later.');
      setHintUsedThisTurn(true);
    } finally {
      setHintLoading(false);
    }
  }, [conversationId, hintLoading, hintUsedThisTurn]);

  const handleSavePhrase = useCallback(async (phrase: string) => {
    if (!conversationId) return;
    const key = phrase.toLowerCase();
    if (savedChatPhrases.has(key)) return;
    await api.saveConversationVocabulary(conversationId, [phrase]);
    setSavedChatPhrases((prev) => new Set(prev).add(key));
  }, [conversationId, savedChatPhrases]);

  // Topic selection
  if (phase === 'select') {
    return (
      <PhaseTransition phase={phase}>
      <div>
        <h2 style={{ marginBottom: 8 }}>Choose a Scenario</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
          Select a real-life scenario. AI will play a role and you'll practice the conversation.
        </p>
        {loading ? (
          <div className="loading">
            <div className="spinner" /> Setting up scenario...
          </div>
        ) : (
          <>
            {startError && (
              <div style={{
                marginBottom: 16,
                padding: '12px 16px',
                borderRadius: 12,
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
              role="alert"
              >
                <span>⚠️ {startError}</span>
                <button
                  onClick={() => setStartError(null)}
                  aria-label="Dismiss error"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', fontWeight: 600, fontSize: '1rem', marginLeft: 'auto' }}
                >
                  ✕
                </button>
              </div>
            )}
            {diffRec && diffRec.recommended_difficulty !== diffRec.current_difficulty && (
              <div style={{
                marginBottom: 16,
                padding: '12px 16px',
                borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(99,102,241,0.10), rgba(168,85,247,0.10))',
                border: '1px solid rgba(99,102,241,0.25)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: '0.9rem',
              }}>
                <span style={{ fontSize: '1.3rem' }}>💡</span>
                <div>
                  <strong>Recommendation:</strong> {diffRec.reason}
                  <div style={{ marginTop: 4, opacity: 0.7, fontSize: '0.8rem' }}>
                    Based on {diffRec.stats.sessions_analyzed} recent session{diffRec.stats.sessions_analyzed !== 1 ? 's' : ''} — {diffRec.stats.accuracy}% accuracy, {diffRec.stats.avg_words} avg words/msg
                  </div>
                </div>
              </div>
            )}
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ marginBottom: 8, fontSize: '1rem' }}>Difficulty Level</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                {DIFFICULTY_OPTIONS.map((d) => (
                  <button
                    key={d.value}
                    onClick={() => setDifficulty(d.value)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: difficulty === d.value ? '2px solid var(--primary)' : '2px solid var(--border)',
                      background: difficulty === d.value ? 'var(--primary)' : 'transparent',
                      color: difficulty === d.value ? 'white' : 'var(--text)',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                    }}
                    title={d.description}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ marginBottom: 8, fontSize: '1rem' }}>Partner Style</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {PERSONALITY_OPTIONS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setPersonality(p.value)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: personality === p.value ? '2px solid var(--primary)' : '2px solid var(--border)',
                      background: personality === p.value ? 'var(--primary)' : 'transparent',
                      color: personality === p.value ? 'white' : 'var(--text)',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                    }}
                    title={p.description}
                  >
                    {p.emoji} {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ marginBottom: 8, fontSize: '1rem' }}>Session Duration</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {DURATION_OPTIONS.map((d) => (
                  <button
                    key={d.value}
                    onClick={() => setDuration(d.value)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: duration === d.value ? '2px solid var(--primary)' : '2px solid var(--border)',
                      background: duration === d.value ? 'var(--primary)' : 'transparent',
                      color: duration === d.value ? 'white' : 'var(--text)',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                    }}
                    title={d.description}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ marginBottom: 8, fontSize: '1rem' }}>Role Swap</h3>
              <button
                onClick={() => setRoleSwap(!roleSwap)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: roleSwap ? '2px solid var(--primary)' : '2px solid var(--border)',
                  background: roleSwap ? 'var(--primary)' : 'transparent',
                  color: roleSwap ? 'white' : 'var(--text)',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                🔄 You play the staff role
              </button>
              {roleSwap && (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 4 }}>
                  Practice responding as the hotel clerk, waiter, or doctor.
                </p>
              )}
            </div>
            <GoalSelector
              selectedGoals={sessionGoals}
              onToggleGoal={(id) => setSessionGoals(prev =>
                prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
              )}
            />
            <ConversationMemory />
            {topicsLoading ? (
              <div className="topic-grid">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="skeleton skeleton-card" style={{ height: 100 }} />
                ))}
              </div>
            ) : (
              <>
              {topicSuggestions.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <h3 style={{ fontSize: '1rem', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    💡 Suggested for You
                  </h3>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {topicSuggestions.map(s => (
                      <button
                        key={s.topic_id}
                        onClick={() => startConversation(s.topic_id)}
                        style={{
                          flex: '1 1 200px', maxWidth: 280, padding: '12px 16px', borderRadius: 12, cursor: 'pointer',
                          border: '1px solid rgba(99,102,241,0.3)',
                          background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(168,85,247,0.08))',
                          color: 'var(--text)', textAlign: 'left',
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 4 }}>
                          {TOPIC_EMOJIS[s.topic_id] || '💬'} {s.topic}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {s.reason === 'never_practiced' ? '✨' : '🎯'} {s.reason_text}
                        </div>
                        {s.accuracy != null && (
                          <div style={{ fontSize: '0.75rem', color: s.accuracy < 50 ? 'var(--danger, #ef4444)' : 'var(--warning, #f59e0b)', marginTop: 4 }}>
                            Grammar: {s.accuracy}%
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="topic-grid">
                {sortedTopics.map((s) => {
                  const stats = topicStats[s.id];
                  const daysSincePractice = stats
                    ? Math.floor((Date.now() - new Date(stats.lastPracticed).getTime()) / 86400000)
                    : -1;
                  const freshnessColor = daysSincePractice < 0 ? 'transparent' : daysSincePractice <= 3 ? '#22c55e' : daysSincePractice <= 7 ? '#f59e0b' : '#94a3b8';
                  return (
                    <button
                      key={s.id}
                      className="topic-card"
                      onClick={() => startConversation(s.id)}
                      style={{ position: 'relative' }}
                    >
                      <span
                        role="button"
                        aria-label={favoriteTopics.has(s.id) ? 'Unfavorite' : 'Favorite'}
                        onClick={(e) => handleToggleFavorite(e, s.id)}
                        style={{ position: 'absolute', top: 8, right: s.is_custom ? 32 : 8, cursor: 'pointer', lineHeight: 1 }}
                      >
                        <Star size={16} fill={favoriteTopics.has(s.id) ? '#f59e0b' : 'none'} stroke={favoriteTopics.has(s.id) ? '#f59e0b' : '#9ca3af'} />
                      </span>
                      {s.is_custom && (
                        <span
                          role="button"
                          aria-label="Delete custom scenario"
                          onClick={(e) => handleDeleteCustomTopic(e, s.id)}
                          style={{ position: 'absolute', top: 8, right: 8, cursor: 'pointer', lineHeight: 1 }}
                        >
                          <Trash2 size={14} stroke="#ef4444" />
                        </span>
                      )}
                      <h3>{s.is_custom ? '🎨' : (TOPIC_EMOJIS[s.id] || '💬')} {s.label}</h3>
                      {s.is_custom && (
                        <span style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: 9999, background: '#8b5cf620', color: '#8b5cf6', fontWeight: 600, marginBottom: 4, display: 'inline-block' }}>Custom</span>
                      )}
                      <p>{s.description}</p>
                      <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {stats ? (
                          <>
                            <span style={{
                              fontSize: '0.7rem', padding: '2px 6px', borderRadius: 9999,
                              background: `${freshnessColor}20`, color: freshnessColor, fontWeight: 600,
                              border: `1px solid ${freshnessColor}40`,
                            }}>
                              {stats.count} {stats.count === 1 ? 'session' : 'sessions'}
                            </span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                              {formatRelativeTime(stats.lastPracticed)}
                            </span>
                          </>
                        ) : (
                          <span style={{
                            fontSize: '0.7rem', padding: '2px 6px', borderRadius: 9999,
                            background: '#8b5cf620', color: '#8b5cf6', fontWeight: 600,
                            border: '1px solid #8b5cf640',
                          }}>
                            ✨ New
                          </span>
                        )}
                      </div>
                      {(() => {
                        const mastery = topicMastery[s.id];
                        const TIER_INFO: Record<string, { icon: string; label: string; color: string }> = {
                          new: { icon: '🆕', label: 'New', color: '#8b5cf6' },
                          bronze: { icon: '🥉', label: 'Bronze', color: '#cd7f32' },
                          silver: { icon: '🥈', label: 'Silver', color: '#9ca3af' },
                          gold: { icon: '🥇', label: 'Gold', color: '#f59e0b' },
                          diamond: { icon: '💎', label: 'Diamond', color: '#06b6d4' },
                        };
                        const tier = mastery ? TIER_INFO[mastery.tier] || TIER_INFO.new : TIER_INFO.new;
                        // Compute next-tier hint
                        let nextHint = '';
                        if (!mastery || mastery.tier === 'new') {
                          nextHint = '1 session to 🥉 Bronze';
                        } else if (mastery.tier === 'bronze') {
                          const sessionsNeeded = Math.max(0, 3 - mastery.sessions);
                          const grammarNeeded = mastery.avg_grammar < 60;
                          if (sessionsNeeded > 0) nextHint = `${sessionsNeeded} more session${sessionsNeeded > 1 ? 's' : ''} to 🥈 Silver`;
                          else if (grammarNeeded) nextHint = `Reach 60% grammar for 🥈 Silver`;
                          else nextHint = `Almost 🥈 Silver!`;
                        } else if (mastery.tier === 'silver') {
                          const sessionsNeeded = Math.max(0, 5 - mastery.sessions);
                          const grammarNeeded = mastery.avg_grammar < 80;
                          if (sessionsNeeded > 0) nextHint = `${sessionsNeeded} more session${sessionsNeeded > 1 ? 's' : ''} to 🥇 Gold`;
                          else if (grammarNeeded) nextHint = `Reach 80% grammar for 🥇 Gold`;
                          else nextHint = `Try intermediate+ for 🥇 Gold`;
                        } else if (mastery.tier === 'gold') {
                          const sessionsNeeded = Math.max(0, 8 - mastery.sessions);
                          const grammarNeeded = mastery.avg_grammar < 90;
                          if (sessionsNeeded > 0) nextHint = `${sessionsNeeded} more session${sessionsNeeded > 1 ? 's' : ''} to 💎 Diamond`;
                          else if (grammarNeeded) nextHint = `Reach 90% grammar for 💎 Diamond`;
                          else nextHint = `Try advanced for 💎 Diamond`;
                        }
                        return (
                          <div data-testid="mastery-badge" style={{ marginTop: 4 }}>
                            <span style={{
                              fontSize: '0.7rem', padding: '2px 6px', borderRadius: 9999,
                              background: `${tier.color}15`, color: tier.color, fontWeight: 600,
                              border: `1px solid ${tier.color}30`,
                            }}>
                              {tier.icon} {tier.label}
                            </span>
                            {nextHint && (
                              <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                                {nextHint}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      <div
                        role="button"
                        onClick={(e) => { e.stopPropagation(); setWarmupTopicId(s.id); setPhase('warmup'); }}
                        style={{ marginTop: 6, fontSize: '0.72rem', color: 'var(--primary)', cursor: 'pointer', fontWeight: 600 }}
                      >
                        🔥 Warm Up
                      </div>
                    </button>
                  );
                })}
                <button
                  className="topic-card"
                  onClick={() => setShowCreateScenario(true)}
                  style={{ border: '2px dashed var(--border)', background: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 100, opacity: 0.7 }}
                >
                  <span style={{ fontSize: '1.5rem' }}>➕</span>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Create Scenario</span>
                </button>
              </div>
              {showCreateScenario && (
                <div style={{ marginTop: 16, padding: 20, borderRadius: 12, background: 'var(--card-bg, #f8f9fa)', border: '1px solid var(--border)' }}>
                  <h3 style={{ marginBottom: 12 }}>🎨 Create Custom Scenario</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <input
                      placeholder="Scenario name (e.g. Parent-Teacher Meeting)"
                      value={customForm.label}
                      onChange={(e) => setCustomForm(prev => ({ ...prev, label: e.target.value }))}
                      style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: '0.9rem' }}
                    />
                    <input
                      placeholder="Short description (optional)"
                      value={customForm.description}
                      onChange={(e) => setCustomForm(prev => ({ ...prev, description: e.target.value }))}
                      style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: '0.9rem' }}
                    />
                    <textarea
                      placeholder="AI role scenario (e.g. You are a plumber. The user is a homeowner with a leaking pipe.)"
                      value={customForm.scenario}
                      onChange={(e) => setCustomForm(prev => ({ ...prev, scenario: e.target.value }))}
                      rows={3}
                      style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: '0.9rem', resize: 'vertical' }}
                    />
                    <input
                      placeholder="Goal (default: Have a natural conversation)"
                      value={customForm.goal}
                      onChange={(e) => setCustomForm(prev => ({ ...prev, goal: e.target.value }))}
                      style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: '0.9rem' }}
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button
                        className="btn btn-primary"
                        onClick={handleCreateCustomTopic}
                        disabled={customSaving || !customForm.label.trim() || !customForm.scenario.trim()}
                      >
                        {customSaving ? 'Creating...' : 'Create'}
                      </button>
                      <button className="btn btn-secondary" onClick={() => setShowCreateScenario(false)}>Cancel</button>
                    </div>
                  </div>
                </div>
              )}
              </>
            )}
          </>
        )}

        {/* Bookmarks Button */}
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <button
            onClick={() => setPhase('bookmarks')}
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Bookmark size={16} /> Saved Bookmarks
          </button>
        </div>

        {/* Past Conversations */}
        {pastConversations.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                <History size={18} /> Past Conversations
              </h3>
              {pastConversations.length >= 2 && (
                <button
                  onClick={handleClearEnded}
                  style={{ fontSize: '0.8rem', color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Clear All
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pastConversations.slice(0, 5).map((c) => {
                return (
                  <button
                    key={c.id}
                    onClick={() => viewConversationHistory(c.id)}
                    style={{
                      padding: '12px 16px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--card-bg)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <strong>{TOPIC_EMOJIS[c.topic_id] || '💬'} {c.topic}</strong>
                      <span style={{ color: 'var(--text-secondary)', marginLeft: 8, fontSize: '0.85rem' }}>
                        {c.difficulty} · {c.message_count} messages
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        {formatDateTime(c.started_at)}
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label="Delete conversation"
                        onClick={(e) => handleDeleteConversation(e, c.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleDeleteConversation(e as any, c.id); }}
                        style={{ color: '#b91c1c', cursor: 'pointer', padding: 4, borderRadius: 4 }}
                      >
                        <Trash2 size={16} />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            {confirmAction && (
              <div style={{ marginTop: 12 }}>
                <ConfirmDialog
                  message={confirmAction.message}
                  loading={confirmLoading}
                  onConfirm={async () => {
                    setConfirmLoading(true);
                    try {
                      await confirmAction.onConfirm();
                    } finally {
                      setConfirmLoading(false);
                      setConfirmAction(null);
                    }
                  }}
                  onCancel={() => setConfirmAction(null)}
                />
              </div>
            )}
          </div>
        )}
      </div>
      </PhaseTransition>
    );
  }

  // Warm-up phase
  if (phase === 'warmup' && warmupTopicId) {
    const warmupTopic = topics.find(t => t.id === warmupTopicId);
    return (
      <PhaseTransition phase={phase}>
        <div>
          <ConversationWarmUp
            topicId={warmupTopicId}
            topicLabel={warmupTopic?.label || warmupTopicId}
            difficulty={difficulty}
            onDone={() => { setWarmupTopicId(''); setPhase('select'); }}
            onStartConversation={() => startConversation(warmupTopicId)}
          />
        </div>
      </PhaseTransition>
    );
  }

  // Bookmarks review
  if (phase === 'bookmarks') {
    return (
      <PhaseTransition phase={phase}>
        <BookmarksReview onBack={() => setPhase('select')} />
      </PhaseTransition>
    );
  }

  // History view (read-only past conversation)
  if (phase === 'history') {
    return (
      <PhaseTransition phase={phase}>
      <ConversationHistory
        historyMessages={historyMessages}
        historySummary={historySummary}
        conversationId={conversationId}
        replayLoading={replayLoading}
        onBack={() => setPhase('select')}
        onReplay={startReplay}
        tts={tts}
      />
      </PhaseTransition>
    );
  }

  // Replay view (turn-by-turn stepper)
  if (phase === 'replay') {
    return (
      <PhaseTransition phase={phase}>
      {speakWalkthrough ? (
        <ReplaySpeakWalkthrough
          turns={replayTurns}
          ttsSpeak={tts.speak}
          onClose={() => setSpeakWalkthrough(false)}
        />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 0, flexWrap: 'wrap' }}>
            <button
              onClick={() => setSpeakWalkthrough(true)}
              style={{
                padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: 'var(--card-bg, #f3f4f6)', color: 'var(--text)',
                fontWeight: 600, fontSize: '0.85rem',
              }}
              aria-label="Start speak through walkthrough"
            >
              🗣️ Speak Through
            </button>
          </div>
          <ConversationReplay
            turns={replayTurns}
            replayIndex={replayIndex}
            setReplayIndex={setReplayIndex}
            onBack={() => setPhase('history')}
            tts={tts}
          />
        </>
      )}
      </PhaseTransition>
    );
  }

  // Summary
  if (phase === 'summary' && summary) {
    const handleNewConversation = () => {
      resetConversationState();
      setPhase('select');
    };
    const handlePracticeAgain = () => {
      resetConversationState();
      startConversation(currentTopicId);
    };
    return (
      <PhaseTransition phase={phase}>
      {sessionGoals.length > 0 && (
        <GoalSummary selectedGoals={sessionGoals} messages={messages} />
      )}
      <ConversationSummaryView
        summary={summary}
        messages={messages}
        quizQuestions={quizQuestions}
        quizIndex={quizIndex}
        quizAnswers={quizAnswers}
        quizRevealed={quizRevealed}
        quizFinished={quizFinished}
        quizLoading={quizLoading}
        quizError={quizError}
        onAnswerQuiz={answerQuiz}
        onNextQuiz={nextQuizQuestion}
        onStartQuiz={startQuiz}
        onNewConversation={handleNewConversation}
        onPracticeAgain={currentTopicId ? handlePracticeAgain : undefined}
        topicLabel={currentTopicLabel}
        tts={tts}
        conversationId={conversationId ?? undefined}
        vocabTargetCount={vocabTargets.length}
        vocabUsedCount={vocabTargets.filter((w) => usedVocabWords.has(w.toLowerCase())).length}
        speechRecognition={{
          isListening: speech.isListening,
          transcript: speech.transcript,
          startListening: speech.start,
          stopListening: speech.stop,
          reset: speech.reset,
        }}
        fillerCount={fillerCount}
        fillerDetails={fillerDetails}
        responseTimes={responseTimes}
        correctionAttempts={correctionAttempts}
        correctionSuccesses={correctionSuccesses}
        hintCount={hintCount}
        bestGrammarStreak={bestGrammarStreak}
      />
      </PhaseTransition>
    );
  }

  // Chat
  const timerClass = duration > 0 ? (timeLeft <= 30 ? 'danger' : timeLeft <= 60 ? 'warning' : '') : '';

  return (
    <PhaseTransition phase={phase}>
    <div className="chat-container">
      <KeyboardShortcutsPanel open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <div className="chat-header">
        <div className="chat-header-primary">
          <span style={{ fontWeight: 600 }}>
            Role Play Scenario
            {roleSwap && <span style={{ marginLeft: 8, fontSize: '0.8rem', background: 'var(--primary)', color: 'white', padding: '2px 8px', borderRadius: 12 }}>🔄 {userRoleName || 'Staff Role'}</span>}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {duration > 0 ? (
              <>
                <span className={`timer ${timerClass}`}>{formatTime(timeLeft)}</span>
                {timeLeft > 0 && timeLeft <= 60 && (
                  <button
                    className="btn-touch"
                    onClick={() => setTimeLeft((prev) => prev + 120)}
                    aria-label="Extend by 2 minutes"
                  >
                    +2m
                  </button>
                )}
              </>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>∞ No limit</span>
            )}
            <button
              className="btn-touch"
              onClick={() => setShowGrammarPanel(v => !v)}
              aria-label={showGrammarPanel ? 'Hide grammar notes' : 'Show grammar notes'}
              aria-pressed={showGrammarPanel}
              style={{ position: 'relative' }}
            >
              <BookOpen size={16} />
              {allGrammarNotes.length > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -4,
                  background: 'var(--primary, #6366f1)', color: '#fff',
                  fontSize: 10, fontWeight: 700, borderRadius: '50%',
                  width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{allGrammarNotes.length}</span>
              )}
            </button>
            <button
              className="btn-touch chat-header-toggle"
              onClick={() => setHeaderExpanded((v) => !v)}
              aria-label={headerExpanded ? 'Collapse controls' : 'Expand controls'}
              aria-expanded={headerExpanded}
            >
              <ChevronDown size={16} style={{ transform: headerExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>
            <button className="btn btn-danger btn-sm" onClick={endConversation} disabled={loading} aria-label="End conversation">
              <Square size={14} /> End
            </button>
          </div>
        </div>
        <div className={`chat-header-controls ${headerExpanded ? 'chat-header-controls-open' : ''}`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Volume2 size={14} color="var(--text-secondary)" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={tts.volume}
              onChange={(e) => tts.setVolume(parseFloat(e.target.value))}
              aria-label="Volume"
              style={{ width: 60, accentColor: 'var(--primary)' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }} role="group" aria-label="Speech speed">
            {([
              { label: '🐢', value: 0.7 },
              { label: '1×', value: 0.9 },
              { label: '🐇', value: 1.2 },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                className="btn-touch speed-btn"
                onClick={() => tts.setRate(opt.value)}
                aria-label={`Speed ${opt.label}`}
                aria-pressed={tts.rate === opt.value}
                style={{
                  background: tts.rate === opt.value ? 'var(--primary)' : 'transparent',
                  color: tts.rate === opt.value ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            className="btn-touch listen-btn"
            onClick={() => setListenMode((v) => !v)}
            aria-label={listenMode ? 'Disable listen mode' : 'Enable listen mode'}
            aria-pressed={listenMode}
            title={listenMode ? 'Listen Mode ON — tap to show text' : 'Listen Mode — hide AI text for listening practice'}
            style={{
              background: listenMode ? 'var(--primary)' : 'transparent',
              color: listenMode ? '#fff' : 'var(--text-secondary)',
            }}
          >
            <Headphones size={14} /> {listenMode ? 'ON' : ''}
          </button>
          <button className="btn btn-sm chat-shortcuts-btn" onClick={() => setShowShortcuts(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts" style={{ padding: '4px 6px' }}>
            <Keyboard size={14} />
          </button>
          <button
            className="btn-touch"
            onClick={() => setVoiceMode(v => !v)}
            aria-label={voiceMode ? 'Disable voice mode' : 'Enable voice mode'}
            aria-pressed={voiceMode}
            title={voiceMode ? 'Voice Mode ON — hands-free speaking loop' : 'Voice Mode — auto-listen and auto-send'}
            style={{
              background: voiceMode ? 'var(--success, #22c55e)' : 'transparent',
              color: voiceMode ? '#fff' : 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', gap: 4,
              animation: voiceMode && voiceStatus === 'listening' ? 'voice-pulse 1.5s ease-in-out infinite' : 'none',
            }}
          >
            <Mic size={14} /> {voiceMode ? 'Voice' : ''}
          </button>
        </div>
      </div>

      {voiceMode && voiceStatus !== 'idle' && (
        <div style={{
          padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 13, fontWeight: 500,
          background: voiceStatus === 'listening' ? 'rgba(34,197,94,0.1)' : voiceStatus === 'ai-speaking' ? 'rgba(99,102,241,0.1)' : voiceStatus === 'reconnecting' ? 'rgba(59,130,246,0.1)' : 'rgba(234,179,8,0.1)',
          color: voiceStatus === 'listening' ? 'var(--success, #22c55e)' : voiceStatus === 'ai-speaking' ? 'var(--primary, #6366f1)' : voiceStatus === 'reconnecting' ? 'var(--info, #3b82f6)' : 'var(--warning, #eab308)',
          borderBottom: '1px solid var(--border, #e5e7eb)',
        }}>
          {voiceStatus === 'ai-speaking' && '🎧 AI speaking…'}
          {voiceStatus === 'listening' && '🎤 Listening…'}
          {voiceStatus === 'sending' && '⏳ Sending…'}
          {voiceStatus === 'reconnecting' && '🔄 Reconnecting…'}
        </div>
      )}

      {(() => {
        const checked = messages.filter((m) => m.role === 'user' && m.feedback);
        const correct = checked.filter((m) => m.feedback!.is_correct);
        if (checked.length === 0) return null;
        const rate = Math.round((correct.length / checked.length) * 100);
        const color = rate >= 80 ? 'var(--success, #22c55e)' : rate >= 50 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)';
        return (
          <div style={{ padding: '4px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: 'var(--text-secondary)', background: 'var(--bg-secondary, #f9fafb)', borderBottom: '1px solid var(--border, #e5e7eb)' }}>
            <span>📝 Grammar: <strong style={{ color }}>{correct.length}/{checked.length}</strong> correct (<strong style={{ color }}>{rate}%</strong>){(grammarStreak >= 2 || bestGrammarStreak >= 2) && <>{' '}<GrammarStreakBadge currentStreak={grammarStreak} bestStreak={bestGrammarStreak} /></>}<LiveFluencyRing messages={messages} /></span>
            <span>
              {messages.filter((m) => m.role === 'user').length} messages sent
              {wpmValues.length > 0 && (() => {
                const avgWpm = Math.round(wpmValues.reduce((a, b) => a + b, 0) / wpmValues.length);
                const wpmColor = avgWpm >= 100 ? 'var(--success, #22c55e)' : avgWpm >= 60 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)';
                return <> · <span title="Average typing pace">🗣️ <strong style={{ color: wpmColor }}>{avgWpm}</strong> WPM</span></>;
              })()}
              {listenMode && (() => {
                const assistantCount = messages.filter((m) => m.role === 'assistant').length;
                const listenAccuracy = listenTotal > 0 ? Math.round((listenCorrect / listenTotal) * 100) : null;
                const listenColor = listenAccuracy !== null ? (listenAccuracy >= 80 ? 'var(--success, #22c55e)' : listenAccuracy >= 50 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)') : '';
                return assistantCount > 0 ? (
                  <>
                    {` · 👁 ${revealedMessages.size}/${assistantCount} revealed`}
                    {listenAccuracy !== null && (
                      <> · <span title="Listening cloze accuracy">🎧 <strong style={{ color: listenColor }}>{listenCorrect}/{listenTotal}</strong> ({listenAccuracy}%)</span></>
                    )}
                  </>
                ) : '';
              })()}
              {fillerCount > 0 && (
                <> · <FillerWordBadge fillerCount={fillerCount} fillerDetails={fillerDetails} /></>
              )}
            </span>
          </div>
        );
      })()}

      {showGrammarPanel && (
        <GrammarNotesPanel notes={allGrammarNotes} onSpeak={tts.speak} onClose={() => setShowGrammarPanel(false)} />
      )}

      {vocabTargets.length > 0 && (
        <VocabTargetBar targetWords={vocabTargets} usedWords={usedVocabWords} onSpeak={tts.speak} />
      )}

      {sessionGoals.length > 0 && phase === 'chat' && (
        <GoalTracker selectedGoals={sessionGoals} messages={messages} />
      )}

      {phase === 'chat' && correctionAttempts > 0 && (
        <div style={{ margin: '8px 0', padding: '6px 12px', borderRadius: 8, background: correctionSuccesses > 0 ? '#dcfce7' : '#fef3c7', fontSize: '0.8rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          ✏️ Corrections practiced: {correctionSuccesses}/{correctionAttempts}
        </div>
      )}

      {phase === 'chat' && (
        <ResponseTimer
          isSpeaking={tts.isSpeaking}
          lastAssistantIndex={messages.filter(m => m.role === 'assistant').length - 1}
          userMessageCount={messages.filter(m => m.role === 'user').length}
          onTimeRecord={(sec) => setResponseTimes(prev => [...prev, sec])}
        />
      )}

      {(() => {
        const checked = messages.filter((m) => m.role === 'user' && m.feedback);
        const correct = checked.filter((m) => m.feedback!.is_correct);
        return (
          <ConversationCoach
            messages={messages}
            grammarCorrect={correct.length}
            grammarTotal={checked.length}
            wpmValues={wpmValues}
            responseTimeValues={responseTimes}
            errorPatterns={errorPatterns}
          />
        );
      })()}

      <div className="chat-messages" role="log" aria-live="polite">
        {showBriefing && userRoleName && (
          <div style={{ margin: '0 0 12px', padding: 12, background: 'var(--primary-light, #e8f0fe)', border: '1px solid var(--primary)', borderRadius: 10, position: 'relative' }}>
            <button onClick={() => setShowBriefing(false)} aria-label="Dismiss briefing" style={{ position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-secondary)' }}>✕</button>
            <div style={{ fontWeight: 600, marginBottom: 6, fontSize: '0.95rem' }}>🏷️ You are {userRoleName}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 8 }}>Try using these professional phrases:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {roleBriefing.map((phrase, i) => (
                <button key={i} onClick={() => setInput(phrase)} style={{ padding: '4px 10px', borderRadius: 16, border: '1px solid var(--primary)', background: 'white', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.8rem' }}>{phrase}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i}>
            <div className={`message message-${msg.role}`}>
              {msg.role === 'assistant' ? (
                listenMode && !revealedMessages.has(i) ? (
                  <ListenModeCloze
                    content={msg.content}
                    onComplete={(correct, total) => {
                      setRevealedMessages((prev) => new Set(prev).add(i));
                      if (total > 0) {
                        setListenCorrect((c) => c + correct);
                        setListenTotal((t) => t + total);
                      }
                    }}
                  />
                ) : (
                  <HighlightedMessage content={msg.content} keyPhrases={msg.key_phrases} grammarNotes={msg.grammar_notes} onSpeak={tts.speak} onSavePhrase={handleSavePhrase} savedPhrases={savedChatPhrases} />
                )
              ) : (
                msg.content
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', padding: '0 8px' }}>
              <button
                onClick={() => tts.speak(msg.content)}
                disabled={tts.isSpeaking}
                aria-label={`Listen to ${msg.role} message`}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: tts.isSpeaking ? 'default' : 'pointer',
                  padding: '2px 4px',
                  opacity: tts.isSpeaking ? 0.4 : 0.6,
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={(e) => { if (!tts.isSpeaking) e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={(e) => { if (!tts.isSpeaking) e.currentTarget.style.opacity = '0.6'; }}
              >
                <Volume2 size={14} color="var(--primary, #6366f1)" />
              </button>
              {msg.role === 'assistant' && (
                <button
                  onClick={() => tts.speak(msg.content, 'en-US', 0.6)}
                  disabled={tts.isSpeaking}
                  aria-label="Slow replay (0.6×)"
                  title="Slow replay (0.6×)"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: tts.isSpeaking ? 'default' : 'pointer',
                    padding: '2px 4px',
                    marginLeft: 2,
                    opacity: tts.isSpeaking ? 0.4 : 0.6,
                    transition: 'opacity 0.15s',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 2,
                  }}
                  onMouseEnter={(e) => { if (!tts.isSpeaking) e.currentTarget.style.opacity = '1'; }}
                  onMouseLeave={(e) => { if (!tts.isSpeaking) e.currentTarget.style.opacity = '0.6'; }}
                >
                  <Headphones size={14} color="var(--primary, #6366f1)" />
                  <span style={{ fontSize: 10, color: 'var(--primary, #6366f1)' }}>🐢</span>
                </button>
              )}
            </div>
            {msg.feedback && <FeedbackPanel feedback={msg.feedback} onSpeak={tts.speak} onCorrectionAttempt={(success) => {
              setCorrectionAttempts(p => p + 1);
              if (success) setCorrectionSuccesses(p => p + 1);
            }} />}
          </div>
        ))}
        {sendError && (
          <div style={{
            margin: '8px 16px',
            padding: '10px 14px',
            borderRadius: 10,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
          role="alert"
          >
            <span style={{ flex: 1 }}>⚠️ {sendError}</span>
            {failedMessage && (
              <button
                onClick={() => sendMessage(failedMessage)}
                disabled={loading}
                aria-label="Retry sending message"
                style={{
                  padding: '4px 14px',
                  borderRadius: 8,
                  border: '1px solid #b91c1c',
                  background: '#fff',
                  color: '#b91c1c',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  flexShrink: 0,
                }}
              >
                🔄 Retry
              </button>
            )}
          </div>
        )}
        {loading && (
          <div className="message message-assistant">
            <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2, margin: 0 }} />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {speech.error && (
        <div style={{ padding: '8px 16px', background: '#fef2f2', color: '#b91c1c', fontSize: 13, borderTop: '1px solid #fecaca' }}>
          {speech.error}
        </div>
      )}
      {phraseSuggestions.length === 0 && helpersLoading && !loading && !input.trim() && (
        <div
          aria-label="Loading reply suggestions"
          aria-live="polite"
          style={{ padding: '6px 16px', fontSize: 12, color: 'var(--muted, #94a3b8)', borderTop: '1px solid var(--border, #e2e8f0)' }}
        >
          Loading reply suggestions…
        </div>
      )}
      {phraseSuggestions.length > 0 && !loading && !input.trim() && (
        <div style={{ display: 'flex', gap: 8, padding: '8px 16px', overflowX: 'auto', borderTop: '1px solid var(--border, #e2e8f0)' }} aria-label="Reply suggestions">
          {phraseSuggestions.map((phrase, i) => (
            <button
              key={i}
              className="btn"
              onClick={() => { setInput(phrase); setPhraseSuggestions([]); }}
              style={{
                whiteSpace: 'nowrap',
                padding: '6px 14px',
                fontSize: 13,
                borderRadius: 20,
                border: '1px solid var(--primary, #3b82f6)',
                background: 'transparent',
                color: 'var(--primary, #3b82f6)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {phrase}
            </button>
          ))}
        </div>
      )}
      {hintText && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            background: 'var(--hint-bg, #fefce8)',
            borderTop: '1px solid var(--hint-border, #fde68a)',
            fontSize: 13,
            color: 'var(--hint-text, #92400e)',
          }}
          role="status"
          aria-label="Conversation hint"
        >
          <Lightbulb size={16} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{hintText}</span>
          <button
            onClick={() => setHintText(null)}
            aria-label="Dismiss hint"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 2,
              color: 'var(--hint-text, #92400e)',
              flexShrink: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="chat-input-bar" style={{ gap: 12, alignItems: 'center' }}>
        <button
          className={`btn btn-icon ${speech.isListening ? 'mic-active' : 'btn-secondary'}`}
          onClick={speech.isListening ? speech.stop : speech.start}
          disabled={!speech.isSupported || loading}
          title={speech.isSupported ? (speech.isListening ? 'Stop listening' : 'Start speaking') : 'Speech recognition not supported'}
          aria-label={speech.isListening ? 'Stop listening' : 'Start speaking'}
          style={{ width: 48, height: 48, flexShrink: 0 }}
        >
          {speech.isListening ? <MicOff size={22} color="white" /> : <Mic size={22} />}
        </button>

        <button
          className="btn btn-icon btn-secondary"
          onClick={fetchHint}
          disabled={loading || hintLoading || hintUsedThisTurn}
          title={hintUsedThisTurn ? 'Hint already used this turn' : 'Get a hint'}
          aria-label="Get a hint"
          style={{ width: 48, height: 48, flexShrink: 0, position: 'relative' }}
        >
          {hintLoading ? (
            <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2, margin: 0 }} />
          ) : (
            <Lightbulb size={22} />
          )}
        </button>

        <div style={{ flex: 1, position: 'relative' }}>
          <input
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); if (failedMessage) { setFailedMessage(null); setSendError(null); } }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && input.trim() && !loading) sendMessage(); }}
            placeholder={speech.isListening ? 'Listening...' : 'Type your message or use the mic'}
            disabled={loading}
            aria-label="Message input"
            style={{
              width: '100%',
              padding: '10px 14px',
              border: '1px solid var(--border, #e2e8f0)',
              borderRadius: 8,
              outline: 'none',
              background: 'var(--bg, #fff)',
              color: 'var(--text)',
            }}
          />
          {speech.interimTranscript && (
            <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--text-secondary)', pointerEvents: 'none' }}>
              {speech.interimTranscript}
            </span>
          )}
        </div>

        <button
          className="btn btn-primary btn-icon"
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          aria-label="Send message"
          style={{ width: 48, height: 48, flexShrink: 0 }}
        >
          <Send size={22} />
        </button>
      </div>

      {/* Navigation guard dialog */}
      {blocker.state === 'blocked' && (
        <div
          role="alertdialog"
          aria-label="Navigation blocked"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)',
          }}
        >
          <div style={{ maxWidth: 420, width: '90%' }}>
            <ConfirmDialog
              message="You have an active conversation. Leaving will end it."
              confirmLabel="End & Leave"
              cancelLabel="Stay in Chat"
              onConfirm={async () => {
                await endConversation();
                blocker.proceed?.();
              }}
              onCancel={() => blocker.reset?.()}
            />
          </div>
        </div>
      )}
    </div>
    </PhaseTransition>
  );
}
