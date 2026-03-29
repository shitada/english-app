import { Link } from 'react-router-dom';
import { MessageSquare, Mic, BookOpen, BarChart3 } from 'lucide-react';

export default function Home() {
  return (
    <div>
      <div className="home-hero">
        <h2>Improve Your English</h2>
        <p>Practice conversations, pronunciation, and vocabulary with AI</p>
      </div>

      <div className="feature-grid">
        <Link to="/conversation" className="feature-card">
          <div className="icon" style={{ background: '#eef2ff' }}>
            <MessageSquare size={28} color="#6366f1" />
          </div>
          <h3>Conversation</h3>
          <p>
            Practice real-life scenarios like hotel check-in, job interviews, and
            restaurant orders with AI role play.
          </p>
        </Link>

        <Link to="/pronunciation" className="feature-card">
          <div className="icon" style={{ background: '#fef3c7' }}>
            <Mic size={28} color="#f59e0b" />
          </div>
          <h3>Pronunciation</h3>
          <p>
            Shadowing practice: listen to a sentence, then repeat it
            immediately. Get feedback on accuracy and fluency.
          </p>
        </Link>

        <Link to="/vocabulary" className="feature-card">
          <div className="icon" style={{ background: '#d1fae5' }}>
            <BookOpen size={28} color="#10b981" />
          </div>
          <h3>Vocabulary</h3>
          <p>
            Learn scenario-specific words and phrases in context through
            interactive quizzes with real-life examples.
          </p>
        </Link>

        <Link to="/dashboard" className="feature-card">
          <div className="icon" style={{ background: '#f3e8ff' }}>
            <BarChart3 size={28} color="#8b5cf6" />
          </div>
          <h3>Dashboard</h3>
          <p>
            Track your learning streak, view statistics, and see your
            progress across all activities.
          </p>
        </Link>
      </div>
    </div>
  );
}
