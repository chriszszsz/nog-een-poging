import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";

import { pool } from "./config/db.js";

dotenv.config();

const app = express();

/* =========================
   MIDDLEWARE
========================= */

app.use(cors());
app.use(helmet());
app.use(express.json());

/* =========================
   HEALTH CHECKS
========================= */

app.get("/", (req, res) => {
  res.send("API draait v1.0.0 ✅");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
  });
});

/* =========================
   DATABASE TEST
========================= */

app.get("/api/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.json({
      message: "Database werkt ✅",
      time: result.rows[0],
    });

  } catch (err) {
    console.error("DB ERROR:", err);

    res.status(500).json({
      error: err.message,
    });
  }
});

/* =========================
   GET ALLE ASSESSMENTS
========================= */

app.get("/api/assessments", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM assessment_sessions
      ORDER BY submitted_at DESC
    `);

    res.json(result.rows);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message,
    });
  }
});

/* =========================
   NIEUWE ASSESSMENT
========================= */

app.post("/api/assessments", async (req, res) => {
  try {
    const { organization_id } = req.body;

    if (!organization_id) {
      return res.status(400).json({
        error: "organization_id is verplicht",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO assessment_sessions
      (organization_id, status)
      VALUES ($1, 'draft')
      RETURNING *
      `,
      [organization_id]
    );

    res.json(result.rows[0]);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message,
    });
  }
});

/* =========================
   ANTWOORD OPSLAAN
========================= */

app.post("/api/answers", async (req, res) => {
  try {
    const {
      assessment_session_id,
      question_id,
      score,
      comment,
    } = req.body;

    if (
      !assessment_session_id ||
      !question_id ||
      score === undefined
    ) {
      return res.status(400).json({
        error: "Verplichte velden ontbreken",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO assessment_answers
      (
        assessment_session_id,
        question_id,
        score,
        comment
      )
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [
        assessment_session_id,
        question_id,
        score,
        comment,
      ]
    );

    res.json(result.rows[0]);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message,
    });
  }
});

/* =========================
   404 HANDLER
========================= */

app.use((req, res) => {
  res.status(404).json({
    error: "Route niet gevonden",
  });
});

/* =========================
   SERVER START
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server draait op poort ${PORT}`);
});