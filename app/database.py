"""SQLite database setup and schema management."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import aiosqlite
from pathlib import Path

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "english_app.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    difficulty TEXT NOT NULL DEFAULT 'intermediate',
    role_swap INTEGER NOT NULL DEFAULT 0,
    personality TEXT DEFAULT 'patient_teacher',
    quick_mode INTEGER NOT NULL DEFAULT 0,
    target_words TEXT,
    summary_json TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    feedback_json TEXT,
    is_bookmarked INTEGER NOT NULL DEFAULT 0,
    speaking_seconds REAL,
    pace_wpm REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pronunciation_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference_text TEXT NOT NULL,
    user_transcription TEXT NOT NULL,
    feedback_json TEXT,
    score REAL,
    difficulty TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vocabulary_words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    word TEXT NOT NULL,
    meaning TEXT NOT NULL,
    example_sentence TEXT,
    difficulty INTEGER NOT NULL DEFAULT 1,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    etymology TEXT
);

CREATE TABLE IF NOT EXISTS vocabulary_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL,
    correct_count INTEGER NOT NULL DEFAULT 0,
    incorrect_count INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 0,
    last_reviewed TEXT,
    next_review_at TEXT,
    FOREIGN KEY (word_id) REFERENCES vocabulary_words(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_role_created ON messages(role, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_bookmarked ON messages(is_bookmarked) WHERE is_bookmarked = 1;
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_started_at ON conversations(started_at);
CREATE INDEX IF NOT EXISTS idx_vocabulary_topic ON vocabulary_words(topic);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vocabulary_progress_word ON vocabulary_progress(word_id);
CREATE INDEX IF NOT EXISTS idx_vocabulary_progress_review ON vocabulary_progress(next_review_at);
CREATE INDEX IF NOT EXISTS idx_vocabulary_progress_word_review ON vocabulary_progress(word_id, next_review_at);
CREATE INDEX IF NOT EXISTS idx_pron_attempts_created ON pronunciation_attempts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pron_attempts_reference ON pronunciation_attempts(reference_text);

CREATE TABLE IF NOT EXISTS quiz_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL,
    is_correct INTEGER NOT NULL,
    answered_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (word_id) REFERENCES vocabulary_words(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_word ON quiz_attempts(word_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_answered ON quiz_attempts(answered_at DESC);

CREATE TABLE IF NOT EXISTS learning_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_type TEXT NOT NULL CHECK (goal_type IN ('conversations', 'vocabulary_reviews', 'pronunciation_attempts', 'speaking_journal_entries', 'listening_quizzes')),
    daily_target INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(goal_type)
);

CREATE TABLE IF NOT EXISTS user_preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS listening_quiz_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    total_questions INTEGER NOT NULL,
    correct_count INTEGER NOT NULL,
    score REAL NOT NULL,
    passage TEXT NOT NULL DEFAULT '',
    questions_json TEXT NOT NULL DEFAULT '[]',
    first_listen_correct INTEGER NOT NULL DEFAULT 0,
    first_listen_total INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS custom_topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    scenario TEXT NOT NULL,
    goal TEXT NOT NULL DEFAULT 'Have a natural conversation',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS speaking_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt TEXT NOT NULL,
    transcript TEXT NOT NULL,
    word_count INTEGER NOT NULL DEFAULT 0,
    unique_word_count INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    wpm REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversation_self_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL UNIQUE,
    confidence_rating INTEGER NOT NULL CHECK (confidence_rating BETWEEN 1 AND 5),
    fluency_rating INTEGER NOT NULL CHECK (fluency_rating BETWEEN 1 AND 5),
    comprehension_rating INTEGER NOT NULL CHECK (comprehension_rating BETWEEN 1 AND 5),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS streak_freezes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    freeze_date TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_streak_freezes_date ON streak_freezes(freeze_date);

CREATE TABLE IF NOT EXISTS minimal_pair_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    correct INTEGER NOT NULL,
    total INTEGER NOT NULL,
    contrast_summary TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_mp_sessions_created ON minimal_pair_sessions(created_at DESC);

CREATE TABLE IF NOT EXISTS numbers_drill_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    expected TEXT NOT NULL,
    user_answer TEXT NOT NULL,
    is_correct INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_numbers_drill_created ON numbers_drill_attempts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_numbers_drill_kind ON numbers_drill_attempts(kind);

CREATE TABLE IF NOT EXISTS shadowing_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sentence TEXT NOT NULL,
    transcript TEXT NOT NULL DEFAULT '',
    accuracy REAL NOT NULL DEFAULT 0,
    timing_score REAL NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shadowing_attempts_created ON shadowing_attempts(created_at DESC);

CREATE TABLE IF NOT EXISTS dictation_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT,
    message_id TEXT,
    accuracy REAL NOT NULL,
    word_count INTEGER NOT NULL,
    missed_word_count INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dictation_attempts_created ON dictation_attempts(created_at DESC);

CREATE TABLE IF NOT EXISTS listening_speed_progress (
    topic TEXT PRIMARY KEY,
    max_speed REAL NOT NULL DEFAULT 1.0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reduced_form_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    reduction_type TEXT NOT NULL,
    reduced_text TEXT NOT NULL,
    full_text TEXT NOT NULL,
    user_expand TEXT NOT NULL DEFAULT '',
    expand_correct INTEGER NOT NULL DEFAULT 0,
    shadow_accuracy REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reduced_form_attempts_created ON reduced_form_attempts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reduced_form_attempts_type ON reduced_form_attempts(reduction_type);

CREATE TABLE IF NOT EXISTS stress_spotlight_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sentence TEXT NOT NULL,
    words_json TEXT NOT NULL DEFAULT '[]',
    expected_indices_json TEXT NOT NULL DEFAULT '[]',
    user_indices_json TEXT NOT NULL DEFAULT '[]',
    precision_score REAL NOT NULL DEFAULT 0,
    recall_score REAL NOT NULL DEFAULT 0,
    f1_score REAL NOT NULL DEFAULT 0,
    difficulty TEXT NOT NULL DEFAULT 'intermediate',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stress_spotlight_created ON stress_spotlight_attempts(created_at DESC);

CREATE TABLE IF NOT EXISTS sentence_echo_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    span INTEGER NOT NULL,
    accuracy REAL NOT NULL,
    passed INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sentence_echo_created ON sentence_echo_attempts(created_at DESC);

CREATE TABLE IF NOT EXISTS listen_summarize_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    overall REAL NOT NULL DEFAULT 0,
    coverage_ratio REAL NOT NULL DEFAULT 0,
    conciseness REAL NOT NULL DEFAULT 0,
    accuracy REAL NOT NULL DEFAULT 0,
    used_voice INTEGER NOT NULL DEFAULT 0,
    plays_used INTEGER NOT NULL DEFAULT 0,
    level TEXT NOT NULL DEFAULT 'intermediate'
);

CREATE INDEX IF NOT EXISTS idx_listen_summarize_created ON listen_summarize_attempts(created_at DESC);

CREATE TABLE IF NOT EXISTS linker_drill_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    chosen_linker TEXT NOT NULL,
    correct_linker TEXT NOT NULL,
    is_correct INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL,
    spoken_similarity REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_linker_drill_created ON linker_drill_attempts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_linker_drill_category ON linker_drill_attempts(category);

-- collocation_attempts: table + indexes are created via migrations to safely handle
-- any stale prior schema. See _MIGRATIONS below (drop stale + create + indexes).

CREATE TABLE IF NOT EXISTS number_dictation_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    category TEXT NOT NULL,
    total INTEGER NOT NULL,
    correct INTEGER NOT NULL,
    accuracy REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_number_dictation_created ON number_dictation_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_number_dictation_category ON number_dictation_sessions(category);

CREATE TABLE IF NOT EXISTS speed_ladder_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    speed REAL NOT NULL,
    correct INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_speed_ladder_created ON speed_ladder_attempts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_speed_ladder_session ON speed_ladder_attempts(session_id);

CREATE TABLE IF NOT EXISTS monologue_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scenario_id TEXT NOT NULL,
    transcript TEXT NOT NULL,
    duration_seconds REAL NOT NULL,
    word_count INTEGER NOT NULL DEFAULT 0,
    filler_count INTEGER NOT NULL DEFAULT 0,
    wpm REAL NOT NULL DEFAULT 0,
    coverage_ratio REAL NOT NULL DEFAULT 0,
    fluency_score INTEGER NOT NULL DEFAULT 0,
    structure_score INTEGER NOT NULL DEFAULT 0,
    overall_score INTEGER NOT NULL DEFAULT 0,
    feedback_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_monologue_created ON monologue_attempts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_monologue_scenario ON monologue_attempts(scenario_id);

CREATE TABLE IF NOT EXISTS tense_contrast_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    session_id TEXT,
    item_id TEXT,
    tense_label TEXT,
    user_answer TEXT,
    correct INTEGER NOT NULL DEFAULT 0,
    elapsed_ms INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tense_contrast_created ON tense_contrast_attempts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tense_contrast_session ON tense_contrast_attempts(session_id);

CREATE TABLE IF NOT EXISTS article_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    difficulty TEXT NOT NULL,
    total_count INTEGER NOT NULL,
    correct_count INTEGER NOT NULL,
    blanks_json TEXT NOT NULL,
    answers_json TEXT NOT NULL,
    categories_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_article_attempts_created ON article_attempts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_attempts_difficulty ON article_attempts(difficulty);

CREATE TABLE IF NOT EXISTS wh_question_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    target_wh TEXT NOT NULL,
    is_correct INTEGER NOT NULL,
    grammar_ok INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wh_question_user_id ON wh_question_attempts(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_wh_question_created ON wh_question_attempts(created_at DESC);

CREATE TABLE IF NOT EXISTS error_correction_sessions (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    level TEXT NOT NULL,
    score REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT
);

CREATE TABLE IF NOT EXISTS error_correction_items (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    idx INTEGER NOT NULL DEFAULT 0,
    wrong TEXT NOT NULL,
    reference TEXT NOT NULL,
    error_type TEXT,
    hint_ja TEXT,
    user_answer TEXT,
    is_correct INTEGER,
    explanation_ja TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES error_correction_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_error_correction_items_session ON error_correction_items(session_id, idx);
CREATE INDEX IF NOT EXISTS idx_error_correction_sessions_created ON error_correction_sessions(created_at DESC);

CREATE TABLE IF NOT EXISTS minimal_pairs_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    contrast TEXT NOT NULL,
    word_a TEXT NOT NULL,
    word_b TEXT NOT NULL,
    target TEXT NOT NULL CHECK (target IN ('a', 'b')),
    chosen TEXT NOT NULL CHECK (chosen IN ('a', 'b')),
    is_correct INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mp_attempts_contrast ON minimal_pairs_attempts(contrast);
CREATE INDEX IF NOT EXISTS idx_mp_attempts_created ON minimal_pairs_attempts(created_at DESC);

CREATE TABLE IF NOT EXISTS connected_speech_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    reduced TEXT NOT NULL,
    expanded TEXT NOT NULL,
    user_answer TEXT NOT NULL,
    correct INTEGER NOT NULL,
    category TEXT,
    time_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_connected_speech_category ON connected_speech_attempts(category);
CREATE INDEX IF NOT EXISTS idx_connected_speech_created ON connected_speech_attempts(created_at DESC);

CREATE TABLE IF NOT EXISTS preposition_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    chosen TEXT NOT NULL,
    correct TEXT NOT NULL,
    is_correct INTEGER NOT NULL,
    category TEXT,
    response_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_preposition_attempts_category ON preposition_attempts(category);
CREATE INDEX IF NOT EXISTS idx_preposition_attempts_created ON preposition_attempts(created_at DESC);

CREATE TABLE IF NOT EXISTS pause_predict_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    difficulty TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    correct INTEGER NOT NULL DEFAULT 0,
    close INTEGER NOT NULL DEFAULT 0,
    avg_score REAL NOT NULL DEFAULT 0.0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pause_predict_sessions_created
    ON pause_predict_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pause_predict_sessions_difficulty
    ON pause_predict_sessions(difficulty);

CREATE TABLE IF NOT EXISTS intonation_arrow_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    chosen TEXT NOT NULL,
    correct INTEGER NOT NULL,
    latency_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_intonation_arrow_created
    ON intonation_arrow_attempts(created_at);
"""

