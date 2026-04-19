export interface Translations {
  appTitle: string;
  navConversation: string;
  navPronunciation: string;
  navListening: string;
  navVocabulary: string;
  navDashboard: string;
  statusConnected: string;
  statusDegraded: string;
  statusDisconnected: string;
  serverStatus: string;
  uptime: string;
  switchToDark: string;
  switchToLight: string;
  switchLanguage: string;
  errorHeading: string;
  errorFallback: string;
  tryAgain: string;
  goHome: string;
  // Home page
  homeTitle: string;
  homeSubtitle: string;
  takeTour: string;
  moduleConversation: string;
  moduleVocabulary: string;
  modulePronunciation: string;
  moduleStrengths: string;
  weeklyProgress: string;
  weeklyConversations: string;
  weeklyVocabReviews: string;
  weeklyPronunciation: string;
  weeklyListening: string;
  weeklySpeakingJournal: string;
  vsLastWeek: string;
  focusOnWeakest: string;
  setDailyGoal: string;
  dailyGoals: string;
  goal3Conv: string;
  goal10Vocab: string;
  goal5Pron: string;
  goal2Speaking: string;
  goal2Listening: string;
  clickToEditTarget: string;
  removeGoal: string;
  allGoalsComplete: string;
  todaysPractice: string;
  dayStreak: string;
  keepStreak: string;
  todayConversations: string;
  todayVocabReviews: string;
  todayPronunciation: string;
  todayListening: string;
  todaySpeakingJournal: string;
  recommendations: string;
  wordOfTheDay: string;
  listen: string;
  listenToExample: string;
  practiceVocabulary: string;
  recentlyPracticed: string;
  justNow: string;
  minutesAgo: string;
  hoursAgo: string;
  yesterday: string;
  daysAgo: string;
  currentStreak: string;
  bestStreak: string;
  nextMilestone: string;
  daysToGo: string;
  vocabularyProgress: string;
  masteredCount: string;
  accuracyRate: string;
  startPracticingToTrack: string;
  showLess: string;
  showAllTopics: string;
  dailyChallenge: string;
  startChallenge: string;
  recentAchievements: string;
  viewAll: string;
  featureConversationDesc: string;
  featurePronunciationDesc: string;
  featureVocabularyDesc: string;
  featureDashboard: string;
  featureDashboardDesc: string;
  smartReviewQueue: string;
  allCaughtUp: string;
  speakingJournal: string;
  startSpeaking: string;
  stopAndSave: string;
  tryAnother: string;
  uniqueWords: string;
  listeningLabel: string;
  startingLabel: string;
  savingLabel: string;
  wordsLabel: string;
  fillersLabel: string;
  journalHistory: string;
  promptLabel: string;
  durationLabel: string;
  trendLabel: string;
  // Conversation Role-Swap Replay
  practiceOtherSide: string;
  roleSwapReplayTitle: string;
  roleSwapLoading: string;
  roleSwapEmpty: string;
  roleSwapTurnProgress: string;
  roleSwapListenPrompt: string;
  roleSwapSpeakPrompt: string;
  roleSwapHidden: string;
  roleSwapReveal: string;
  roleSwapReplayAudio: string;
  roleSwapListened: string;
  roleSwapStartMic: string;
  roleSwapStopMic: string;
  roleSwapYouSaid: string;
  roleSwapSkip: string;
  roleSwapNext: string;
  roleSwapFinished: string;
  roleSwapDone: string;
  roleSwapClose: string;
  // Speaking Pace Coach
  pacingTitle: string;
  paceSlowClear: string;
  paceNatural: string;
  paceFast: string;
  paceTipSlow: string;
  paceTipNatural: string;
  paceTipFast: string;
  paceAvg: string;
  paceMin: string;
  paceMax: string;
  paceWpmUnit: string;
  // Heatmap day drill-down
  heatmapActivityOn: string;
  heatmapNoActivity: string;
  heatmapNewWords: string;
  heatmapReplaySummary: string;
  heatmapPracticeAgainLikeThisDay: string;
  heatmapClose: string;
  heatmapPronCount: string;
  heatmapVocabCount: string;
  heatmapListeningCount: string;
  heatmapConvCount: string;
  // Phrase of the Day shadow drill
  shadowDrill: string;
  shadowSlow: string;
  shadowNormal: string;
  shadowFast: string;
  phraseMastered: string;
  restartDrill: string;
  bestScore: string;
  averageScore: string;
}

