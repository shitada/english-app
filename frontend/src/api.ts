export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY = 500;

function jitteredDelay(attempt: number): number {
  const base = BASE_DELAY * Math.pow(2, attempt);
  const jitter = base * 0.25 * (Math.random() * 2 - 1);
  return Math.max(0, base + jitter);
}

const retryEvent = new EventTarget();
export const onRetryStateChange = (cb: (retrying: boolean) => void) => {
  const onStart = () => cb(true);
  const onEnd = () => cb(false);
  retryEvent.addEventListener('retry-start', onStart);
  retryEvent.addEventListener('retry-end', onEnd);
  return () => {
    retryEvent.removeEventListener('retry-start', onStart);
    retryEvent.removeEventListener('retry-end', onEnd);
  };
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });
      if (!res.ok) {
        if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
          if (attempt === 0) retryEvent.dispatchEvent(new Event('retry-start'));
          await new Promise((r) => setTimeout(r, jitteredDelay(attempt)));
          continue;
        }
        const text = await res.text();
        throw new ApiError(res.status, `API error ${res.status}: ${text}`);
      }
      if (attempt > 0) retryEvent.dispatchEvent(new Event('retry-end'));
      return res.json();
    } catch (err) {
      if (err instanceof ApiError) {
        if (attempt > 0) retryEvent.dispatchEvent(new Event('retry-end'));
        throw err;
      }
      lastError = err as Error;
      if (attempt < MAX_RETRIES) {
        if (attempt === 0) retryEvent.dispatchEvent(new Event('retry-start'));
        await new Promise((r) => setTimeout(r, jitteredDelay(attempt)));
      }
    }
  }
  retryEvent.dispatchEvent(new Event('retry-end'));
  throw lastError ?? new Error('Request failed after retries');
}

// Conversation
export const api = {
  // Topics
  getConversationTopics: () => request<{ id: string; label: string; description: string; is_custom?: boolean }[]>('/api/conversation/topics'),
  getFavoriteTopics: () => request<{ favorites: string[] }>('/api/conversation/topics/favorites'),
  toggleTopicFavorite: (topicId: string) => request<{ topic_id: string; is_favorite: boolean; favorites: string[] }>(`/api/conversation/topics/${topicId}/favorite`, { method: 'PUT' }),
  getCustomTopics: () => request<{ id: string; label: string; description: string; scenario: string; goal: string }[]>('/api/conversation/custom-topics'),
  createCustomTopic: (data: { label: string; description: string; scenario: string; goal?: string }) =>
    request<{ id: string; label: string; description: string; scenario: string; goal: string }>('/api/conversation/custom-topics', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    }),
  deleteCustomTopic: (topicId: string) =>
    request<{ deleted: boolean }>(`/api/conversation/custom-topics/${topicId}`, { method: 'DELETE' }),

  // Conversation
  startConversation: (topic: string, difficulty: 'beginner' | 'intermediate' | 'advanced' = 'intermediate', roleSwap: boolean = false) =>
    request<{ conversation_id: number; message: string; topic: string; phrase_suggestions: string[]; key_phrases: string[]; grammar_notes: GrammarNote[]; user_role: string; role_briefing: string[] }>('/api/conversation/start', {
      method: 'POST',
      body: JSON.stringify({ topic, difficulty, role_swap: roleSwap }),
    }),

  sendMessage: (conversation_id: number, content: string) =>
    request<{ message: string; feedback: GrammarFeedback; phrase_suggestions: string[]; key_phrases: string[]; grammar_notes: GrammarNote[] }>('/api/conversation/message', {
      method: 'POST',
      body: JSON.stringify({ conversation_id, content }),
    }),

  endConversation: (conversation_id: number) =>
    request<{ summary: ConversationSummary }>('/api/conversation/end', {
      method: 'POST',
      body: JSON.stringify({ conversation_id }),
    }),

  getHistory: (conversation_id: number) =>
    request<{ messages: ChatMessage[] }>(`/api/conversation/${conversation_id}/history`),

  listConversations: (params?: { topic?: string; keyword?: string; limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.topic) searchParams.set('topic', params.topic);
    if (params?.keyword) searchParams.set('keyword', params.keyword);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    const qs = searchParams.toString();
    return request<ConversationListResponse>(
      `/api/conversation/list${qs ? `?${qs}` : ''}`
    );
  },

  deleteConversation: (conversation_id: number) =>
    request<{ deleted: boolean }>(`/api/conversation/${conversation_id}`, { method: 'DELETE' }),

  clearEndedConversations: () =>
    request<{ deleted_count: number }>('/api/conversation/clear/ended', { method: 'DELETE' }),

  getConversationSummary: (conversation_id: number) =>
    request<{ summary: ConversationSummary }>(`/api/conversation/${conversation_id}/summary`),

  getConversationReplay: (conversation_id: number) =>
    request<ConversationReplay>(`/api/conversation/${conversation_id}/replay`),

  generateConversationQuiz: (conversation_id: number, count = 4) =>
    request<ConversationQuizResponse>(`/api/conversation/${conversation_id}/quiz?count=${count}`, { method: 'POST' }),

  getShadowingPhrases: (conversation_id: number, limit = 6) =>
    request<{ conversation_id: number; phrases: { text: string; word_count: number }[] }>(`/api/conversation/${conversation_id}/shadowing-phrases?limit=${limit}`),

  getRephraseSentences: (conversation_id: number, limit = 5) =>
    request<{ conversation_id: number; sentences: { text: string; word_count: number }[] }>(`/api/conversation/${conversation_id}/rephrase-sentences?limit=${limit}`),

  evaluateRephrase: (original: string, user_rephrase: string) =>
    request<{ meaning_preserved: boolean; naturalness_score: number; variety_score: number; overall_score: number; feedback: string }>('/api/conversation/rephrase-evaluate', {
      method: 'POST',
      body: JSON.stringify({ original, user_rephrase }),
    }),
  evaluateRetelling: (original_summary: string, user_retelling: string) =>
    request<{ content_coverage: number; grammar_score: number; fluency_score: number; vocabulary_score: number; overall_score: number; feedback: string; model_retelling: string }>('/api/conversation/retelling/evaluate', {
      method: 'POST',
      body: JSON.stringify({ original_summary, user_retelling }),
    }),

  getTopicProgress: (conversation_id: number) =>
    request<{ has_previous: boolean; current: Record<string, number>; previous: Record<string, number> | null; deltas: Record<string, number> | null }>(`/api/conversation/${conversation_id}/topic-progress`),

  saveConversationVocabulary: (conversationId: number, words: string[]) =>
    request<{ saved_count: number; words: { word: string; meaning: string }[] }>(`/api/conversation/${conversationId}/save-vocabulary`, {
      method: 'POST',
      body: JSON.stringify({ words }),
    }),

  getConversationHint: (conversationId: number) =>
    request<{ hint: string }>(`/api/conversation/${conversationId}/hint`, { method: 'POST' }),

  saveConversationSelfAssessment: (conversationId: number, data: { confidence_rating: number; fluency_rating: number; comprehension_rating: number }) =>
    request<{ conversation_id: number; confidence_rating: number; fluency_rating: number; comprehension_rating: number; created_at: string | null }>(`/api/conversation/${conversationId}/self-assessment`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getConversationSelfAssessment: (conversationId: number) =>
    request<{ conversation_id: number; confidence_rating: number; fluency_rating: number; comprehension_rating: number; created_at: string | null }>(`/api/conversation/${conversationId}/self-assessment`),

  getExpressBetter: (conversationId: number) =>
    request<ExpressBetterResponse>(`/api/conversation/${conversationId}/express-better`, { method: 'POST' }),

  // Pronunciation
  getPronunciationSentences: (difficulty?: 'beginner' | 'intermediate' | 'advanced') => {
    const qs = difficulty ? `?difficulty=${difficulty}` : '';
    return request<{ sentences: { text: string; topic: string; difficulty: string }[] }>(`/api/pronunciation/sentences${qs}`);
  },

  checkPronunciation: (reference_text: string, user_transcription: string, difficulty?: string) =>
    request<PronunciationFeedback>('/api/pronunciation/check', {
      method: 'POST',
      body: JSON.stringify({ reference_text, user_transcription, difficulty }),
    }),

  getPronunciationHistory: () =>
    request<{ attempts: PronunciationAttempt[] }>('/api/pronunciation/history'),

  getPronunciationProgress: () =>
    request<PronunciationProgress>('/api/pronunciation/progress'),

  clearPronunciationHistory: () =>
    request<{ deleted_count: number }>('/api/pronunciation/history', { method: 'DELETE' }),

  deletePronunciationAttempt: (attemptId: number) =>
    request<{ deleted: boolean }>(`/api/pronunciation/${attemptId}`, { method: 'DELETE' }),

  getMinimalPairs: (difficulty?: string, count = 10) => {
    const params = new URLSearchParams({ count: String(count) });
    if (difficulty) params.set('difficulty', difficulty);
    return request<MinimalPairsResponse>(`/api/pronunciation/minimal-pairs?${params}`);
  },

  saveMinimalPairsResults: (results: { phoneme_contrast: string; word_a: string; word_b: string; is_correct: boolean }[]) =>
    request<{ saved: number }>('/api/pronunciation/minimal-pairs/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results }),
    }),

  getMinimalPairsStats: (limit = 20) =>
    request<PhonemeContrastStat[]>(`/api/pronunciation/minimal-pairs/stats?limit=${limit}`),

  generateListeningQuiz: (difficulty: string = 'intermediate', questionCount = 5, topic?: string) => {
    let url = `/api/pronunciation/listening-quiz?difficulty=${difficulty}&question_count=${questionCount}`;
    if (topic) url += `&topic=${encodeURIComponent(topic)}`;
    return request<ListeningQuizResponse>(url, { method: 'POST' });
  },

  getQuickSpeakPrompt: (difficulty: string = 'intermediate') =>
    request<{ prompt: string; context_hint: string; difficulty: string; suggested_phrases: string[] }>(`/api/pronunciation/quick-speak?difficulty=${difficulty}`),

  evaluateQuickSpeak: (prompt: string, transcript: string, duration_seconds: number) =>
    request<{ fluency_score: number; relevance_score: number; grammar_score: number; vocabulary_score: number; overall_score: number; word_count: number; wpm: number; feedback: string; suggestions: string[] }>('/api/pronunciation/quick-speak/evaluate', {
      method: 'POST',
      body: JSON.stringify({ prompt, transcript, duration_seconds }),
    }),

  getListenRespondPrompt: (difficulty: string = 'intermediate') =>
    request<ListenRespondPromptResponse>(`/api/pronunciation/listen-respond-prompt?difficulty=${difficulty}`),

  getQuickRephrasePrompt: (difficulty: string = 'intermediate') =>
    request<QuickRephrasePromptResponse>(`/api/pronunciation/quick-rephrase?difficulty=${difficulty}`),

  getQuickListeningComp: (difficulty: string = 'intermediate') =>
    request<QuickListeningCompResponse>(`/api/pronunciation/quick-listening-comp?difficulty=${difficulty}`),

  getTongueTwister: (difficulty: string = 'intermediate') =>
    request<{ text: string; target_sounds: string[]; slow_hint: string; difficulty: string }>(`/api/pronunciation/tongue-twister?difficulty=${difficulty}`),

  evaluateListenRespond: (question: string, transcript: string, duration_seconds: number) =>
    request<ListenRespondEvaluateResponse>('/api/pronunciation/listen-respond/evaluate', {
      method: 'POST',
      body: JSON.stringify({ question, transcript, duration_seconds }),
    }),

  getListenParaphrasePrompt: (difficulty: string = 'intermediate') =>
    request<ListenParaphrasePromptResponse>(`/api/pronunciation/listen-paraphrase?difficulty=${difficulty}`),

  evaluateListenParaphrase: (original_sentence: string, user_paraphrase: string, duration_seconds: number) =>
    request<ListenParaphraseEvaluateResponse>('/api/pronunciation/listen-paraphrase/evaluate', {
      method: 'POST',
      body: JSON.stringify({ original_sentence, user_paraphrase, duration_seconds }),
    }),

  // Vocabulary
  getVocabularyTopics: () =>
    request<{ id: string; label: string; description: string }[]>('/api/vocabulary/topics'),

  generateQuiz: (topic: string, count = 10, mode: 'multiple_choice' | 'fill_blank' = 'multiple_choice') =>
    request<{ quiz_type: string; questions: (QuizQuestion | FillBlankQuestion)[] }>(
      `/api/vocabulary/quiz?topic=${encodeURIComponent(topic)}&count=${count}&mode=${mode}`
    ),

  submitAnswer: (word_id: number, is_correct: boolean) =>
    request<{ word_id: number; is_correct: boolean; new_level: number; next_review: string; difficulty_adjustment: DifficultyAdjustment | null }>(
      '/api/vocabulary/answer',
      { method: 'POST', body: JSON.stringify({ word_id, is_correct }) }
    ),

  getVocabularyProgress: (topic?: string) =>
    request<{ progress: VocabularyProgressItem[] }>(
      `/api/vocabulary/progress${topic ? `?topic=${encodeURIComponent(topic)}` : ''}`
    ),

  resetVocabularyProgress: (topic?: string) =>
    request<{ deleted_count: number }>(
      `/api/vocabulary/progress${topic ? `?topic=${encodeURIComponent(topic)}` : ''}`,
      { method: 'DELETE' }
    ),

  getDrillWords: (count = 10) =>
    request<{ words: { id: number; word: string; meaning: string; topic: string; difficulty: number; example_sentence: string }[]; count: number }>(
      `/api/vocabulary/drill?count=${count}`
    ),

  // Dashboard
  getDashboardStats: () => request<DashboardStats>('/api/dashboard/stats'),

  getSkillRadar: () => request<{ skills: { name: string; score: number; label: string }[] }>('/api/dashboard/skill-radar'),

  getActivityHistory: (days = 30) =>
    request<ActivityHistoryResponse>(`/api/dashboard/activity-history?days=${days}`),

  getStreakMilestones: () =>
    request<StreakMilestonesResponse>('/api/dashboard/streak-milestones'),

  getConversationDuration: () =>
    request<ConversationDurationResponse>('/api/dashboard/conversation-duration'),

  getDashboardVocabForecast: (limit = 20) =>
    request<VocabForecastResponse>(`/api/dashboard/vocabulary-forecast?limit=${limit}`),

  getDashboardLearningVelocity: (weeks = 8) =>
    request<LearningVelocityResponse>(`/api/dashboard/learning-velocity?weeks=${weeks}`),

  getDashboardGrammarWeakSpots: (limit = 10) =>
    request<GrammarWeakSpotsResponse>(`/api/dashboard/grammar-weak-spots?limit=${limit}`),

  getDashboardModuleStreaks: () =>
    request<ModuleStreaksResponse>('/api/dashboard/module-streaks'),

  getDashboardVocabActivation: (limit = 20) =>
    request<VocabularyActivationResponse>(`/api/dashboard/vocabulary-activation?limit=${limit}`),

  getDashboardTopicCoverage: () =>
    request<TopicCoverageResponse>('/api/dashboard/topic-coverage'),

  getDashboardFluencyProgression: (limit = 30) =>
    request<FluencyProgressionResponse>(`/api/dashboard/fluency-progression?limit=${limit}`),

  getDashboardSelfAssessmentTrend: (limit = 20) =>
    request<SelfAssessmentTrendResponse>(`/api/dashboard/self-assessment-trend?limit=${limit}`),

  // Pronunciation weak spots
  getPronunciationWeaknesses: (limit = 10) =>
    request<PronunciationWeaknessesResponse>(`/api/pronunciation/weaknesses?limit=${limit}`),
  getPronunciationCommonMistakes: (limit = 10) =>
    request<CommonMistakesResponse>(`/api/pronunciation/common-mistakes?limit=${limit}`),

  // Conversation export
  exportConversation: (conversationId: number) =>
    request<ConversationExport>(`/api/conversation/${conversationId}/export`),

  // Pronunciation extras
  getPronunciationScoreTrend: () =>
    request<ScoreTrendResponse>('/api/pronunciation/trend'),

  getPronunciationDistribution: () =>
    request<ScoreDistributionResponse>('/api/pronunciation/distribution'),

  getPronunciationDifficultyProgress: () =>
    request<PronunciationDifficultyProgressResponse>('/api/pronunciation/difficulty-progress'),

  // Vocabulary extras
  getVocabularyForecast: (days = 14) =>
    request<ReviewForecastResponse>(`/api/vocabulary/forecast?days=${days}`),

  getVocabularyAttempts: (params?: { wordId?: number; topic?: string; limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.wordId) searchParams.set('word_id', String(params.wordId));
    if (params?.topic) searchParams.set('topic', params.topic);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    const qs = searchParams.toString();
    return request<AttemptHistoryResponse>(
      `/api/vocabulary/attempts${qs ? `?${qs}` : ''}`
    );
  },

  getTopicAccuracy: () =>
    request<TopicAccuracyResponse>('/api/vocabulary/topic-accuracy'),
};

