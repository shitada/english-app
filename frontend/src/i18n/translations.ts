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
};

export type Locale = 'en' | 'ja';

export const translations: Record<Locale, Translations> = { en, ja };