export const en: Translations = {
  appTitle: 'English Practice',
  navConversation: 'Conversation',
  navPronunciation: 'Pronunciation',
  navListening: 'Listening',
  navVocabulary: 'Vocabulary',
  navDashboard: 'Dashboard',
  statusConnected: 'Connected',
  statusDegraded: 'Degraded',
  statusDisconnected: 'Disconnected',
  serverStatus: 'Server status',
  uptime: 'Uptime',
  switchToDark: 'Switch to dark mode',
  switchToLight: 'Switch to light mode',
  switchLanguage: 'Switch language',
  errorHeading: 'Something went wrong',
  errorFallback: 'An unexpected error occurred.',
  tryAgain: 'Try Again',
  goHome: 'Go Home',
  // Home page
  homeTitle: 'Improve Your English',
  homeSubtitle: 'Practice conversations, pronunciation, and vocabulary with AI',
  takeTour: 'Take a Tour',
  moduleConversation: 'Conversation',
  moduleVocabulary: 'Vocabulary',
  modulePronunciation: 'Pronunciation',
  moduleStrengths: 'Module Strengths',
  weeklyProgress: 'Weekly Progress',
  weeklyConversations: 'Conversations',
  weeklyVocabReviews: 'Vocab Reviews',
  weeklyPronunciation: 'Pronunciation',
  weeklyListening: 'Listening',
  weeklySpeakingJournal: 'Speaking',
  vsLastWeek: 'vs last wk',
  focusOnWeakest: 'Focus on {label} — your weakest area →',
  setDailyGoal: 'Set a Daily Goal',
  dailyGoals: 'Daily Goals',
  goal3Conv: '3 conversations/day',
  goal10Vocab: '10 vocab reviews/day',
  goal5Pron: '5 pronunciations/day',
  goal2Speaking: '2 speaking entries/day',
  goal2Listening: '2 listening quizzes/day',
  clickToEditTarget: 'Click to edit target',
  removeGoal: 'Remove goal',
  allGoalsComplete: '🎉 All daily goals complete!',
  todaysPractice: "Today's Practice",
  dayStreak: '{count} day streak',
  keepStreak: 'Complete an activity to keep it!',
  todayConversations: 'Conversations',
  todayVocabReviews: 'Vocab Reviews',
  todayPronunciation: 'Pronunciation',
  todayListening: 'Listening',
  todaySpeakingJournal: 'Speaking',
  recommendations: 'Recommendations',
  wordOfTheDay: 'Word of the Day',
  listen: 'Listen',
  listenToExample: 'Listen to example',
  practiceVocabulary: 'Practice Vocabulary →',
  recentlyPracticed: 'Recently Practiced',
  justNow: 'just now',
  minutesAgo: '{count}m ago',
  hoursAgo: '{count}h ago',
  yesterday: 'yesterday',
  daysAgo: '{count}d ago',
  currentStreak: 'Current streak',
  bestStreak: '🏆 Best: {count}d',
  nextMilestone: 'Next: {label}',
  daysToGo: '{count} day{s} to go',
  vocabularyProgress: 'Vocabulary Progress',
  masteredCount: '{mastered} / {total} mastered',
  accuracyRate: '{rate}% accuracy',
  startPracticingToTrack: 'Start practicing to track accuracy',
  showLess: 'Show less',
  showAllTopics: 'Show all {count} topics',
  dailyChallenge: 'Daily Challenge',
  startChallenge: 'Start Challenge →',
  recentAchievements: 'Recent Achievements',
  viewAll: 'View all →',
  featureConversationDesc: 'Practice real-life scenarios like hotel check-in, job interviews, and restaurant orders with AI role play.',
  featurePronunciationDesc: 'Shadowing practice: listen to a sentence, then repeat it immediately. Get feedback on accuracy and fluency.',
  featureVocabularyDesc: 'Learn scenario-specific words and phrases in context through interactive quizzes with real-life examples.',
  featureDashboard: 'Dashboard',
  featureDashboardDesc: 'Track your learning streak, view statistics, and see your progress across all activities.',
  smartReviewQueue: 'Smart Review Queue',
  allCaughtUp: 'All caught up! 🎉',
  speakingJournal: 'Speaking Journal',
  startSpeaking: 'Start Speaking',
  stopAndSave: 'Stop & Save',
  tryAnother: 'Try Another Prompt',
  uniqueWords: 'unique',
  listeningLabel: 'Listening...',
  startingLabel: 'Starting...',
  savingLabel: 'Saving...',
  wordsLabel: 'words',
  fillersLabel: 'Fillers',
  journalHistory: 'Past Entries',
  promptLabel: 'Prompt',
  durationLabel: 'duration',
  trendLabel: 'Trend',
  practiceOtherSide: '🔀 Practice the other side',
  roleSwapReplayTitle: 'Role-Swap Replay',
  roleSwapLoading: 'Loading replay…',
  roleSwapEmpty: 'No turns to replay yet.',
  roleSwapTurnProgress: 'Turn {n} of {total}',
  roleSwapListenPrompt: 'Listen to your line (now spoken to you)',
  roleSwapSpeakPrompt: "Now say what the AI said. Speak, then reveal to compare.",
  roleSwapHidden: '(target line hidden — try saying it first)',
  roleSwapReveal: 'Reveal',
  roleSwapReplayAudio: 'Replay audio',
  roleSwapListened: 'Listened — Next',
  roleSwapStartMic: 'Record',
  roleSwapStopMic: 'Stop',
  roleSwapYouSaid: 'You said',
  roleSwapSkip: 'Skip',
  roleSwapNext: 'Next',
  roleSwapFinished: "You've finished the role-swap replay.",
  roleSwapDone: 'Done',
  roleSwapClose: 'Close',
  pacingTitle: 'Pacing',
  paceSlowClear: 'Slow & clear',
  paceNatural: 'Natural',
  paceFast: 'Fast — slow down',
  paceTipSlow: 'Try speaking a bit faster to sound more natural.',
  paceTipNatural: 'Great pace — clear and natural.',
  paceTipFast: 'Try slowing down for clarity.',
  paceAvg: 'Avg',
  paceMin: 'Min',
  paceMax: 'Max',
  paceWpmUnit: 'WPM',
  heatmapActivityOn: 'Activity on {date}',
  heatmapNoActivity: 'No activity on this day yet.',
  heatmapNewWords: 'New words',
  heatmapReplaySummary: 'Replay summary',
  heatmapPracticeAgainLikeThisDay: 'Practice again like this day',
  heatmapClose: 'Close',
  heatmapPronCount: '{count} attempts • avg {score}',
  heatmapVocabCount: '{count} reviews',
  heatmapListeningCount: '{count} quizzes • {accuracy}% acc',
  heatmapConvCount: '{count} messages',
  shadowDrill: 'Shadow ×3',
  shadowSlow: 'Slow',
  shadowNormal: 'Normal',
  shadowFast: 'Fast',
  phraseMastered: 'Phrase mastered!',
  restartDrill: 'Restart drill',
  bestScore: 'Best',
  averageScore: 'Avg',
};

