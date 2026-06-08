import express from "express";
import pkg from "pg";

const { Pool } = pkg;

const app = express();

// ✅ BELANGRIJK: body parsing
app.use(express.json());

/* =========================
   DATABASE CONNECTIE
========================= */

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

/* =========================
   TEST ENDPOINT (DB)
========================= */

app.get("/api/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      message: "Database werkt!",
      time: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "DB connectie faalt"
    });
  }
});

/* =========================
   HEALTH CHECK
========================= */

app.get("/", (req, res) => {
  res.send("API draait ✅");
});

/* =========================
   GET ALLE ASSESSMENTS
========================= */

app.get("/api/assessments", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM assessment_sessions
      ORDER BY submitted_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message
    });
  }
});

/* =========================
   NIEUWE ASSESSMENT MAKEN
========================= */

app.post("/api/assessments", async (req, res) => {
  try {
    const { organization_id } = req.body;

    if (!organization_id) {
      return res.status(400).json({
        error: "organization_id is verplicht"
      });
    }

    const result = await pool.query(
      `INSERT INTO assessment_sessions (organization_id, status)
       VALUES ($1, 'draft')
       RETURNING *`,
      [organization_id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message
    });
  }
});

/* =========================
   ANTWOORD OPSLAAN
========================= */

app.post("/api/answers", async (req, res) => {
  try {
    const { assessment_session_id, question_id, score, comment } = req.body;

    if (!assessment_session_id || !question_id || score === undefined) {
      return res.status(400).json({
        error: "Verplichte velden ontbreken"
      });
    }

    const result = await pool.query(
      `INSERT INTO assessment_answers 
       (assessment_session_id, question_id, score, comment)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [assessment_session_id, question_id, score, comment]
    );

    res.json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message
    });
  }
});

/* =========================
   SERVER START
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server draait op poort ${PORT}`);
});