// Types
export interface GrammarFeedback {
  corrected_text: string;
  is_correct: boolean;
  errors: { original: string; correction: string; explanation: string }[];
  suggestions: { original: string; better: string; explanation: string }[];
}

export interface GrammarNote {
  phrase: string;
  grammar_point: string;
  explanation: string;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  feedback?: GrammarFeedback | null;
  is_bookmarked: boolean;
}

export interface DifficultyAdjustment {
  word_id: number;
  old_difficulty: number;
  new_difficulty: number;
  reason: string;
}

export interface ConversationSummary {
  summary: string;
  key_vocabulary: string[];
  communication_level: string;
  tip: string;
  performance?: {
    total_user_messages: number;
    grammar_checked: number;
    grammar_correct: number;
    grammar_accuracy_rate: number;
  };
}

export interface ReplayTurn {
  turn_number: number;
  user_message: string | null;
  user_timestamp: string | null;
  assistant_message: string | null;
  assistant_timestamp: string | null;
  feedback: Record<string, unknown> | null;
  corrections: { original: string; correction: string; explanation: string }[];
}

export interface ConversationReplay {
  conversation: {
    id: number;
    topic: string;
    difficulty: string;
    started_at: string;
    ended_at: string | null;
    status: string;
  };
  turns: ReplayTurn[];
  total_turns: number;
}