export const ja: Translations = {
  appTitle: '英語練習',
  navConversation: '会話',
  navPronunciation: '発音',
  navListening: 'リスニング',
  navVocabulary: '語彙',
  navDashboard: 'ダッシュボード',
  statusConnected: '接続中',
  statusDegraded: '不安定',
  statusDisconnected: '切断',
  serverStatus: 'サーバー状態',
  uptime: '稼働時間',
  switchToDark: 'ダークモードに切り替え',
  switchToLight: 'ライトモードに切り替え',
  switchLanguage: '言語を切り替え',
  errorHeading: 'エラーが発生しました',
  errorFallback: '予期しないエラーが発生しました。',
  tryAgain: 'やり直す',
  goHome: 'ホームへ',
  // Home page
  homeTitle: '英語力を伸ばそう',
  homeSubtitle: 'AIと会話・発音・語彙を練習しよう',
  takeTour: 'ツアーを開始',
  moduleConversation: '会話',
  moduleVocabulary: '語彙',
  modulePronunciation: '発音',
  moduleStrengths: 'モジュール別の実力',
  weeklyProgress: '週間の進捗',
  weeklyConversations: '会話',
  weeklyVocabReviews: '語彙復習',
  weeklyPronunciation: '発音',
  weeklyListening: 'リスニング',
  weeklySpeakingJournal: 'スピーキング',
  vsLastWeek: '先週比',
  focusOnWeakest: '{label}に集中 — 一番弱い分野 →',
  setDailyGoal: '日課の目標を設定',
  dailyGoals: '日課の目標',
  goal3Conv: '1日3会話',
  goal10Vocab: '1日10語彙復習',
  goal5Pron: '1日5発音',
  goal2Speaking: '1日2スピーキング',
  goal2Listening: '1日2リスニング',
  clickToEditTarget: 'クリックして目標を変更',
  removeGoal: '目標を削除',
  allGoalsComplete: '🎉 全ての日課達成！',
  todaysPractice: '今日の練習',
  dayStreak: '{count}日連続',
  keepStreak: 'アクティビティを完了して継続しよう！',
  todayConversations: '会話',
  todayVocabReviews: '語彙復習',
  todayPronunciation: '発音',
  todayListening: 'リスニング',
  todaySpeakingJournal: 'スピーキング',
  recommendations: 'おすすめ',
  wordOfTheDay: '今日の単語',
  listen: '聴く',
  listenToExample: '例文を聴く',
  practiceVocabulary: '語彙を練習 →',
  recentlyPracticed: '最近の練習',
  justNow: 'たった今',
  minutesAgo: '{count}分前',
  hoursAgo: '{count}時間前',
  yesterday: '昨日',
  daysAgo: '{count}日前',
  currentStreak: '現在の連続記録',
  bestStreak: '🏆 最高: {count}日',
  nextMilestone: '次: {label}',
  daysToGo: 'あと{count}日',
  vocabularyProgress: '語彙の進捗',
  masteredCount: '{mastered} / {total} 習得済み',
  accuracyRate: '{rate}%の正答率',
  startPracticingToTrack: '練習を始めて正答率を追跡しよう',
  showLess: '少なく表示',
  showAllTopics: '全{count}トピックを表示',
  dailyChallenge: 'デイリーチャレンジ',
  startChallenge: 'チャレンジを開始 →',
  recentAchievements: '最近の実績',
  viewAll: 'すべて表示 →',
  featureConversationDesc: 'ホテルのチェックイン、面接、レストラン注文などの実践シナリオをAIロールプレイで練習。',
  featurePronunciationDesc: 'シャドーイング練習：文を聞いてすぐ復唱。正確さと流暢さのフィードバックを取得。',
  featureVocabularyDesc: 'インタラクティブなクイズで場面別の単語やフレーズを文脈の中で学習。',
  featureDashboard: 'ダッシュボード',
  featureDashboardDesc: '学習の継続記録を追跡、統計を確認、全アクティビティの進捗を表示。',
  smartReviewQueue: 'スマート復習キュー',
  allCaughtUp: '全部完了！🎉',
  speakingJournal: 'スピーキング日記',
  startSpeaking: '話し始める',
  stopAndSave: '停止して保存',
  tryAnother: '別のお題に挑戦',
  uniqueWords: 'ユニーク',
  listeningLabel: '聞いています...',
  startingLabel: '開始中...',
  savingLabel: '保存中...',
  wordsLabel: '単語',
  fillersLabel: 'つなぎ言葉',
  journalHistory: '過去のエントリー',
  promptLabel: 'プロンプト',
  durationLabel: '時間',
  trendLabel: 'トレンド',
  practiceOtherSide: '🔀 相手の役を練習',
  roleSwapReplayTitle: 'ロール交代リプレイ',
  roleSwapLoading: 'リプレイを読み込み中…',
  roleSwapEmpty: 'リプレイできるターンがまだありません。',
  roleSwapTurnProgress: '{total}ターン中 {n}',
  roleSwapListenPrompt: 'あなたのセリフを聞きましょう（今度はAIが話します）',
  roleSwapSpeakPrompt: 'AIが言ったことを話してみましょう。話してから答え合わせ。',
  roleSwapHidden: '（お手本は非表示 — まず自分で言ってみよう）',
  roleSwapReveal: '答えを表示',
  roleSwapReplayAudio: 'もう一度再生',
  roleSwapListened: '聞いた — 次へ',
  roleSwapStartMic: '録音開始',
  roleSwapStopMic: '停止',
  roleSwapYouSaid: 'あなたの発話',
  roleSwapSkip: 'スキップ',
  roleSwapNext: '次へ',
  roleSwapFinished: 'ロール交代リプレイを完了しました。',
  roleSwapDone: '完了',
  roleSwapClose: '閉じる',
  pacingTitle: 'ペース',
  paceSlowClear: 'ゆっくり明瞭',
  paceNatural: '自然',
  paceFast: '速い — ゆっくりに',
  paceTipSlow: 'もう少し速く話すと自然に聞こえます。',
  paceTipNatural: '良いペースです — 明瞭で自然です。',
  paceTipFast: '明瞭に伝えるためにペースを落としてみましょう。',
  paceAvg: '平均',
  paceMin: '最小',
  paceMax: '最大',
  paceWpmUnit: 'WPM',
  heatmapActivityOn: '{date} のアクティビティ',
  heatmapNoActivity: 'この日はまだ練習がありません。',
  heatmapNewWords: '新しい単語',
  heatmapReplaySummary: '要約を見る',
  heatmapPracticeAgainLikeThisDay: 'この日のように練習する',
  heatmapClose: '閉じる',
  heatmapPronCount: '{count}回 • 平均 {score}',
  heatmapVocabCount: '{count}回の復習',
  heatmapListeningCount: '{count}クイズ • 正答率 {accuracy}%',
  heatmapConvCount: '{count}件のメッセージ',
  shadowDrill: 'シャドー×3',
  shadowSlow: 'ゆっくり',
  shadowNormal: '普通',
  shadowFast: '速い',
  phraseMastered: 'フレーズ習得！',
  restartDrill: 'ドリルをやり直す',
  bestScore: 'ベスト',
  averageScore: '平均',
};

export type Locale = 'en' | 'ja';

export const translations: Record<Locale, Translations> = { en, ja };
