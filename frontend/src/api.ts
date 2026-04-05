async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

// Conversation
export const api = {
  // Topics
  getConversationTopics: () => request<{ id: string; label: string; description: string }[]>('/api/conversation/topics'),

  // Conversation
  startConversation: (topic: string, difficulty: 'beginner' | 'intermediate' | 'advanced' = 'intermediate') =>
    request<{ conversation_id: number; message: string; topic: string; phrase_suggestions: string[]; key_phrases: string[] }>('/api/conversation/start', {
      method: 'POST',
      body: JSON.stringify({ topic, difficulty }),
    }),

  sendMessage: (conversation_id: number, content: string) =>
    request<{ message: string; feedback: GrammarFeedback; phrase_suggestions: string[]; key_phrases: string[] }>('/api/conversation/message', {
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
    phoneme_issues?: { target?: string; produced?: string; tip?: string }[];
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

export async function getPronunciationWeeklyProgress(weeks?: number): Promise<WeeklyProgressResponse> {
  const params = weeks ? `?weeks=${weeks}` : "";
  return request<WeeklyProgressResponse>(`/api/pronunciation/weekly-progress${params}`);
}

// Topic recommendations (from iteration 90)
export interface TopicRecommendation {
  topic: string;
  session_count: number;
  last_practiced: string | null;
  reason: "never_practiced" | "continue_practice";
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
