import { BrowserRouter, Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import Home from './pages/Home';
import Conversation from './pages/Conversation';
import Pronunciation from './pages/Pronunciation';
import Vocabulary from './pages/Vocabulary';
import Dashboard from './pages/Dashboard';

function Header() {
  const navigate = useNavigate();
  return (
    <header className="app-header">
      <h1 onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
        English Practice
      </h1>
      <nav>
        <NavLink to="/conversation">Conversation</NavLink>
        <NavLink to="/pronunciation">Pronunciation</NavLink>
        <NavLink to="/vocabulary">Vocabulary</NavLink>
        <NavLink to="/dashboard">Dashboard</NavLink>
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
