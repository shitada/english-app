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
  getConversationTopics: () => request<{ id: string; label: string; description: string }[]>('/api/conversation/topics'),
  getFavoriteTopics: () => request<{ favorites: string[] }>('/api/conversation/topics/favorites'),
  toggleTopicFavorite: (topicId: string) => request<{ topic_id: string; is_favorite: boolean; favorites: string[] }>(`/api/conversation/topics/${topicId}/favorite`, { method: 'PUT' }),

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

  generateListeningQuiz: (difficulty: string = 'intermediate', questionCount = 5) =>
    request<ListeningQuizResponse>(`/api/pronunciation/listening-quiz?difficulty=${difficulty}&question_count=${questionCount}`, { method: 'POST' }),

  getQuickSpeakPrompt: (difficulty: string = 'intermediate') =>
    request<{ prompt: string; context_hint: string; difficulty: string; suggested_phrases: string[] }>(`/api/pronunciation/quick-speak?difficulty=${difficulty}`),

  evaluateQuickSpeak: (prompt: string, transcript: string, duration_seconds: number) =>
    request<{ fluency_score: number; relevance_score: number; grammar_score: number; vocabulary_score: number; overall_score: number; word_count: number; wpm: number; feedback: string; suggestions: string[] }>('/api/pronunciation/quick-speak/evaluate', {
      method: 'POST',
      body: JSON.stringify({ prompt, transcript, duration_seconds }),
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
    request<{ words: { id: number; word: string; meaning: string; topic: string; difficulty: number }[]; count: number }>(
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

  // Conversation export
  exportConversation: (conversationId: number) =>
    request<ConversationExport>(`/api/conversation/${conversationId}/export`),

  // Pronunciation extras
  getPronunciationScoreTrend: () =>
    request<ScoreTrendResponse>('/api/pronunciation/trend'),

  getPronunciationDistribution: () =>
    request<ScoreDistributionResponse>('/api/pronunciation/distribution'),

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
  history: { date: string; conversations: number; messages: number; pronunciation_attempts: number; vocabulary_reviews: number }[];
}

export interface StreakMilestonesResponse {
  current_streak: number;
  longest_streak: number;
  milestones: { days: number; label: string; achieved: boolean }[];
  next_milestone: { days: number; label: string; days_remaining: number } | null;
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
  goal_type: "conversations" | "vocabulary_reviews" | "pronunciation_attempts";
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
