import { useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import ErrorBoundary from './components/ErrorBoundary';
import RetryBanner from './components/RetryBanner';
import { useTheme } from './hooks/useTheme';
import { useHealthCheck } from './hooks/useHealthCheck';
import type { HealthStatus } from './hooks/useHealthCheck';
import Home from './pages/Home';
import Conversation from './pages/Conversation';
import Pronunciation from './pages/Pronunciation';
import Vocabulary from './pages/Vocabulary';
import Dashboard from './pages/Dashboard';

const statusLabel: Record<HealthStatus, string> = {
  connected: 'Connected',
  degraded: 'Degraded',
  disconnected: 'Disconnected',
};

function Header() {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const health = useHealthCheck();

  // Close nav on route change
  const handleNavClick = () => setNavOpen(false);

  return (
    <header className="app-header">
      <h1 onClick={() => { navigate('/'); setNavOpen(false); }} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
        English Practice
        <span
          className={`health-dot health-${health.status}`}
          aria-label={`Server status: ${statusLabel[health.status]}`}
          title={`${statusLabel[health.status]}${health.uptime != null ? ` · Uptime: ${Math.floor(health.uptime / 60)}m` : ''}`}
        />
      </h1>
      <nav className={navOpen ? 'nav-open' : ''}>
        <NavLink to="/conversation" onClick={handleNavClick}>Conversation</NavLink>
        <NavLink to="/pronunciation" onClick={handleNavClick}>Pronunciation</NavLink>
        <NavLink to="/vocabulary" onClick={handleNavClick}>Vocabulary</NavLink>
        <NavLink to="/dashboard" onClick={handleNavClick}>Dashboard</NavLink>
      </nav>
      <button
        className="theme-toggle"
        onClick={toggleTheme}
        aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        title={theme === 'light' ? 'Dark mode' : 'Light mode'}
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
      <div className="app-layout">
        <Header />
        <RetryBanner />
        <main className="app-main">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/conversation" element={<Conversation />} />
              <Route path="/pronunciation" element={<Pronunciation />} />
              <Route path="/vocabulary" element={<Vocabulary />} />
              <Route path="/dashboard" element={<Dashboard />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </BrowserRouter>
  );
}
