import { useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Conversation from './pages/Conversation';
import Pronunciation from './pages/Pronunciation';
import Vocabulary from './pages/Vocabulary';
import Dashboard from './pages/Dashboard';

function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  // Close nav on route change
  const handleNavClick = () => setNavOpen(false);

  return (
    <header className="app-header">
      <h1 onClick={() => { navigate('/'); setNavOpen(false); }} style={{ cursor: 'pointer' }}>
        English Practice
      </h1>
      <button
        className="nav-toggle"
        onClick={() => setNavOpen(!navOpen)}
        aria-label="Toggle navigation menu"
        aria-expanded={navOpen}
      >
        {navOpen ? '✕' : '☰'}
      </button>
      <nav className={navOpen ? 'nav-open' : ''}>
        <NavLink to="/conversation" onClick={handleNavClick}>Conversation</NavLink>
        <NavLink to="/pronunciation" onClick={handleNavClick}>Pronunciation</NavLink>
        <NavLink to="/vocabulary" onClick={handleNavClick}>Vocabulary</NavLink>
        <NavLink to="/dashboard" onClick={handleNavClick}>Dashboard</NavLink>
      </nav>
    </header>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-layout">
        <Header />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/conversation" element={<Conversation />} />
            <Route path="/pronunciation" element={<Pronunciation />} />
            <Route path="/vocabulary" element={<Vocabulary />} />
            <Route path="/dashboard" element={<Dashboard />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