export interface ConversationQuizQuestion {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

export interface ConversationQuizResponse {
  conversation_id: number;
  questions: ConversationQuizQuestion[];
}

export interface ListeningQuizQuestion {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

export interface ListeningQuizResponse {
  title: string;
  passage: string;
  questions: ListeningQuizQuestion[];
}

export interface PronunciationFeedback {
  overall_score: number | null;
  overall_feedback: string;
  fluency_score?: number;
  fluency_feedback?: string;
  word_feedback: {
    expected: string;
    heard: string;
    is_correct: boolean;
    tip: string;
    phoneme_issues?: { target?: string; produced?: string; tip?: string; position?: string }[];
  }[];
  focus_areas: string[];
}

export interface QuizQuestion {
  id: number;
  word: string;
  meaning: string;
  correct_meaning?: string;
  example_sentence: string;
  difficulty: number;
  wrong_options: string[];
}

export interface FillBlankQuestion {
  id: number;
  meaning: string;
  example_with_blank: string;
  hint: string;
  answer: string;
  difficulty: number;
}

export interface VocabularyProgressItem {
  word: string;
  topic: string;
  correct_count: number;
  incorrect_count: number;
  level: number;
  last_reviewed: string;
  next_review_at: string;
}

export interface DashboardStats {
  streak: number;
  total_conversations: number;
  total_messages: number;
  total_pronunciation: number;
  avg_pronunciation_score: number;
  total_vocab_reviewed: number;
  vocab_mastered: number;
  vocab_due_count: number;
  conversations_by_difficulty: { difficulty: string; count: number }[];
  grammar_accuracy: number;
  vocab_level_distribution: { level: number; count: number }[];
  conversations_by_topic: { topic: string; count: number }[];
  recent_activity: { type: string; detail: string; timestamp: string }[];
}

export interface ConversationListItem {
  id: number;
  topic: string;
  topic_id: string;
  difficulty: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  message_count: number;
  duration_seconds: number | null;
}

export interface ConversationListResponse {
  conversations: ConversationListItem[];
  total_count: number;
  has_more: boolean;
}

export interface ConversationExport {
  id: number;
  topic: string;
  difficulty: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  summary: unknown;
  messages: { role: string; content: string; feedback: unknown; created_at: string }[];
}

export interface ScoreTrendResponse {
  trend: 'improving' | 'declining' | 'stable' | 'insufficient_data';
  recent_avg: number;
  previous_avg: number;
  change: number;
}

export interface ScoreDistributionItem {
  bucket: string;
  label: string;
  min_score: number;
  max_score: number;
  count: number;
}

export interface ScoreDistributionResponse {
  total_attempts: number;
  distribution: ScoreDistributionItem[];
}

export interface ReviewForecastResponse {
  overdue_count: number;
  total_upcoming: number;
  daily_forecast: { date: string; count: number }[];
}

export interface AttemptHistoryResponse {
  total_count: number;
  attempts: { id: number; word_id: number; word: string; topic: string; is_correct: boolean; answered_at: string }[];
}

export interface TopicAccuracyResponse {
  topics: { topic: string; correct_count: number; incorrect_count: number; total_attempts: number; accuracy_rate: number }[];
}

export interface ActivityHistoryResponse {
  days: number;
  history: { date: string; conversations: number; messages: number; pronunciation_attempts: number; vocabulary_reviews: number; speaking_journal_entries: number; listening_quizzes: number }[];
}

export interface StreakMilestonesResponse {
  current_streak: number;
  longest_streak: number;
  milestones: { days: number; label: string; achieved: boolean }[];
  next_milestone: { days: number; label: string; days_remaining: number } | null;
  freeze_earned: number;
  freeze_used: number;
  freeze_available: number;
}

export interface ConversationDurationResponse {
  total_completed: number;
  total_duration_seconds: number;
  avg_duration_seconds: number;
  shortest_duration_seconds: number;
  longest_duration_seconds: number;
  duration_by_difficulty: { difficulty: string; count: number; avg_duration_seconds: number }[];
}

export interface PronunciationAttempt {
  id: number;
  reference_text: string;
  user_transcription: string;
  feedback: PronunciationFeedback | null;
  score: number | null;
  difficulty: string | null;
  created_at: string;
}

export interface PronunciationProgress {
  total_attempts: number;
  avg_score: number;
  best_score: number;
  scores_by_date: { date: string; avg_score: number; count: number }[];
  most_practiced: { text: string; attempt_count: number; avg_score: number }[];
}

export interface PronunciationDifficultyItem {
  difficulty: string;
  attempt_count: number;
  avg_score: number;
  best_score: number;
  latest_score: number;
}

export interface PronunciationDifficultyProgressResponse {
  items: PronunciationDifficultyItem[];
}

// Rate limit headers (from iteration 86)
export interface RateLimitHeaders {
  limit: number;
  remaining: number;
  window: number;
}

export function parseRateLimitHeaders(headers: Headers): RateLimitHeaders | null {
  const limit = headers.get("X-RateLimit-Limit");
  const remaining = headers.get("X-RateLimit-Remaining");
  const window = headers.get("X-RateLimit-Window");
  if (!limit || !remaining || !window) return null;
  return { limit: parseInt(limit), remaining: parseInt(remaining), window: parseInt(window) };
}

// Grammar accuracy (from iteration 87)
export interface GrammarAccuracyResponse {
  total_checked: number;
  total_correct: number;
  overall_accuracy_rate: number;
  by_topic: {
    topic: string;
    total_messages: number;
    correct_messages: number;
    accuracy_rate: number;
    total_errors: number;
  }[];
}

export async function getGrammarAccuracy(): Promise<GrammarAccuracyResponse> {
  return request<GrammarAccuracyResponse>("/api/conversation/grammar-accuracy");
}

// Word notes (from iteration 88)
export interface WordWithNotes {
  id: number;
  topic: string;
  word: string;
  meaning: string;
  example_sentence: string;
  difficulty: number;
  is_favorite: number;
  notes: string | null;
}

export async function updateWordNotes(wordId: number, notes: string | null): Promise<WordWithNotes> {
  return request<WordWithNotes>(`/api/vocabulary/${wordId}/notes`, {
    method: "PUT",
    body: JSON.stringify({ notes }),
  });
}

// Weekly pronunciation progress (from iteration 89)
export interface WeeklyProgressResponse {
  weeks: { week: string; attempt_count: number; avg_score: number; best_score: number }[];
  total_weeks: number;
  improvement: number;
}

export interface MinimalPairItem {
  word_a: string;
  word_b: string;
  phoneme_contrast: string;
  example_a: string;
  example_b: string;
  difficulty: string;
  play_word: string;
}

export interface MinimalPairsResponse {
  pairs: MinimalPairItem[];
  total: number;
}

export interface PhonemeContrastStat {
  phoneme_contrast: string;
  attempts: number;
  correct: number;
  accuracy: number;
}

export async function getPronunciationWeeklyProgress(weeks?: number): Promise<WeeklyProgressResponse> {
  const params = weeks ? `?weeks=${weeks}` : "";
  return request<WeeklyProgressResponse>(`/api/pronunciation/weekly-progress${params}`);
}

// Topic recommendations (from iteration 90)
export interface TopicRecommendation {
  topic: string;
  topic_id: string;
  session_count: number;
  last_practiced: string | null;
  accuracy: number | null;
  reason: "never_practiced" | "continue_practice" | "low_accuracy";
  reason_text: string;
  priority: number;
}

export async function getTopicRecommendations(): Promise<TopicRecommendation[]> {
  return request<TopicRecommendation[]>("/api/conversation/topic-recommendations");
}

// Learning insights (from iteration 206)
export interface ModuleStrengths {
  conversation: number;
  vocabulary: number;
  pronunciation: number;
}

export interface WeeklyModuleComparison {
  this_week: number;
  last_week: number;
}

export interface WeeklyComparison {
  conversations: WeeklyModuleComparison;
  vocabulary: WeeklyModuleComparison;
  pronunciation: WeeklyModuleComparison;
  listening: WeeklyModuleComparison;
  speaking_journal: WeeklyModuleComparison;
}

export interface LearningInsights {
  streak: number;
  streak_at_risk: boolean;
  module_strengths: ModuleStrengths;
  strongest_area: string | null;
  weakest_area: string | null;
  recommendations: string[];
  weekly_comparison: WeeklyComparison;
}

export async function getLearningInsights(): Promise<LearningInsights> {
  return request<LearningInsights>("/api/dashboard/insights");
}

// Learning goals (from iteration 92)
export interface LearningGoal {
  id: number;
  goal_type: "conversations" | "vocabulary_reviews" | "pronunciation_attempts" | "speaking_journal_entries" | "listening_quizzes";
  daily_target: number;
  created_at: string;
  updated_at: string;
  today_count: number;
  completed: boolean;
}

export async function getLearningGoals(): Promise<LearningGoal[]> {
  return request<LearningGoal[]>("/api/dashboard/goals");
}

export async function setLearningGoal(goalType: string, dailyTarget: number): Promise<LearningGoal> {
  return request<LearningGoal>("/api/dashboard/goals", {
    method: "POST",
    body: JSON.stringify({ goal_type: goalType, daily_target: dailyTarget }),
  });
}

export async function deleteLearningGoal(goalType: string): Promise<void> {
  await request<unknown>(`/api/dashboard/goals/${goalType}`, { method: "DELETE" });
}

export interface TodayActivity {
  conversations: number;
  vocabulary_reviews: number;
  pronunciation_attempts: number;
  listening_quizzes: number;
  speaking_journal_entries: number;
}

export async function getTodayActivity(): Promise<TodayActivity> {
  return request<TodayActivity>("/api/dashboard/today");
}

// Word detail (from iteration 94)
export interface WordDetail {
  id: number;
  topic: string;
  word: string;
  meaning: string;
  example_sentence: string;
  difficulty: number;
  is_favorite: number;
  notes: string | null;
  progress: {
    correct_count: number;
    incorrect_count: number;
    level: number;
    last_reviewed: string;
    next_review_at: string;
  } | null;
  similar_words: { id: number; word: string; meaning: string; difficulty: number }[];
}

export async function getWordDetail(wordId: number): Promise<WordDetail> {
  return request<WordDetail>(`/api/vocabulary/${wordId}/detail`);
}

// Conversation message bookmarks (from iteration 96)
export interface BookmarkedMessage {
  id: number;
  conversation_id: number;
  role: 'user' | 'assistant';
  content: string;
  is_bookmarked: number;
  created_at: string;
  topic?: string;
}

export interface BookmarkedMessagesResponse {
  items: BookmarkedMessage[];
  total: number;
  limit: number;
  offset: number;
}

export async function toggleMessageBookmark(messageId: number): Promise<BookmarkedMessage> {
  return request<BookmarkedMessage>(`/api/conversation/messages/${messageId}/bookmark`, { method: 'PUT' });
}

export async function getBookmarkedMessages(params?: {
  conversation_id?: number;
  limit?: number;
  offset?: number;
}): Promise<BookmarkedMessagesResponse> {
  const sp = new URLSearchParams();
  if (params?.conversation_id) sp.set('conversation_id', String(params.conversation_id));
  if (params?.limit) sp.set('limit', String(params.limit));
  if (params?.offset) sp.set('offset', String(params.offset));
  const qs = sp.toString();
  return request<BookmarkedMessagesResponse>(`/api/conversation/bookmarks${qs ? `?${qs}` : ''}`);
}

// Difficulty recommendation (from iteration 315)
export interface DifficultyRecommendation {
  current_difficulty: string;
  recommended_difficulty: string;
  reason: string;
  stats: { accuracy: number; avg_words: number; sessions_analyzed: number };
}

export async function getDifficultyRecommendation(): Promise<DifficultyRecommendation> {
  return request<DifficultyRecommendation>('/api/conversation/difficulty-recommendation');
}

// Dictation mode (from iteration 250)
export interface DictationWordResult {
  expected: string;
  typed: string;
  is_correct: boolean;
}

export interface DictationResult {
  score: number;
  total_words: number;
  correct_words: number;
  word_results: DictationWordResult[];
}

export async function checkDictation(
  reference_text: string,
  user_typed_text: string,
): Promise<DictationResult> {
  return request<DictationResult>('/api/pronunciation/dictation-check', {
    method: 'POST',
    body: JSON.stringify({ reference_text, user_typed_text }),
  });
}

// Mistake Journal (from iteration 251)
export interface MistakeItem {
  module: 'grammar' | 'pronunciation' | 'vocabulary';
  detail: Record<string, unknown>;
  created_at: string;
}

export interface MistakeJournalResponse {
  items: MistakeItem[];
  total_count: number;
}

export async function getMistakeJournal(
  module: 'all' | 'grammar' | 'pronunciation' | 'vocabulary' = 'all',
  limit = 20,
  offset = 0,
): Promise<MistakeJournalResponse> {
  const params = new URLSearchParams({ module, limit: String(limit), offset: String(offset) });
  return request<MistakeJournalResponse>(`/api/dashboard/mistakes?${params}`);
}

// Mistake Review Drill (from iteration 310)
export interface MistakeReviewItem {
  original: string;
  correction: string;
  explanation: string;
  topic: string;
  created_at: string;
}

export interface MistakeReviewResponse {
  items: MistakeReviewItem[];
  total: number;
}

export async function getMistakeReview(count = 10): Promise<MistakeReviewResponse> {
  return request<MistakeReviewResponse>(`/api/dashboard/mistakes/review?count=${count}`);
}

// Speaking Confidence Trend (from iteration 311)
export interface ConfidenceSession {
  conversation_id: number;
  topic: string;
  difficulty: string;
  started_at: string;
  score: number;
  grammar_score: number;
  diversity_score: number;
  complexity_score: number;
  participation_score: number;
}

export interface ConfidenceTrendResponse {
  sessions: ConfidenceSession[];
  trend: string;
}

export async function getConfidenceTrend(limit = 20): Promise<ConfidenceTrendResponse> {
  return request<ConfidenceTrendResponse>(`/api/dashboard/confidence-trend?limit=${limit}`);
}

// Self-Assessment Trend (from iteration 549)
export interface SelfAssessmentTrendEntry {
  id: number;
  conversation_id: number;
  topic: string;
  difficulty: string;
  confidence_rating: number;
  fluency_rating: number;
  comprehension_rating: number;
  overall_rating: number;
  rolling_confidence: number;
  rolling_fluency: number;
  rolling_comprehension: number;
  rolling_overall: number;
  created_at: string;
}

export interface SelfAssessmentTrendResponse {
  entries: SelfAssessmentTrendEntry[];
  trend: string;
}

export async function getSelfAssessmentTrend(limit = 20): Promise<SelfAssessmentTrendResponse> {
  return request<SelfAssessmentTrendResponse>(`/api/dashboard/self-assessment-trend?limit=${limit}`);
}

// CEFR Level Estimate
export interface CEFRSubScores {
  grammar: number;
  vocabulary: number;
  pronunciation: number;
  fluency: number;
  listening: number;
}

export interface CEFREstimateResponse {
  level: string;
  level_label: string;
  overall_score: number;
  sub_scores: CEFRSubScores;
  progress_to_next: number;
  next_level: string;
  focus_tip: string;
}

export function getCEFREstimate(): Promise<CEFREstimateResponse> {
  return request<CEFREstimateResponse>('/api/dashboard/cefr-estimate');
}

// Daily Challenge (from iteration 312)
export interface DailyChallenge {
  challenge_type: string;
  title: string;
  description: string;
  target_count: number;
  current_count: number;
  completed: boolean;
  route: string;
  topic: string;
}

export async function getDailyChallenge(): Promise<DailyChallenge> {
  return request<DailyChallenge>('/api/dashboard/daily-challenge');
}

// Word of the Day (from iteration 313)
export interface WordOfTheDay {
  word_id: number;
  word: string;
  meaning: string;
  example_sentence: string;
  topic: string;
  difficulty: string | number | null;
}

export async function getWordOfTheDay(): Promise<WordOfTheDay | null> {
  const res = await fetch('/api/dashboard/word-of-the-day');
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export interface PhraseOfTheDay {
  phrase: string;
  topic: string;
  source: string;
}

export async function getPhraseOfTheDay(): Promise<PhraseOfTheDay | null> {
  const res = await fetch('/api/dashboard/phrase-of-the-day');
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Sentence Build exercises (from iteration 252)
export interface SentenceBuildExercise {
  word_id: number;
  hint_word: string;
  scrambled_words: string[];
  correct_sentence: string;
  difficulty: number;
}

export interface SentenceBuildCheckResult {
  is_correct: boolean;
  correct_sentence: string;
  word_id: number;
}

export async function getSentenceBuildExercises(
  topic: string,
  count = 8,
): Promise<{ exercises: SentenceBuildExercise[]; count: number }> {
  return request<{ exercises: SentenceBuildExercise[]; count: number }>(
    `/api/vocabulary/sentence-build?topic=${encodeURIComponent(topic)}&count=${count}`,
  );
}

export async function checkSentenceBuild(
  word_id: number,
  user_sentence: string,
): Promise<SentenceBuildCheckResult> {
  return request<SentenceBuildCheckResult>('/api/vocabulary/sentence-build/check', {
    method: 'POST',
    body: JSON.stringify({ word_id, user_sentence }),
  });
}

// Sentence Craft
export interface SentenceCraftWord {
  id: number;
  word: string;
  meaning: string;
}

export interface SentenceCraftResult {
  grammar_score: number;
  naturalness_score: number;
  word_usage: { word: string; used_correctly: boolean; feedback: string }[];
  overall_feedback: string;
  model_sentence: string;
}

export async function getSentenceCraftWords(
  topic: string,
  count = 3,
): Promise<{ words: SentenceCraftWord[]; count: number }> {
  return request<{ words: SentenceCraftWord[]; count: number }>(
    `/api/vocabulary/sentence-craft?topic=${encodeURIComponent(topic)}&count=${count}`,
  );
}

export async function evaluateSentenceCraft(
  word_ids: number[],
  user_sentence: string,
): Promise<SentenceCraftResult> {
  return request<SentenceCraftResult>('/api/vocabulary/sentence-craft/evaluate', {
    method: 'POST',
    body: JSON.stringify({ word_ids, user_sentence }),
  });
}

// Achievement badges (from iteration 253)
export interface AchievementProgress {
  current: number;
  target: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  emoji: string;
  category: string;
  target: number;
  unlocked: boolean;
  progress: AchievementProgress;
}

export interface AchievementsResponse {
  achievements: Achievement[];
  unlocked_count: number;
  total_count: number;
}

export async function getAchievements(): Promise<AchievementsResponse> {
  return request<AchievementsResponse>('/api/dashboard/achievements');
}

// ── Weekly Report ────────────────────────────────────

export interface WeeklyReport {
  week_start: string;
  week_end: string;
  conversations: number;
  messages_sent: number;
  vocabulary_reviewed: number;
  quiz_accuracy: number;
  pronunciation_attempts: number;
  avg_pronunciation_score: number;
  grammar_accuracy: number;
  speaking_journal_entries?: number;
  speaking_journal_avg_wpm?: number;
  listening_quizzes?: number;
  listening_avg_score?: number;
  streak: number;
  highlights: string[];
  text_summary: string;
}

export async function getWeeklyReport(): Promise<WeeklyReport> {
  return request<WeeklyReport>('/api/dashboard/weekly-report');
}

// ── Vocabulary Tiers ─────────────────────────────────

export interface TierWordItem {
  id: number;
  word: string;
  meaning: string;
  topic: string;
  level: number;
  correct_count: number;
  incorrect_count: number;
  error_rate: number;
}

export interface TiersResponse {
  tiers: Record<string, TierWordItem[]>;
  counts: Record<string, number>;
}

export async function getVocabularyTiers(): Promise<TiersResponse> {
  return request<TiersResponse>('/api/vocabulary/tiers');
}

// ── Grammar Trend ─────────────────────────────────

export interface GrammarTrendItem {
  conversation_id: number;
  topic: string;
  difficulty: string;
  started_at: string;
  checked_count: number;
  correct_count: number;
  accuracy_rate: number;
}

export interface GrammarTrendResponse {
  conversations: GrammarTrendItem[];
  trend: string;
}

export async function getGrammarTrend(limit = 20): Promise<GrammarTrendResponse> {
  return request<GrammarTrendResponse>(`/api/dashboard/grammar-trend?limit=${limit}`);
}

// Vocabulary stats
export interface TopicBreakdownItem {
  topic: string;
  word_count: number;
  mastered_count: number;
  avg_level: number;
}

export interface VocabularyStatsResponse {
  total_words: number;
  total_mastered: number;
  total_reviews: number;
  accuracy_rate: number;
  topic_breakdown: TopicBreakdownItem[];
}

export async function getVocabularyStats(): Promise<VocabularyStatsResponse> {
  return request<VocabularyStatsResponse>('/api/vocabulary/stats');
}

// Recent activity
export interface RecentActivityItem {
  type: string;
  detail: string;
  timestamp: string;
  route: string;
}

export interface RecentActivityResponse {
  items: RecentActivityItem[];
}

export async function getRecentActivity(limit = 5): Promise<RecentActivityResponse> {
  return request<RecentActivityResponse>(`/api/dashboard/recent-activity?limit=${limit}`);
}

// Session analytics
export interface ModuleAnalytics {
  module: string;
  total_seconds: number;
  session_count: number;
}

export interface DailyAnalytics {
  date: string;
  conversation_seconds: number;
  pronunciation_seconds: number;
  vocabulary_seconds: number;
  listening_seconds: number;
  speaking_journal_seconds: number;
}

export interface SessionAnalyticsResponse {
  modules: ModuleAnalytics[];
  daily: DailyAnalytics[];
}

export async function getSessionAnalytics(days = 7): Promise<SessionAnalyticsResponse> {
  return request<SessionAnalyticsResponse>(`/api/dashboard/session-analytics?days=${days}`);
}

// Etymology
export interface EtymologyInfo {
  origin_language: string;
  root_words: string;
  evolution: string;
  fun_fact: string;
}

export interface EtymologyResponse {
  word_id: number;
  word: string;
  etymology: EtymologyInfo;
}

export async function getWordEtymology(wordId: number): Promise<EtymologyResponse> {
  return request<EtymologyResponse>(`/api/vocabulary/${wordId}/etymology`);
}

// ── Session Averages ────────────────────────────────────

export interface SessionAveragesResponse {
  session_count: number;
  avg_grammar_accuracy_rate: number;
  avg_avg_words_per_message: number;
  avg_vocabulary_diversity: number;
  avg_total_user_messages: number;
}

export async function getSessionAverages(): Promise<SessionAveragesResponse> {
  return request<SessionAveragesResponse>('/api/conversation/session-averages');
}

// ── Listening Quiz History ────────────────────────────────────

export interface ListeningQuizResult {
  id: number;
  title: string;
  difficulty: string;
  total_questions: number;
  correct_count: number;
  score: number;
  topic: string;
  created_at: string;
  passage?: string;
  questions?: ListeningQuizQuestion[];
}

export async function saveListeningQuizResult(data: {
  title: string;
  difficulty: string;
  total_questions: number;
  correct_count: number;
  score: number;
  topic?: string;
  passage?: string;
  questions?: ListeningQuizQuestion[];
}): Promise<{ id: number; message: string }> {
  return request<{ id: number; message: string }>('/api/pronunciation/listening-quiz/results', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function getListeningQuizDetail(quizId: number): Promise<ListeningQuizResult> {
  return request<ListeningQuizResult>(`/api/pronunciation/listening-quiz/${quizId}`);
}

export interface PassageVocabWord {
  word: string;
  part_of_speech: string;
  meaning: string;
  context_sentence: string;
}

export async function extractPassageVocabulary(passage: string): Promise<{ words: PassageVocabWord[] }> {
  return request<{ words: PassageVocabWord[] }>('/api/pronunciation/passage-vocabulary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passage }),
  });
}

export async function savePassageVocabulary(words: { word: string; meaning: string; context_sentence: string }[]): Promise<{ saved_count: number }> {
  return request<{ saved_count: number }>('/api/pronunciation/passage-vocabulary/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ words }),
  });
}

export async function getListeningQuizHistory(limit = 20): Promise<ListeningQuizResult[]> {
  return request<ListeningQuizResult[]>('/api/pronunciation/listening-quiz/history?limit=' + limit);
}

export interface ListeningDifficultyRecommendation {
  recommended_difficulty: string;
  current_difficulty: string | null;
  reason: string;
  stats: { avg_score: number; quizzes_analyzed: number };
}

export async function getListeningDifficultyRecommendation(): Promise<ListeningDifficultyRecommendation> {
  return request<ListeningDifficultyRecommendation>('/api/pronunciation/listening-quiz/difficulty-recommendation');
}

// ── Listening Progress ────────────────────────────────

export interface ListeningDifficultyBreakdown {
  difficulty: string;
  count: number;
  avg_score: number;
}

export interface ListeningProgressResponse {
  total_quizzes: number;
  avg_score: number;
  best_score: number;
  by_difficulty: ListeningDifficultyBreakdown[];
  by_topic: { topic: string; count: number; avg_score: number }[];
  trend: string;
}

export async function getListeningProgress(): Promise<ListeningProgressResponse> {
  return request<ListeningProgressResponse>('/api/dashboard/listening-progress');
}

// ── Response Drill ────────────────────────────────────

export interface ResponseDrillPrompt {
  situation: string;
  speaker_says: string;
  expected_response_type: string;
  difficulty: string;
}

export interface ResponseDrillEvaluation {
  appropriateness_score: number;
  grammar_score: number;
  naturalness_score: number;
  overall_score: number;
  feedback: string;
  model_response: string;
}

export async function getResponseDrillPrompts(difficulty = 'intermediate', count = 6): Promise<{ prompts: ResponseDrillPrompt[] }> {
  return request<{ prompts: ResponseDrillPrompt[] }>('/api/pronunciation/response-drill?difficulty=' + difficulty + '&count=' + count);
}

export async function evaluateResponseDrill(data: {
  situation: string;
  speaker_says: string;
  user_response: string;
}): Promise<ResponseDrillEvaluation> {
  return request<ResponseDrillEvaluation>('/api/pronunciation/response-drill/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ── Sentence Expand Drill ────────────────────────────────────

export interface SentenceExpandSeed {
  seed: string;
  context: string;
  difficulty: string;
}

export interface SentenceExpandEvaluation {
  grammar_score: number;
  creativity_score: number;
  complexity_score: number;
  overall_score: number;
  word_count_added: number;
  feedback: string;
  model_expansion: string;
}

export async function getSentenceExpandSeeds(difficulty = 'intermediate', count = 5): Promise<{ seeds: SentenceExpandSeed[] }> {
  return request<{ seeds: SentenceExpandSeed[] }>('/api/pronunciation/sentence-expand?difficulty=' + difficulty + '&count=' + count);
}

export async function evaluateSentenceExpand(data: {
  seed: string;
  expanded: string;
}): Promise<SentenceExpandEvaluation> {
  return request<SentenceExpandEvaluation>('/api/pronunciation/sentence-expand/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ── Sentence Transform Drill ──

export interface SentenceTransformExercise {
  original_sentence: string;
  transformation_type: string;
  instruction: string;
  expected_answer: string;
  difficulty: string;
}

export interface SentenceTransformEvaluation {
  grammar_score: number;
  transformation_score: number;
  naturalness_score: number;
  overall_score: number;
  feedback: string;
  correct_version: string;
}

export async function getSentenceTransformExercises(difficulty = 'intermediate', count = 5): Promise<{ exercises: SentenceTransformExercise[] }> {
  return request<{ exercises: SentenceTransformExercise[] }>('/api/pronunciation/sentence-transform?difficulty=' + difficulty + '&count=' + count);
}

export async function evaluateSentenceTransform(data: {
  original_sentence: string;
  transformation_type: string;
  expected_answer: string;
  user_response: string;
}): Promise<SentenceTransformEvaluation> {
  return request<SentenceTransformEvaluation>('/api/pronunciation/sentence-transform/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ── Listening Spoken Q&A ──

export interface ListeningQAEvaluation {
  content_accuracy_score: number;
  grammar_score: number;
  vocabulary_score: number;
  overall_score: number;
  feedback: string;
  model_answer: string;
}

export async function evaluateListeningQA(data: {
  passage: string;
  question: string;
  correct_answer: string;
  user_spoken_answer: string;
}): Promise<ListeningQAEvaluation> {
  return request<ListeningQAEvaluation>('/api/pronunciation/listening-qa/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ── Listen-and-Summarize ──

export interface ListeningSummaryEvaluation {
  content_coverage_score: number;
  accuracy_score: number;
  grammar_score: number;
  conciseness_score: number;
  overall_score: number;
  feedback: string;
  model_summary: string;
}

export async function evaluateListeningSummary(data: {
  passage: string;
  user_summary: string;
}): Promise<ListeningSummaryEvaluation> {
  return request<ListeningSummaryEvaluation>('/api/pronunciation/listening-summary/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ── Listening Discussion ──

export interface ListeningDiscussionQuestion {
  question: string;
  hints: string[];
}

export interface ListeningDiscussionEvaluation {
  argument_score: number;
  relevance_score: number;
  grammar_score: number;
  vocabulary_score: number;
  overall_score: number;
  feedback: string;
  model_answer: string;
}

export async function getListeningDiscussionQuestion(data: {
  passage: string;
}): Promise<ListeningDiscussionQuestion> {
  return request<ListeningDiscussionQuestion>('/api/pronunciation/listening-discussion/question', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function evaluateListeningDiscussion(data: {
  passage: string;
  question: string;
  user_response: string;
  duration_seconds: number;
}): Promise<ListeningDiscussionEvaluation> {
  return request<ListeningDiscussionEvaluation>('/api/pronunciation/listening-discussion/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// --- Vocabulary Forecast (Dashboard) ---

export interface VocabForecastAtRiskWord {
  word_id: number;
  word: string;
  meaning: string;
  topic: string;
  level: number;
  risk_score: number;
  days_overdue: number;
  error_rate: number;
}

export interface VocabForecastResponse {
  at_risk_words: VocabForecastAtRiskWord[];
  total_reviewed: number;
  at_risk_count: number;
  overdue_count: number;
  avg_retention_score: number;
  recommended_review_count: number;
}

// --- Learning Velocity (Dashboard) ---

export interface WeeklyActivityData {
  week: string;
  new_words: number;
  quiz_attempts: number;
  conversations: number;
  pronunciation_attempts: number;
}

export interface CurrentPaceData {
  words_per_day: number;
  quizzes_per_day: number;
  conversations_per_day: number;
  pronunciation_per_day: number;
}

export interface LearningVelocityResponse {
  weekly_data: WeeklyActivityData[];
  current_pace: CurrentPaceData;
  trend: string;
  total_active_days: number;
  words_per_study_day: number;
}

export interface GrammarCategoryItem {
  name: string;
  total_count: number;
  recent_count: number;
  older_count: number;
  trend: string;
}

export interface GrammarWeakSpotsResponse {
  categories: GrammarCategoryItem[];
  total_errors: number;
  category_count: number;
  most_common_category: string | null;
}

export interface PronunciationWeaknessItem {
  word: string;
  occurrence_count: number;
  common_heard_as: string[][];
  tips: string[];
}

export interface PronunciationWeaknessesResponse {
  weaknesses: PronunciationWeaknessItem[];
  total: number;
}

export interface MistakePatternItem {
  target_sound: string;
  produced_sound: string;
  occurrence_count: number;
  example_words: string[];
}

export interface CommonMistakesResponse {
  patterns: MistakePatternItem[];
  total: number;
}

export interface ModuleStreakItem {
  current_streak: number;
  last_active: string | null;
}

export interface ModuleStreaksResponse {
  overall_streak: number;
  modules: Record<string, ModuleStreakItem>;
  most_consistent: string | null;
  least_consistent: string | null;
}

// ── Quick Grammar Mistake ────────────────────────────────────

export interface GrammarMistake {
  original_text: string;
  corrected_text: string;
  error_fragment: string;
  correction: string;
  explanation: string;
}

export async function getRandomGrammarMistake(): Promise<GrammarMistake> {
  return request<GrammarMistake>('/api/conversation/random-grammar-mistake');
}

// ── Vocabulary Activation Analytics ──────────────────────────

export interface ActivatedWordItem {
  word: string;
  meaning: string;
  topic: string;
  times_used: number;
  last_used_at: string | null;
}

export interface TopicActivationItem {
  topic: string;
  studied: number;
  activated: number;
  rate: number;
}

export interface VocabularyActivationResponse {
  total_studied: number;
  total_activated: number;
  activation_rate: number;
  activated_words: ActivatedWordItem[];
  unactivated_words: ActivatedWordItem[];
  by_topic: TopicActivationItem[];
}

export interface TopicCoverageItem {
  topic_id: string;
  label: string;
  description: string;
  practice_count: number;
  last_practiced_at: string | null;
  grammar_accuracy: number | null;
}

export interface TopicCoverageResponse {
  total_topics: number;
  practiced_count: number;
  coverage_rate: number;
  topics: TopicCoverageItem[];
}

export interface FluencySession {
  conversation_id: number;
  topic: string;
  date: string;
  grammar_accuracy_rate: number;
  vocabulary_diversity: number;
  avg_words_per_message: number;
  total_user_messages: number;
  fluency_score: number;
  personal_best: boolean;
}

export interface FluencyProgressionResponse {
  sessions: FluencySession[];
  session_count: number;
  trend: string;
}

export interface ListenRespondPromptResponse {
  question: string;
  difficulty: string;
  topic_hint: string;
}

export interface ListenRespondEvaluateResponse {
  comprehension_score: number;
  relevance_score: number;
  grammar_score: number;
  fluency_score: number;
  overall_score: number;
  feedback: string;
  model_answer: string;
}

export interface ListenParaphrasePromptResponse {
  sentence: string;
  difficulty: string;
  topic_hint: string;
}

export interface ListenParaphraseEvaluateResponse {
  meaning_score: number;
  grammar_score: number;
  vocabulary_score: number;
  overall_score: number;
  feedback: string;
  model_paraphrase: string;
}

export interface QuickRephrasePromptResponse {
  original_sentence: string;
  instruction: string;
  difficulty: string;
}

export interface QuickListeningCompResponse {
  passage: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  difficulty: string;
}

// ── Topic Warm-Up ──────────────────────────

export interface WarmupPhrase {
  phrase: string;
  hint: string;
}

export interface TopicWarmupResponse {
  topic: string;
  topic_label: string;
  difficulty: string;
  phrases: WarmupPhrase[];
}

export async function getTopicWarmup(topic: string, difficulty: string = 'intermediate'): Promise<TopicWarmupResponse> {
  return request<TopicWarmupResponse>('/api/conversation/topic-warmup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, difficulty }),
  });
}

// ── Vocabulary Sentence Use Evaluation ──────────────────────────

export interface EvaluateSentenceUseResponse {
  correctness: number;
  naturalness: number;
  grammar: number;
  overall_score: number;
  feedback: string;
  model_sentence: string;
}

export async function evaluateVocabSentenceUse(word: string, meaning: string, user_sentence: string): Promise<EvaluateSentenceUseResponse> {
  return request<EvaluateSentenceUseResponse>('/api/vocabulary/evaluate-sentence-use', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word, meaning, user_sentence }),
  });
}

// ── Quick Opinion Practice ──────────────────────────────────────

export interface OpinionPromptResponse {
  question: string;
  hint: string;
  difficulty: string;
  discourse_markers: string[];
}

export interface OpinionEvaluateResponse {
  argument_structure_score: number;
  coherence_score: number;
  grammar_score: number;
  vocabulary_score: number;
  overall_score: number;
  word_count: number;
  wpm: number;
  feedback: string;
  model_answer: string;
}

export function getOpinionPrompt(difficulty: string = 'intermediate'): Promise<OpinionPromptResponse> {
  return request<OpinionPromptResponse>(`/api/pronunciation/opinion-prompt?difficulty=${difficulty}`);
}

export function evaluateOpinion(question: string, transcript: string, duration_seconds: number): Promise<OpinionEvaluateResponse> {
  return request<OpinionEvaluateResponse>('/api/pronunciation/opinion-prompt/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, transcript, duration_seconds }),
  });
}

// ── Quick Question Formation ────────────────────────────────────

export interface QuestionFormationPromptResponse {
  answer_sentence: string;
  expected_question: string;
  hint: string;
  difficulty: string;
}

export interface QuestionFormationEvaluateResponse {
  grammar_score: number;
  accuracy_score: number;
  naturalness_score: number;
  overall_score: number;
  feedback: string;
  corrected_question: string;
}

export function getQuestionFormationPrompt(difficulty: string = 'intermediate'): Promise<QuestionFormationPromptResponse> {
  return request<QuestionFormationPromptResponse>(`/api/pronunciation/question-formation?difficulty=${difficulty}`);
}

export function evaluateQuestionFormation(answer_sentence: string, expected_question: string, user_question: string): Promise<QuestionFormationEvaluateResponse> {
  return request<QuestionFormationEvaluateResponse>('/api/pronunciation/question-formation/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer_sentence, expected_question, user_question }),
  });
}

// ── Quick Storytelling ────────────────────────────────────

export interface StoryPromptResponse {
  story_beginning: string;
  suggested_words: string[];
  difficulty: string;
}

export interface StoryEvaluateResponse {
  coherence_score: number;
  grammar_score: number;
  vocabulary_score: number;
  narrative_flow_score: number;
  overall_score: number;
  word_count: number;
  wpm: number;
  feedback: string;
  model_continuation: string;
}

export function getStoryPrompt(difficulty: string = 'intermediate'): Promise<StoryPromptResponse> {
  return request<StoryPromptResponse>(`/api/pronunciation/story-prompt?difficulty=${difficulty}`);
}

export function evaluateStory(story_beginning: string, transcript: string, duration_seconds: number): Promise<StoryEvaluateResponse> {
  return request<StoryEvaluateResponse>('/api/pronunciation/story-prompt/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ story_beginning, transcript, duration_seconds }),
  });
}

// ── Quick Follow-Up Question ────────────────────────────────────

export interface FollowUpPromptResponse {
  statement: string;
  topic_hint: string;
  difficulty: string;
}

export interface FollowUpEvaluateResponse {
  relevance_score: number;
  depth_score: number;
  grammar_score: number;
  naturalness_score: number;
  overall_score: number;
  word_count: number;
  wpm: number;
  feedback: string;
  model_questions: string[];
}

export function getFollowUpPrompt(difficulty: string = 'intermediate'): Promise<FollowUpPromptResponse> {
  return request<FollowUpPromptResponse>(`/api/pronunciation/follow-up-prompt?difficulty=${difficulty}`);
}

export function evaluateFollowUp(statement: string, user_question: string, duration_seconds: number): Promise<FollowUpEvaluateResponse> {
  return request<FollowUpEvaluateResponse>('/api/pronunciation/follow-up-prompt/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ statement, user_question, duration_seconds }),
  });
}

// Smart Review Queue
export interface ReviewQueueItemDetail {
  [key: string]: unknown;
}

export interface ReviewQueueItem {
  module: string;
  priority: number;
  detail: ReviewQueueItemDetail;
  route: string;
}

export interface ReviewQueueResponse {
  items: ReviewQueueItem[];
  total_count: number;
}

export function getReviewQueue(limit: number = 8): Promise<ReviewQueueResponse> {
  return request<ReviewQueueResponse>(`/api/dashboard/review-queue?limit=${limit}`);
}

// Speaking Journal
export interface SpeakingJournalEntry {
  id: number;
  prompt: string;
  transcript: string;
  word_count: number;
  unique_word_count: number;
  duration_seconds: number;
  wpm: number;
  filler_word_count: number;
  created_at: string;
}

export function getSpeakingJournalPrompt(difficulty?: string): Promise<{ prompt: string }> {
  const params = difficulty ? `?difficulty=${encodeURIComponent(difficulty)}` : '';
  return request<{ prompt: string }>(`/api/pronunciation/speaking-journal/prompt${params}`);
}

export function saveSpeakingJournalEntry(prompt: string, transcript: string, duration_seconds: number): Promise<SpeakingJournalEntry> {
  return request<SpeakingJournalEntry>('/api/pronunciation/speaking-journal', {
    method: 'POST',
    body: JSON.stringify({ prompt, transcript, duration_seconds }),
  });
}

export function getSpeakingJournalEntries(limit: number = 10): Promise<{ entries: SpeakingJournalEntry[] }> {
  return request<{ entries: SpeakingJournalEntry[] }>(`/api/pronunciation/speaking-journal/entries?limit=${limit}`);
}

export interface VocabUpgradeItem {
  original: string;
  upgraded: string;
  explanation: string;
  example: string;
}

export function getSpeakingJournalVocabUpgrade(transcript: string): Promise<{ upgrades: VocabUpgradeItem[] }> {
  return request<{ upgrades: VocabUpgradeItem[] }>('/api/pronunciation/speaking-journal/vocab-upgrade', {
    method: 'POST',
    body: JSON.stringify({ transcript }),
  });
}

export interface GrammarCorrection {
  original: string;
  corrected: string;
  explanation: string;
}

export interface GrammarCheckResult {
  grammar_score: number;
  corrections: GrammarCorrection[];
  overall_feedback: string;
}

export function getSpeakingJournalGrammarCheck(transcript: string): Promise<GrammarCheckResult> {
  return request<GrammarCheckResult>('/api/pronunciation/speaking-journal/grammar-check', {
    method: 'POST',
    body: JSON.stringify({ transcript }),
  });
}

export interface ModelAnswerResult {
  model_answer: string;
  key_phrases: string[];
  comparison_tip: string;
}

export function getSpeakingJournalModelAnswer(prompt: string, transcript: string): Promise<ModelAnswerResult> {
  return request<ModelAnswerResult>('/api/pronunciation/speaking-journal/model-answer', {
    method: 'POST',
    body: JSON.stringify({ prompt, user_transcript: transcript }),
  });
}

export interface SpeakingJournalEntrySummary {
  id: number;
  word_count: number;
  wpm: number;
  duration_seconds: number;
  vocabulary_diversity: number;
  created_at: string;
}

export interface SpeakingJournalDateStats {
  date: string;
  count: number;
  avg_wpm: number;
  avg_vocabulary_diversity: number;
}

export interface SpeakingJournalProgressResponse {
  total_entries: number;
  total_speaking_time_seconds: number;
  avg_wpm: number;
  avg_vocabulary_diversity: number;
  wpm_trend: string;
  entries_by_date: SpeakingJournalDateStats[];
  longest_entry: SpeakingJournalEntrySummary | null;
  highest_wpm: SpeakingJournalEntrySummary | null;
  best_vocabulary_diversity: SpeakingJournalEntrySummary | null;
}

export function getSpeakingJournalProgress(): Promise<SpeakingJournalProgressResponse> {
  return request<SpeakingJournalProgressResponse>('/api/pronunciation/speaking-journal/progress');
}

export interface FillerWordItem {
  word: string;
  count: number;
}

export interface FillerDailyTrend {
  date: string;
  filler_count: number;
  density_per_min: number;
  entries: number;
}

export interface FillerAnalysisResponse {
  total_entries: number;
  filler_breakdown: FillerWordItem[];
  daily_trend: FillerDailyTrend[];
  trend_direction: string;
  fluency_cleanliness_score: number;
}

export function getFillerWordAnalysis(): Promise<FillerAnalysisResponse> {
  return request<FillerAnalysisResponse>('/api/pronunciation/speaking-journal/filler-analysis');
}

// ── Quick Idiom Practice ────────────────────────────────────

export interface IdiomPromptResponse {
  idiom: string;
  meaning: string;
  example_sentence: string;
  situation_prompt: string;
  difficulty: string;
}

export interface IdiomEvaluateResponse {
  idiom_usage_score: number;
  grammar_score: number;
  naturalness_score: number;
  overall_score: number;
  feedback: string;
  model_sentence: string;
}

export function getIdiomPrompt(difficulty: string = 'intermediate'): Promise<IdiomPromptResponse> {
  return request<IdiomPromptResponse>(`/api/pronunciation/idiom-prompt?difficulty=${difficulty}`);
}

export function evaluateIdiomUsage(idiom: string, transcript: string, duration_seconds: number): Promise<IdiomEvaluateResponse> {
  return request<IdiomEvaluateResponse>('/api/pronunciation/idiom-prompt/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idiom, transcript, duration_seconds }),
  });
}

// ── Quick Write Practice ────────────────────────────────────────

export interface QuickWritePromptResponse {
  scenario: string;
  instruction: string;
  word_limit: number;
  difficulty: string;
}

export interface QuickWriteCorrectionItem {
  original: string;
  corrected: string;
  explanation: string;
}

export interface QuickWriteEvaluateResponse {
  grammar_score: number;
  vocabulary_score: number;
  naturalness_score: number;
  register_score: number;
  overall_score: number;
  feedback: string;
  corrections: QuickWriteCorrectionItem[];
  model_response: string;
}

export function getQuickWritePrompt(difficulty: string = 'intermediate'): Promise<QuickWritePromptResponse> {
  return request<QuickWritePromptResponse>(`/api/pronunciation/quick-write?difficulty=${difficulty}`);
}

export function evaluateQuickWrite(scenario: string, instruction: string, user_text: string): Promise<QuickWriteEvaluateResponse> {
  return request<QuickWriteEvaluateResponse>('/api/pronunciation/quick-write/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario, instruction, user_text }),
  });
}

// ── Quick Explain (Circumlocution) Practice ─────────────────────

export interface ExplainWordPromptResponse {
  word: string;
  forbidden_words: string[];
  hint: string;
  difficulty: string;
}

export interface ExplainWordEvaluateResponse {
  clarity_score: number;
  creativity_score: number;
  grammar_score: number;
  overall_score: number;
  used_forbidden: boolean[];
  feedback: string;
  model_explanation: string;
}

export function getExplainWord(difficulty: string = 'intermediate'): Promise<ExplainWordPromptResponse> {
  return request<ExplainWordPromptResponse>(`/api/pronunciation/explain-word?difficulty=${difficulty}`);
}

export function evaluateExplainWord(
  word: string,
  forbidden_words: string[],
  transcript: string,
  duration_seconds: number,
): Promise<ExplainWordEvaluateResponse> {
  return request<ExplainWordEvaluateResponse>('/api/pronunciation/explain-word/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word, forbidden_words, transcript, duration_seconds }),
  });
}

// ── Quick Role-Play Practice ─────────────────────────────────

export interface RolePlayScenarioResponse {
  scenario: string;
  your_role: string;
  partner_role: string;
  exchanges: { partner_says: string }[];
  key_phrases: string[];
  difficulty: string;
}

export interface RolePlayEvaluateResponse {
  appropriateness_score: number;
  grammar_score: number;
  fluency_score: number;
  vocabulary_score: number;
  overall_score: number;
  feedback: string;
  model_responses: string[];
}

export function getRolePlayScenario(difficulty: string = 'intermediate'): Promise<RolePlayScenarioResponse> {
  return request<RolePlayScenarioResponse>(`/api/pronunciation/roleplay-scenario?difficulty=${difficulty}`);
}

export function evaluateRolePlay(
  scenario: string,
  your_role: string,
  partner_role: string,
  exchanges: { partner_says: string; user_says: string }[],
  duration_seconds: number,
): Promise<RolePlayEvaluateResponse> {
  return request<RolePlayEvaluateResponse>('/api/pronunciation/roleplay/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario, your_role, partner_role, exchanges, duration_seconds }),
  });
}

// ── Quick Word Association Practice ─────────────────────────────

export interface WordAssociationPromptResponse {
  seed_word: string;
  category: string;
  hint: string;
  target_count: number;
  difficulty: string;
}

export interface WordAssociationEvaluateResponse {
  valid_count: number;
  sophistication_score: number;
  relevance_score: number;
  overall_score: number;
  feedback: string;
  missed_words: string[];
}

export function getWordAssociation(difficulty: string = 'intermediate'): Promise<WordAssociationPromptResponse> {
  return request<WordAssociationPromptResponse>(`/api/pronunciation/word-association?difficulty=${difficulty}`);
}

export function evaluateWordAssociation(
  seed_word: string,
  transcript: string,
  duration_seconds: number,
): Promise<WordAssociationEvaluateResponse> {
  return request<WordAssociationEvaluateResponse>('/api/pronunciation/word-association/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seed_word, transcript, duration_seconds }),
  });
}

// ── Quick Reading Comprehension ─────────────────────────────────

export interface ReadingCompResponse {
  passage: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  difficulty: string;
}

export function getReadingComp(difficulty: string = 'intermediate'): Promise<ReadingCompResponse> {
  return request<ReadingCompResponse>(`/api/pronunciation/reading-comp?difficulty=${difficulty}`);
}

// ── Study Plan ──────────────────────────────────────────────────

export interface StudyPlanStep {
  type: string;
  icon: string;
  title: string;
  description: string;
  estimated_minutes: number;
  route: string;
}

export interface StudyPlanResponse {
  steps: StudyPlanStep[];
  total_minutes: number;
}

export async function getStudyPlan(): Promise<StudyPlanResponse> {
  return request<StudyPlanResponse>('/api/dashboard/study-plan');
}

// ── Grammar Pattern Drill ───────────────────────────────────────

export interface GrammarPatternExercise {
  incorrect: string;
  correct: string;
  explanation: string;
}

export interface GrammarPatternDrillResponse {
  category: string;
  difficulty: string;
  exercises: GrammarPatternExercise[];
}

export async function getGrammarPatternDrill(
  category: string,
  difficulty: string = 'intermediate',
): Promise<GrammarPatternDrillResponse> {
  return request<GrammarPatternDrillResponse>('/api/dashboard/grammar-pattern-drill', {
    method: 'POST',
    body: JSON.stringify({ category, difficulty }),
  });
}

// ── Collocation Match Drill ─────────────────────────────────────

export interface CollocationExercise {
  base_word: string;
  correct_collocation: string;
  wrong_collocations: string[];
  category: string;
  explanation: string;
}

export interface CollocationDrillResponse {
  exercises: CollocationExercise[];
  difficulty: string;
}

export interface CollocationEvaluateResponse {
  is_correct: boolean;
  explanation: string;
  example_sentence: string;
}

export function getCollocationDrill(
  difficulty: string = 'intermediate',
  count: number = 5,
): Promise<CollocationDrillResponse> {
  return request<CollocationDrillResponse>(
    `/api/pronunciation/collocation-drill?difficulty=${difficulty}&count=${count}`,
  );
}

export function evaluateCollocation(
  base_word: string,
  correct_collocation: string,
  user_choice: string,
): Promise<CollocationEvaluateResponse> {
  return request<CollocationEvaluateResponse>('/api/pronunciation/collocation-drill/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_word, correct_collocation, user_choice }),
  });
}

// ── Connector Drill ────────────────────────────────────────────

export interface ConnectorDrillExercise {
  sentence_a: string;
  sentence_b: string;
  connector: string;
  connector_type: string;
  hint: string;
}

export interface ConnectorDrillResponse {
  exercises: ConnectorDrillExercise[];
  difficulty: string;
}

export interface ConnectorDrillEvaluation {
  connector_usage_score: number;
  grammar_score: number;
  naturalness_score: number;
  overall_score: number;
  model_answer: string;
  feedback: string;
}

export async function getConnectorDrillExercises(difficulty = 'intermediate', count = 5): Promise<ConnectorDrillResponse> {
  return request<ConnectorDrillResponse>('/api/pronunciation/connector-drill?difficulty=' + difficulty + '&count=' + count);
}

export async function evaluateConnectorDrill(data: {
  sentence_a: string;
  sentence_b: string;
  connector: string;
  user_response: string;
}): Promise<ConnectorDrillEvaluation> {
  return request<ConnectorDrillEvaluation>('/api/pronunciation/connector-drill/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ── 4-3-2 Fluency Sprint ───────────────────────────────────────

export interface FluencySprintTopic {
  topic: string;
  guiding_questions: string[];
  difficulty: string;
}

export interface FluencySprintRoundResult {
  wpm: number;
  word_count: number;
  unique_words: number;
  vocabulary_richness: number;
}

export interface FluencySprintResult {
  rounds: FluencySprintRoundResult[];
  fluency_improvement_score: number;
  feedback: string;
  strengths: string[];
  tips: string[];
}

export function getFluencySprintTopic(
  difficulty: string = 'intermediate',
): Promise<FluencySprintTopic> {
  return request<FluencySprintTopic>(
    `/api/pronunciation/fluency-sprint/topic?difficulty=${difficulty}`,
  );
}

export function evaluateFluencySprint(
  topic: string,
  transcripts: string[],
  durations: number[],
): Promise<FluencySprintResult> {
  return request<FluencySprintResult>('/api/pronunciation/fluency-sprint/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, transcripts, durations }),
  });
}

// ── Spot-the-Error Listening Drill ─────────────────────────────

export interface SpotErrorPrompt {
  error_sentence: string;
  correct_sentence: string;
  error_type: string;
  hint: string;
  difficulty: string;
}

export interface SpotErrorEvaluation {
  correction_accuracy_score: number;
  grammar_score: number;
  naturalness_score: number;
  overall_score: number;
  feedback: string;
  model_correction: string;
}

export function getSpotErrorPrompt(
  difficulty: string = 'intermediate',
): Promise<SpotErrorPrompt> {
  return request<SpotErrorPrompt>(
    `/api/pronunciation/spot-error?difficulty=${difficulty}`,
  );
}

export function evaluateSpotError(data: {
  error_sentence: string;
  correct_sentence: string;
  user_correction: string;
}): Promise<SpotErrorEvaluation> {
  return request<SpotErrorEvaluation>('/api/pronunciation/spot-error/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ── Quick Phrasal Verb Practice ────────────────────────────────────

export interface PhrasalVerbPromptResponse {
  phrasal_verb: string;
  meaning: string;
  example_sentence: string;
  situation_prompt: string;
  difficulty: string;
}

export interface PhrasalVerbEvaluateResponse {
  phrasal_verb_accuracy_score: number;
  grammar_score: number;
  naturalness_score: number;
  overall_score: number;
  feedback: string;
  model_sentence: string;
}

export function getPhrasalVerbPrompt(difficulty: string = 'intermediate'): Promise<PhrasalVerbPromptResponse> {
  return request<PhrasalVerbPromptResponse>(`/api/pronunciation/phrasal-verb?difficulty=${difficulty}`);
}

export function evaluatePhrasalVerbUsage(phrasal_verb: string, transcript: string, duration_seconds: number): Promise<PhrasalVerbEvaluateResponse> {
  return request<PhrasalVerbEvaluateResponse>('/api/pronunciation/phrasal-verb/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phrasal_verb, transcript, duration_seconds }),
  });
}

// ── Quick Rapid-Fire Q&A ──────────────────────────────────────────

export interface RapidFireQuestionItem {
  question: string;
  topic_hint: string;
}

export interface RapidFireQuestionsResponse {
  questions: RapidFireQuestionItem[];
  difficulty: string;
}

export interface RapidFireResponseItem {
  question: string;
  transcript: string;
  duration_seconds: number;
}

export interface RapidFirePerQuestionResult {
  relevance_score: number;
  grammar_score: number;
  fluency_score: number;
  feedback: string;
  model_answer: string;
}

export interface RapidFireEvaluateResponse {
  per_question: RapidFirePerQuestionResult[];
  overall_response_speed_score: number;
  overall_fluency_score: number;
  overall_score: number;
  summary_feedback: string;
}

export function getRapidFireQuestions(difficulty: string = 'intermediate'): Promise<RapidFireQuestionsResponse> {
  return request<RapidFireQuestionsResponse>(`/api/pronunciation/rapid-fire?difficulty=${difficulty}`);
}

export function evaluateRapidFire(questions: string[], responses: RapidFireResponseItem[]): Promise<RapidFireEvaluateResponse> {
  return request<RapidFireEvaluateResponse>('/api/pronunciation/rapid-fire/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questions, responses }),
  });
}

// Sentence Stress (iteration 534)
export interface SentenceStressResponse {
  sentence: string;
  stressed_words: string[];
  explanation: string;
  difficulty: string;
}

export interface SentenceStressEvaluateResponse {
  stress_accuracy_score: number;
  rhythm_score: number;
  pronunciation_score: number;
  overall_score: number;
  feedback: string;
  stress_tip: string;
}

export function getSentenceStress(difficulty: string = 'intermediate'): Promise<SentenceStressResponse> {
  return request<SentenceStressResponse>(`/api/pronunciation/sentence-stress?difficulty=${difficulty}`);
}

export function evaluateSentenceStress(sentence: string, stressed_words: string[], transcript: string): Promise<SentenceStressEvaluateResponse> {
  return request<SentenceStressEvaluateResponse>('/api/pronunciation/sentence-stress/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sentence, stressed_words, transcript }),
  });
}

// ── Quick Register Switch Practice ────────────────────────────────

export interface RegisterSwitchPromptResponse {
  situation: string;
  target_register: string;
  context_hint: string;
  difficulty: string;
}

export interface RegisterSwitchEvaluateResponse {
  register_accuracy_score: number;
  vocabulary_score: number;
  grammar_score: number;
  politeness_score: number;
  overall_score: number;
  feedback: string;
  model_response: string;
}

export function getRegisterSwitchPrompt(difficulty: string = 'intermediate'): Promise<RegisterSwitchPromptResponse> {
  return request<RegisterSwitchPromptResponse>(`/api/pronunciation/register-switch?difficulty=${difficulty}`);
}

export function evaluateRegisterSwitch(data: { situation: string; target_register: string; transcript: string; duration_seconds: number }): Promise<RegisterSwitchEvaluateResponse> {
  return request<RegisterSwitchEvaluateResponse>('/api/pronunciation/register-switch/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ── Quick Debate Practice ─────────────────────────────────────────

export interface DebateTopicResponse {
  statement: string;
  counter_argument: string;
  context_hint: string;
  difficulty: string;
}

export interface DebateEvaluateResponse {
  argument_structure_score: number;
  rebuttal_quality_score: number;
  grammar_score: number;
  vocabulary_score: number;
  coherence_score: number;
  overall_score: number;
  feedback: string;
  model_argument: string;
  model_rebuttal: string;
}

export function fetchDebateTopic(difficulty: string = 'intermediate'): Promise<DebateTopicResponse> {
  return request<DebateTopicResponse>(`/api/pronunciation/debate-topic?difficulty=${difficulty}`);
}

export function evaluateDebate(data: {
  statement: string;
  counter_argument: string;
  user_round1_transcript: string;
  user_round2_transcript: string;
  total_duration_seconds: number;
}): Promise<DebateEvaluateResponse> {
  return request<DebateEvaluateResponse>('/api/pronunciation/debate/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ── Quick Scene Description ──────────────────────────────────────

export interface SceneDescriptionPromptResponse {
  scene: string;
  key_vocabulary: string[];
  suggested_details: string[];
  difficulty: string;
}

export interface SceneDescriptionEvaluateResponse {
  descriptive_vocabulary_score: number;
  spatial_language_score: number;
  grammar_score: number;
  fluency_score: number;
  overall_score: number;
  word_count: number;
  wpm: number;
  feedback: string;
  model_description: string;
}

export function getSceneDescription(difficulty: string = 'intermediate'): Promise<SceneDescriptionPromptResponse> {
  return request<SceneDescriptionPromptResponse>(`/api/pronunciation/scene-description?difficulty=${difficulty}`);
}

export function evaluateSceneDescription(scene: string, transcript: string, duration_seconds: number): Promise<SceneDescriptionEvaluateResponse> {
  return request<SceneDescriptionEvaluateResponse>('/api/pronunciation/scene-description/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scene, transcript, duration_seconds }),
  });
}

// ── Quick Predict-What-Happens-Next ──────────────────────────────

export interface PredictNextSetupResponse {
  setup_text: string;
  continuation: string;
  context_hint: string;
  difficulty: string;
}

export interface PredictNextEvaluateResponse {
  plausibility_score: number;
  grammar_score: number;
  vocabulary_score: number;
  fluency_score: number;
  overall_score: number;
  feedback: string;
  actual_continuation: string;
}

export function getPredictNextSetup(difficulty: string = 'intermediate'): Promise<PredictNextSetupResponse> {
  return request<PredictNextSetupResponse>(`/api/pronunciation/predict-next?difficulty=${difficulty}`);
}

export function evaluatePredictNext(data: {
  setup_text: string;
  continuation: string;
  user_prediction: string;
  duration_seconds: number;
}): Promise<PredictNextEvaluateResponse> {
  return request<PredictNextEvaluateResponse>('/api/pronunciation/predict-next/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ── Quick Dictogloss ─────────────────────────────────────────────

export interface DictoglossPassageResponse {
  title: string;
  passage_text: string;
  topic: string;
  difficulty: string;
  sentence_count: number;
}

export interface DictoglossEvaluateResponse {
  content_coverage_score: number;
  grammar_score: number;
  vocabulary_score: number;
  reconstruction_quality_score: number;
  overall_score: number;
  feedback: string;
  model_reconstruction: string;
}

export function getDictoglossPassage(difficulty: string = 'intermediate'): Promise<DictoglossPassageResponse> {
  return request<DictoglossPassageResponse>(`/api/pronunciation/dictogloss?difficulty=${difficulty}`);
}

export function evaluateDictogloss(data: {
  passage_text: string;
  user_reconstruction: string;
  replay_used: boolean;
  duration_seconds: number;
}): Promise<DictoglossEvaluateResponse> {
  return request<DictoglossEvaluateResponse>('/api/pronunciation/dictogloss/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// Express It Better types
export interface ExpressBetterPair {
  original: string;
  upgraded: string;
  explanation: string;
}

export interface ExpressBetterResponse {
  conversation_id: number;
  pairs: ExpressBetterPair[];
}
