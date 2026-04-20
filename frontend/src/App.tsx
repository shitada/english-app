import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { Globe, Moon, Sun } from 'lucide-react';
import ErrorBoundary from './components/ErrorBoundary';
import RetryBanner from './components/RetryBanner';
import StudyTimer from './components/StudyTimer';
import { useTheme } from './hooks/useTheme';
import { useHealthCheck } from './hooks/useHealthCheck';
import { I18nProvider, useI18n } from './i18n/I18nContext';
import { getVocabDueCount } from './api';
import Home from './pages/Home';
import Conversation from './pages/Conversation';
import Pronunciation from './pages/Pronunciation';
import Vocabulary from './pages/Vocabulary';
import Listening from './pages/Listening';
import Dashboard from './pages/Dashboard';
import MinimalPairs from './pages/MinimalPairs';
import MinimalPairsPage from './pages/MinimalPairsPage';
import Shadowing from './pages/Shadowing';
import StressSpotlight from './pages/StressSpotlight';
import SentenceEcho from './components/SentenceEcho';
import ListenSummarize from './pages/ListenSummarize';
import Paraphrase from './pages/Paraphrase';
import NumberDictation from './pages/NumberDictation';
import SpeedLadderDrill from './pages/SpeedLadderDrill';
import PhrasalVerbDrill from './pages/PhrasalVerbDrill';
import TagQuestionDrill from './pages/TagQuestionDrill';
import TenseContrast from './pages/TenseContrast';
import WhQuestionDrill from './pages/WhQuestionDrill';
import ErrorCorrection from './pages/ErrorCorrection';
import ConnectedSpeechPage from './pages/ConnectedSpeechPage';
import PrepositionDrill from './pages/PrepositionDrill';
import PausePredictPage from './pages/PausePredictPage';
import ArticleDrill from './pages/ArticleDrill';
import IntonationArrowPage from './pages/IntonationArrowPage';
import CollocationChef from './pages/CollocationChef';
import ElasticSentencePage from './pages/ElasticSentencePage';
import ReportedSpeech from './pages/ReportedSpeech';

const DUE_COUNT_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

function Header() {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const health = useHealthCheck();
  const { locale, setLocale, t } = useI18n();
  const [dueCount, setDueCount] = useState(0);

  const fetchDueCount = useCallback(async () => {
    try {
      const data = await getVocabDueCount();
      setDueCount(data.due_count);
    } catch {
      // silently ignore – badge just won't show
    }
  }, []);

  useEffect(() => {
    fetchDueCount();
    const id = setInterval(fetchDueCount, DUE_COUNT_REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchDueCount]);

  const handleNavClick = () => setNavOpen(false);

  return (
    <header className="app-header">
      <h1 onClick={() => { navigate('/'); setNavOpen(false); }} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
        {t('appTitle')}
        <span
          className={`health-dot health-${health.status}`}
          aria-label={`${t('serverStatus')}: ${t(health.status === 'connected' ? 'statusConnected' : health.status === 'degraded' ? 'statusDegraded' : 'statusDisconnected')}`}
          title={`${t(health.status === 'connected' ? 'statusConnected' : health.status === 'degraded' ? 'statusDegraded' : 'statusDisconnected')}${health.uptime != null ? ` · ${t('uptime')}: ${Math.floor(health.uptime / 60)}m` : ''}`}
        />
      </h1>
      <nav className={navOpen ? 'nav-open' : ''}>
        <NavLink to="/conversation" onClick={handleNavClick}>{t('navConversation')}</NavLink>
        <NavLink to="/pronunciation" onClick={handleNavClick}>{t('navPronunciation')}</NavLink>
        <NavLink to="/listening" onClick={handleNavClick}>{t('navListening')}</NavLink>
        <NavLink to="/vocabulary" onClick={handleNavClick} style={{ position: 'relative' }}>
          {t('navVocabulary')}
          {dueCount > 0 && <span className="nav-badge" aria-label={`${dueCount} words due for review`}>{dueCount}</span>}
        </NavLink>
        <NavLink to="/dashboard" onClick={handleNavClick}>{t('navDashboard')}</NavLink>
      </nav>
      <button
        className="locale-toggle"
        onClick={() => setLocale(locale === 'en' ? 'ja' : 'en')}
        aria-label={t('switchLanguage')}
        title={t('switchLanguage')}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: 13, opacity: 0.85 }}
      >
        <Globe size={16} />
        <span>{locale.toUpperCase()}</span>
      </button>
      <button
        className="theme-toggle"
        onClick={toggleTheme}
        aria-label={theme === 'light' ? t('switchToDark') : t('switchToLight')}
        title={theme === 'light' ? t('switchToDark') : t('switchToLight')}
      >
        {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
      </button>
      <button
        className="nav-toggle"
        data-testid="nav-hamburger"
        onClick={() => setNavOpen(!navOpen)}
        aria-label="Toggle navigation menu"
        aria-expanded={navOpen}
      >
        {navOpen ? '✕' : '☰'}
      </button>
    </header>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <I18nProvider>
        <div className="app-layout">
          <Header />
          <RetryBanner />
          <main className="app-main">
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/conversation" element={<Conversation />} />
                <Route path="/pronunciation" element={<Pronunciation />} />
                <Route path="/listening" element={<Listening />} />
                <Route path="/minimal-pairs" element={<MinimalPairs />} />
                <Route path="/minimal-pairs-drill" element={<MinimalPairsPage />} />
                <Route path="/shadowing" element={<Shadowing />} />
                <Route path="/stress-spotlight" element={<StressSpotlight />} />
                <Route path="/sentence-echo" element={<SentenceEcho />} />
                <Route path="/listen-summarize" element={<ListenSummarize />} />
                <Route path="/paraphrase" element={<Paraphrase />} />
                <Route path="/number-dictation" element={<NumberDictation />} />
                <Route path="/speed-ladder" element={<SpeedLadderDrill />} />
                <Route path="/phrasal-verbs" element={<PhrasalVerbDrill />} />
                <Route path="/tag-questions" element={<TagQuestionDrill />} />
                <Route path="/tense-contrast" element={<TenseContrast />} />
                <Route path="/wh-questions" element={<WhQuestionDrill />} />
                <Route path="/error-correction" element={<ErrorCorrection />} />
                <Route path="/connected-speech" element={<ConnectedSpeechPage />} />
                <Route path="/preposition-drill" element={<PrepositionDrill />} />
                <Route path="/pause-predict" element={<PausePredictPage />} />
                <Route path="/articles" element={<ArticleDrill />} />
                <Route path="/intonation-arrow" element={<IntonationArrowPage />} />
                <Route path="/collocation-chef" element={<CollocationChef />} />
                <Route path="/elastic-sentence" element={<ElasticSentencePage />} />
                <Route path="/reported-speech" element={<ReportedSpeech />} />
                <Route path="/vocabulary" element={<Vocabulary />} />
                <Route path="/dashboard" element={<Dashboard />} />
              </Routes>
            </ErrorBoundary>
          </main>
          <StudyTimer />
        </div>
      </I18nProvider>
    </BrowserRouter>
  );
}