# ---------------------------------------------------------------------------
# Migrations — each entry is an (description, SQL) tuple.
# These handle schema changes for EXISTING databases where CREATE TABLE IF NOT
# EXISTS will NOT add new columns. Add new migrations to the END of the list.
# ---------------------------------------------------------------------------
_MIGRATIONS: list[tuple[str, str]] = [
    (
        "add difficulty column to conversations",
        "ALTER TABLE conversations ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'intermediate'",
    ),
    (
        "add summary_json column to conversations",
        "ALTER TABLE conversations ADD COLUMN summary_json TEXT",
    ),
    (
        "add is_favorite column to vocabulary_words",
        "ALTER TABLE vocabulary_words ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0",
    ),
    (
        "add notes column to vocabulary_words",
        "ALTER TABLE vocabulary_words ADD COLUMN notes TEXT",
    ),
    (
        "add is_bookmarked column to messages",
        "ALTER TABLE messages ADD COLUMN is_bookmarked INTEGER NOT NULL DEFAULT 0",
    ),
    (
        "add difficulty column to pronunciation_attempts",
        "ALTER TABLE pronunciation_attempts ADD COLUMN difficulty TEXT",
    ),
    (
        "deduplicate vocabulary_progress rows",
        "DELETE FROM vocabulary_progress WHERE id NOT IN (SELECT MAX(id) FROM vocabulary_progress GROUP BY word_id)",
    ),
    (
        "add unique index on vocabulary_progress word_id",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_vp_word_id_unique ON vocabulary_progress(word_id)",
    ),
    (
        "add index on conversations started_at for dashboard queries",
        "CREATE INDEX IF NOT EXISTS idx_conversations_started_at ON conversations(started_at)",
    ),
    (
        "add role_swap column to conversations",
        "ALTER TABLE conversations ADD COLUMN role_swap INTEGER NOT NULL DEFAULT 0",
    ),
    (
        "create minimal_pairs_results table",
        """CREATE TABLE IF NOT EXISTS minimal_pairs_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            total_pairs INTEGER NOT NULL,
            correct_count INTEGER NOT NULL,
            difficulty TEXT,
            phoneme_results_json TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
    ),
    (
        "create session_logs table",
        """CREATE TABLE IF NOT EXISTS session_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_type TEXT NOT NULL,
            metadata_json TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
    ),
    (
        "add session_logs indexes",
        "CREATE INDEX IF NOT EXISTS idx_session_logs_type ON session_logs(session_type)",
    ),
    (
        "add etymology column to vocabulary_words",
        "ALTER TABLE vocabulary_words ADD COLUMN etymology TEXT",
    ),
    (
        "drop and recreate minimal_pairs_results with per-pair schema",
        "DROP TABLE IF EXISTS minimal_pairs_results",
    ),
    (
        "create minimal_pairs_results table v2",
        """CREATE TABLE IF NOT EXISTS minimal_pairs_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phoneme_contrast TEXT NOT NULL,
            word_a TEXT NOT NULL,
            word_b TEXT NOT NULL,
            is_correct INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
    ),
    (
        "add index on minimal_pairs_results phoneme_contrast",
        "CREATE INDEX IF NOT EXISTS idx_mp_results_contrast ON minimal_pairs_results(phoneme_contrast)",
    ),
    (
        "add index on minimal_pairs_results created_at",
        "CREATE INDEX IF NOT EXISTS idx_mp_results_created ON minimal_pairs_results(created_at DESC)",
    ),
    (
        "create listening_quiz_results table",
        """CREATE TABLE IF NOT EXISTS listening_quiz_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            difficulty TEXT NOT NULL,
            total_questions INTEGER NOT NULL,
            correct_count INTEGER NOT NULL,
            score REAL NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
    ),
    (
        "add topic column to listening_quiz_results",
        "ALTER TABLE listening_quiz_results ADD COLUMN topic TEXT NOT NULL DEFAULT ''",
    ),
    (
        "add passage column to listening_quiz_results",
        "ALTER TABLE listening_quiz_results ADD COLUMN passage TEXT NOT NULL DEFAULT ''",
    ),
    (
        "add questions_json column to listening_quiz_results",
        "ALTER TABLE listening_quiz_results ADD COLUMN questions_json TEXT NOT NULL DEFAULT '[]'",
    ),
    (
        "add first_listen_correct column to listening_quiz_results",
        "ALTER TABLE listening_quiz_results ADD COLUMN first_listen_correct INTEGER NOT NULL DEFAULT 0",
    ),
    (
        "add first_listen_total column to listening_quiz_results",
        "ALTER TABLE listening_quiz_results ADD COLUMN first_listen_total INTEGER NOT NULL DEFAULT 0",
    ),
    (
        "create custom_topics table for user-defined conversation scenarios",
        """CREATE TABLE IF NOT EXISTS custom_topics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            topic_id TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            scenario TEXT NOT NULL,
            goal TEXT NOT NULL DEFAULT 'Have a natural conversation',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
    ),
    (
        "create speaking_journal table for daily speaking practice",
        """CREATE TABLE IF NOT EXISTS speaking_journal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            prompt TEXT NOT NULL,
            transcript TEXT NOT NULL,
            word_count INTEGER NOT NULL DEFAULT 0,
            unique_word_count INTEGER NOT NULL DEFAULT 0,
            duration_seconds INTEGER NOT NULL DEFAULT 0,
            wpm REAL NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
    ),
    (
        "add filler_word_count column to speaking_journal",
        "ALTER TABLE speaking_journal ADD COLUMN filler_word_count INTEGER NOT NULL DEFAULT 0",
    ),
    (
        "expand learning_goals goal_type CHECK constraint to include speaking_journal_entries and listening_quizzes",
        """CREATE TABLE IF NOT EXISTS learning_goals_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            goal_type TEXT NOT NULL CHECK (goal_type IN ('conversations', 'vocabulary_reviews', 'pronunciation_attempts', 'speaking_journal_entries', 'listening_quizzes')),
            daily_target INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(goal_type)
        )""",
    ),
    (
        "migrate learning_goals data to new table",
        "INSERT OR IGNORE INTO learning_goals_new (id, goal_type, daily_target, created_at, updated_at) SELECT id, goal_type, daily_target, created_at, updated_at FROM learning_goals",
    ),
    (
        "drop old learning_goals table",
        "DROP TABLE IF EXISTS learning_goals",
    ),
    (
        "rename learning_goals_new to learning_goals",
        "ALTER TABLE learning_goals_new RENAME TO learning_goals",
    ),
    (
        "create conversation_self_assessments table",
        """CREATE TABLE IF NOT EXISTS conversation_self_assessments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL UNIQUE,
            confidence_rating INTEGER NOT NULL CHECK (confidence_rating BETWEEN 1 AND 5),
            fluency_rating INTEGER NOT NULL CHECK (fluency_rating BETWEEN 1 AND 5),
            comprehension_rating INTEGER NOT NULL CHECK (comprehension_rating BETWEEN 1 AND 5),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        )""",
    ),
    (
        "create streak_freezes table for streak freeze protection",
        """CREATE TABLE IF NOT EXISTS streak_freezes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            freeze_date TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
    ),
    (
        "add index on streak_freezes freeze_date",
        "CREATE INDEX IF NOT EXISTS idx_streak_freezes_date ON streak_freezes(freeze_date)",
    ),
    (
        "add word_family_json column to vocabulary_words",
        "ALTER TABLE vocabulary_words ADD COLUMN word_family_json TEXT",
    ),
    (
        "create minimal_pair_sessions table",
        """CREATE TABLE IF NOT EXISTS minimal_pair_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            correct INTEGER NOT NULL,
            total INTEGER NOT NULL,
            contrast_summary TEXT NOT NULL DEFAULT '{}'
        )""",
    ),
    (
        "add index on minimal_pair_sessions created_at",
        "CREATE INDEX IF NOT EXISTS idx_mp_sessions_created ON minimal_pair_sessions(created_at DESC)",
    ),
    (
        "add personality column to conversations",
        "ALTER TABLE conversations ADD COLUMN personality TEXT NOT NULL DEFAULT 'patient_teacher'",
    ),
    (
        "create numbers_drill_attempts table",
        """CREATE TABLE IF NOT EXISTS numbers_drill_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            expected TEXT NOT NULL,
            user_answer TEXT NOT NULL,
            is_correct INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
    ),
    (
        "add index on numbers_drill_attempts created_at",
        "CREATE INDEX IF NOT EXISTS idx_numbers_drill_created ON numbers_drill_attempts(created_at DESC)",
    ),
    (
        "add index on numbers_drill_attempts kind",
        "CREATE INDEX IF NOT EXISTS idx_numbers_drill_kind ON numbers_drill_attempts(kind)",
    ),
    (
        "create shadowing_attempts table",
        """CREATE TABLE IF NOT EXISTS shadowing_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sentence TEXT NOT NULL,
            transcript TEXT NOT NULL DEFAULT '',
            accuracy REAL NOT NULL DEFAULT 0,
            timing_score REAL NOT NULL DEFAULT 0,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
    ),
    (
        "add index on shadowing_attempts created_at",
        "CREATE INDEX IF NOT EXISTS idx_shadowing_attempts_created ON shadowing_attempts(created_at DESC)",
    ),
    (
        "add quick_mode column to conversations",
        "ALTER TABLE conversations ADD COLUMN quick_mode INTEGER NOT NULL DEFAULT 0",
    ),
    (
        "add speaking_seconds column to messages",
        "ALTER TABLE messages ADD COLUMN speaking_seconds REAL",
    ),
    (
        "add pace_wpm column to messages",
        "ALTER TABLE messages ADD COLUMN pace_wpm REAL",
    ),
    (
        "create listening_speed_progress table",
        """CREATE TABLE IF NOT EXISTS listening_speed_progress (
            topic TEXT PRIMARY KEY,
            max_speed REAL NOT NULL DEFAULT 1.0,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
    ),
    (
        "create reduced_form_attempts table",
        """CREATE TABLE IF NOT EXISTS reduced_form_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id TEXT NOT NULL,
            reduction_type TEXT NOT NULL,
            reduced_text TEXT NOT NULL,
            full_text TEXT NOT NULL,
            user_expand TEXT NOT NULL DEFAULT '',
            expand_correct INTEGER NOT NULL DEFAULT 0,
            shadow_accuracy REAL NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
    ),
    (
        "add index on reduced_form_attempts created_at",
        "CREATE INDEX IF NOT EXISTS idx_reduced_form_attempts_created ON reduced_form_attempts(created_at DESC)",
    ),
    (
        "add index on reduced_form_attempts reduction_type",
        "CREATE INDEX IF NOT EXISTS idx_reduced_form_attempts_type ON reduced_form_attempts(reduction_type)",
    ),
    (
        "create stress_spotlight_attempts table",
        """CREATE TABLE IF NOT EXISTS stress_spotlight_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sentence TEXT NOT NULL,
            words_json TEXT NOT NULL DEFAULT '[]',
            expected_indices_json TEXT NOT NULL DEFAULT '[]',
            user_indices_json TEXT NOT NULL DEFAULT '[]',
            precision_score REAL NOT NULL DEFAULT 0,
            recall_score REAL NOT NULL DEFAULT 0,
            f1_score REAL NOT NULL DEFAULT 0,
            difficulty TEXT NOT NULL DEFAULT 'intermediate',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
    ),
    (
        "add index on stress_spotlight_attempts created_at",
        "CREATE INDEX IF NOT EXISTS idx_stress_spotlight_created ON stress_spotlight_attempts(created_at DESC)",
    ),
    (
        "add target_words column to conversations",
        "ALTER TABLE conversations ADD COLUMN target_words TEXT",
    ),
    (
        "create sentence_echo_attempts table",
        """CREATE TABLE IF NOT EXISTS sentence_echo_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            span INTEGER NOT NULL,
            accuracy REAL NOT NULL,
            passed INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
    ),
    (
        "add index on sentence_echo_attempts created_at",
        "CREATE INDEX IF NOT EXISTS idx_sentence_echo_created ON sentence_echo_attempts(created_at DESC)",
    ),
    (
        "create linker_drill_attempts table",
        """CREATE TABLE IF NOT EXISTS linker_drill_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id TEXT NOT NULL,
            chosen_linker TEXT NOT NULL,
            correct_linker TEXT NOT NULL,
            is_correct INTEGER NOT NULL DEFAULT 0,
            category TEXT NOT NULL,
            spoken_similarity REAL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
    ),
    (
        "add index on linker_drill_attempts created_at",
        "CREATE INDEX IF NOT EXISTS idx_linker_drill_created ON linker_drill_attempts(created_at DESC)",
    ),
    (
        "add index on linker_drill_attempts category",
        "CREATE INDEX IF NOT EXISTS idx_linker_drill_category ON linker_drill_attempts(category)",
    ),
    (
        "create number_dictation_sessions table",
        """CREATE TABLE IF NOT EXISTS number_dictation_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            category TEXT NOT NULL,
            total INTEGER NOT NULL,
            correct INTEGER NOT NULL,
            accuracy REAL NOT NULL
        )""",
    ),
    (
        "add index on number_dictation_sessions created_at",
        "CREATE INDEX IF NOT EXISTS idx_number_dictation_created ON number_dictation_sessions(created_at DESC)",
    ),
    (
        "add index on number_dictation_sessions category",
        "CREATE INDEX IF NOT EXISTS idx_number_dictation_category ON number_dictation_sessions(category)",
    ),
    (
        "create speed_ladder_attempts table",
        """CREATE TABLE IF NOT EXISTS speed_ladder_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            speed REAL NOT NULL,
            correct INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
    ),
    (
        "add index on speed_ladder_attempts created_at",
        "CREATE INDEX IF NOT EXISTS idx_speed_ladder_created ON speed_ladder_attempts(created_at DESC)",
    ),
    (
        "add index on speed_ladder_attempts session_id",
        "CREATE INDEX IF NOT EXISTS idx_speed_ladder_session ON speed_ladder_attempts(session_id)",
    ),
    (
        "create monologue_attempts table",
        """CREATE TABLE IF NOT EXISTS monologue_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scenario_id TEXT NOT NULL,
            transcript TEXT NOT NULL,
            duration_seconds REAL NOT NULL,
            word_count INTEGER NOT NULL DEFAULT 0,
            filler_count INTEGER NOT NULL DEFAULT 0,
            wpm REAL NOT NULL DEFAULT 0,
            coverage_ratio REAL NOT NULL DEFAULT 0,
            fluency_score INTEGER NOT NULL DEFAULT 0,
            structure_score INTEGER NOT NULL DEFAULT 0,
            overall_score INTEGER NOT NULL DEFAULT 0,
            feedback_json TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
    ),
    (
        "add index on monologue_attempts created_at",
        "CREATE INDEX IF NOT EXISTS idx_monologue_created ON monologue_attempts(created_at DESC)",
    ),
    (
        "add index on monologue_attempts scenario_id",
        "CREATE INDEX IF NOT EXISTS idx_monologue_scenario ON monologue_attempts(scenario_id)",
    ),
    (
        "create tense_contrast_attempts table",
        """CREATE TABLE IF NOT EXISTS tense_contrast_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            session_id TEXT,
            item_id TEXT,
            tense_label TEXT,
            user_answer TEXT,
            correct INTEGER NOT NULL DEFAULT 0,
            elapsed_ms INTEGER NOT NULL DEFAULT 0
        )""",
    ),
    (
        "add index on tense_contrast_attempts created_at",
        "CREATE INDEX IF NOT EXISTS idx_tense_contrast_created ON tense_contrast_attempts(created_at DESC)",
    ),
    (
        "add index on tense_contrast_attempts session_id",
        "CREATE INDEX IF NOT EXISTS idx_tense_contrast_session ON tense_contrast_attempts(session_id)",
    ),
    (
        "create wh_question_attempts table",
        """CREATE TABLE IF NOT EXISTS wh_question_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            target_wh TEXT NOT NULL,
            is_correct INTEGER NOT NULL,
            grammar_ok INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
    ),
    (
        "add index on wh_question_attempts user_id",
        "CREATE INDEX IF NOT EXISTS idx_wh_question_user_id ON wh_question_attempts(user_id, id DESC)",
    ),
    (
        "add index on wh_question_attempts created_at",
        "CREATE INDEX IF NOT EXISTS idx_wh_question_created ON wh_question_attempts(created_at DESC)",
    ),
    (
        "create error_correction_sessions table",
        """CREATE TABLE IF NOT EXISTS error_correction_sessions (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            level TEXT NOT NULL,
            score REAL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            finished_at TEXT
        )""",
    ),
    (
        "create error_correction_items table",
        """CREATE TABLE IF NOT EXISTS error_correction_items (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            idx INTEGER NOT NULL DEFAULT 0,
            wrong TEXT NOT NULL,
            reference TEXT NOT NULL,
            error_type TEXT,
            hint_ja TEXT,
            user_answer TEXT,
            is_correct INTEGER,
            explanation_ja TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
    ),
    (
        "add index on error_correction_items session",
        "CREATE INDEX IF NOT EXISTS idx_error_correction_items_session ON error_correction_items(session_id, idx)",
    ),
    (
        "add index on error_correction_sessions created_at",
        "CREATE INDEX IF NOT EXISTS idx_error_correction_sessions_created ON error_correction_sessions(created_at DESC)",
    ),
    (
        "create minimal_pairs_attempts table for phoneme-contrast drill",
        """CREATE TABLE IF NOT EXISTS minimal_pairs_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id TEXT NOT NULL,
            contrast TEXT NOT NULL,
            word_a TEXT NOT NULL,
            word_b TEXT NOT NULL,
            target TEXT NOT NULL CHECK (target IN ('a', 'b')),
            chosen TEXT NOT NULL CHECK (chosen IN ('a', 'b')),
            is_correct INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
    ),
    (
        "add index on minimal_pairs_attempts contrast",
        "CREATE INDEX IF NOT EXISTS idx_mp_attempts_contrast ON minimal_pairs_attempts(contrast)",
    ),
    (
        "add index on minimal_pairs_attempts created_at",
        "CREATE INDEX IF NOT EXISTS idx_mp_attempts_created ON minimal_pairs_attempts(created_at DESC)",
    ),
    (
        "create connected_speech_attempts table for Connected Speech Decoder drill",
        """CREATE TABLE IF NOT EXISTS connected_speech_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            reduced TEXT NOT NULL,
            expanded TEXT NOT NULL,
            user_answer TEXT NOT NULL,
            correct INTEGER NOT NULL,
            category TEXT,
            time_ms INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
    ),
    (
        "add index on connected_speech_attempts category",
        "CREATE INDEX IF NOT EXISTS idx_connected_speech_category ON connected_speech_attempts(category)",
    ),
    (
        "add index on connected_speech_attempts created_at",
        "CREATE INDEX IF NOT EXISTS idx_connected_speech_created ON connected_speech_attempts(created_at DESC)",
    ),
    (
        "create preposition_attempts table for Preposition Cloze Drill",
        """CREATE TABLE IF NOT EXISTS preposition_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id TEXT NOT NULL,
            chosen TEXT NOT NULL,
            correct TEXT NOT NULL,
            is_correct INTEGER NOT NULL,
            category TEXT,
            response_ms INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
    ),
    (
        "add index on preposition_attempts category",
        "CREATE INDEX IF NOT EXISTS idx_preposition_attempts_category ON preposition_attempts(category)",
    ),
    (
        "add index on preposition_attempts created_at",
        "CREATE INDEX IF NOT EXISTS idx_preposition_attempts_created ON preposition_attempts(created_at DESC)",
    ),
    (
        "create pause_predict_sessions table for Pause & Predict drill",
        """CREATE TABLE IF NOT EXISTS pause_predict_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            difficulty TEXT NOT NULL,
            total INTEGER NOT NULL DEFAULT 0,
            correct INTEGER NOT NULL DEFAULT 0,
            close INTEGER NOT NULL DEFAULT 0,
            avg_score REAL NOT NULL DEFAULT 0.0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
    ),
    (
        "add index on pause_predict_sessions created_at",
        "CREATE INDEX IF NOT EXISTS idx_pause_predict_sessions_created ON pause_predict_sessions(created_at DESC)",
    ),
    (
        "add index on pause_predict_sessions difficulty",
        "CREATE INDEX IF NOT EXISTS idx_pause_predict_sessions_difficulty ON pause_predict_sessions(difficulty)",
    ),
    (
        "create article_attempts table",
        """CREATE TABLE IF NOT EXISTS article_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            difficulty TEXT NOT NULL,
            total_count INTEGER NOT NULL,
            correct_count INTEGER NOT NULL,
            blanks_json TEXT NOT NULL,
            answers_json TEXT NOT NULL,
            categories_json TEXT NOT NULL
        )""",
    ),
    (
        "add index on article_attempts created_at",
        "CREATE INDEX IF NOT EXISTS idx_article_attempts_created ON article_attempts(created_at DESC)",
    ),
    (
        "add index on article_attempts difficulty",
        "CREATE INDEX IF NOT EXISTS idx_article_attempts_difficulty ON article_attempts(difficulty)",
    ),
    (
        "create intonation_arrow_attempts table",
        """CREATE TABLE IF NOT EXISTS intonation_arrow_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id TEXT NOT NULL,
            chosen TEXT NOT NULL,
            correct INTEGER NOT NULL,
            latency_ms INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
    ),
    (
        "add index on intonation_arrow_attempts created_at",
        "CREATE INDEX IF NOT EXISTS idx_intonation_arrow_created ON intonation_arrow_attempts(created_at)",
    ),
    (
        "drop stale collocation_attempts table from prior discarded iteration",
        "DROP TABLE IF EXISTS collocation_attempts",
    ),
    (
        "create collocation_attempts table",
        """CREATE TABLE IF NOT EXISTS collocation_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id TEXT NOT NULL,
            sentence TEXT NOT NULL,
            correct_verb TEXT NOT NULL,
            chosen_verb TEXT NOT NULL,
            is_correct INTEGER NOT NULL,
            response_ms INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""",
    ),
    (
        "add index on collocation_attempts created_at",
        "CREATE INDEX IF NOT EXISTS idx_colloc_created ON collocation_attempts(created_at)",
    ),
    (
        "add index on collocation_attempts correct_verb",
        "CREATE INDEX IF NOT EXISTS idx_colloc_verb ON collocation_attempts(correct_verb)",
    ),
]


async def _apply_migrations(db: aiosqlite.Connection) -> None:
    """Apply pending migrations with version tracking.

    Uses a schema_migrations table to track which migrations have been applied,
    skipping already-applied ones and recording new ones.
    """
    # Ensure tracking table exists
    await db.execute(
        """CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            description TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"""
    )
    await db.commit()

    # Find already-applied versions
    rows = await db.execute_fetchall("SELECT version FROM schema_migrations")
    applied = {r["version"] for r in rows}

    for idx, (desc, sql) in enumerate(_MIGRATIONS):
        if idx in applied:
            continue
        try:
            await db.execute(sql)
            await db.execute(
                "INSERT INTO schema_migrations (version, description) VALUES (?, ?)",
                (idx, desc),
            )
            logger.info("Migration %d applied: %s", idx, desc)
        except Exception as exc:
            # Tolerate "duplicate column" / "already exists" errors for bootstrap
            err_msg = str(exc).lower()
            if "duplicate" in err_msg or "already exists" in err_msg:
                # Record as applied so we don't retry
                try:
                    await db.execute(
                        "INSERT OR IGNORE INTO schema_migrations (version, description) VALUES (?, ?)",
                        (idx, desc),
                    )
                except Exception:
                    pass
                logger.debug("Migration %d already applied: %s", idx, desc)
            else:
                logger.error("Migration %d failed: %s — %s", idx, desc, exc)
                raise
    await db.commit()


async def get_db() -> aiosqlite.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(str(DB_PATH))
    try:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")
    except Exception:
        await db.close()
        raise
    return db


async def get_db_session() -> AsyncGenerator[aiosqlite.Connection, None]:
    """FastAPI dependency that yields a DB connection and auto-closes it."""
    db = await get_db()
    try:
        yield db
    except Exception:
        await db.rollback()
        raise
    finally:
        await db.close()


async def init_db() -> None:
    db = await get_db()
    try:
        await db.executescript(SCHEMA)
        await db.commit()
        await _apply_migrations(db)
    finally:
        await db.close()


_checkpoint_task: asyncio.Task | None = None


async def wal_checkpoint(db_path: Path | None = None) -> dict[str, int]:
    """Run a passive WAL checkpoint and return page counts."""
    path = db_path or DB_PATH
    db = await aiosqlite.connect(str(path))
    try:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall("PRAGMA wal_checkpoint(PASSIVE)")
        row = rows[0] if rows else None
        result = {
            "busy": row["busy"] if row else 0,
            "log": row["log"] if row else 0,
            "checkpointed": row["checkpointed"] if row else 0,
        }
        logger.debug("WAL checkpoint: busy=%d, log=%d, checkpointed=%d",
                      result["busy"], result["log"], result["checkpointed"])
        return result
    finally:
        await db.close()


async def _checkpoint_loop(interval: int) -> None:
    """Background loop that periodically checkpoints the WAL."""
    while True:
        await asyncio.sleep(interval)
        try:
            await wal_checkpoint()
        except Exception:
            logger.exception("WAL checkpoint failed")


def start_wal_checkpoint_task(interval_seconds: int = 300) -> asyncio.Task:
    """Start the periodic WAL checkpoint background task."""
    global _checkpoint_task
    if _checkpoint_task is not None and not _checkpoint_task.done():
        return _checkpoint_task
    _checkpoint_task = asyncio.create_task(_checkpoint_loop(interval_seconds))
    logger.info("WAL checkpoint task started (interval=%ds)", interval_seconds)
    return _checkpoint_task


def stop_wal_checkpoint_task() -> None:
    """Cancel the background WAL checkpoint task if running."""
    global _checkpoint_task
    if _checkpoint_task is not None and not _checkpoint_task.done():
        _checkpoint_task.cancel()
        logger.info("WAL checkpoint task cancelled")
    _checkpoint_task = None
