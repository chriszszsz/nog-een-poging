-- =========================
-- ASSESSMENT SESSIES
-- =========================
CREATE TABLE assessment_sessions (
  assessment_session_id SERIAL PRIMARY KEY,
  organization_id INT,
  status TEXT DEFAULT 'draft',
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- ANTWOORDEN
-- =========================
CREATE TABLE assessment_answers (
  answer_id SERIAL PRIMARY KEY,
  assessment_session_id INT,
  question_id INT,
  score INT,
  comment TEXT
);