import { useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { Globe, Moon, Sun } from 'lucide-react';
import ErrorBoundary from './components/ErrorBoundary';
import RetryBanner from './components/RetryBanner';
import StudyTimer from './components/StudyTimer';
import { useTheme } from './hooks/useTheme';
import { useHealthCheck } from './hooks/useHealthCheck';
import { I18nProvider, useI18n } from './i18n/I18nContext';
import Home from './pages/Home';
import Conversation from './pages/Conversation';
import Pronunciation from './pages/Pronunciation';
import Vocabulary from './pages/Vocabulary';
import Listening from './pages/Listening';
import Dashboard from './pages/Dashboard';

function Header() {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const health = useHealthCheck();
  const { locale, setLocale, t } = useI18n();

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
        <NavLink to="/vocabulary" onClick={handleNavClick}>{t('navVocabulary')}</NavLink>
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
