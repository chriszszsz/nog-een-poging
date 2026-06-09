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

    const result =
      await pool.query("SELECT NOW()");

    res.json({
      message: "Database werkt ✅",
      time: result.rows[0],
    });

  } catch (err) {

    console.error(err);

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
      ORDER BY assessment_session_id DESC
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

    const {
      company_name,
      maturity_level,
      average_score,
      assessment_date,
      status,
      report_suggestion,
      spider_scores,
      details,
      last_updated,
      answers
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO assessment_sessions
      (
        company_name,
        maturity_level,
        average_score,
        assessment_date,
        status,
        report_suggestion,
        spider_scores,
        details,
        last_updated
      )
      VALUES
      (
        $1, $2, $3, $4, $5, $6, $7, $8, $9
      )
      RETURNING *
      `,
      [
        company_name,
        maturity_level,
        average_score,
        assessment_date,
        status,
        report_suggestion,
        spider_scores,
        details,
        last_updated
      ]
    );

    const assessment = result.rows[0];

    if (answers && Array.isArray(answers)) {

      for (let i = 0; i < answers.length; i++) {

        const answer = answers[i];

        await pool.query(
          `
          INSERT INTO assessment_answers
          (
            assessment_session_id,
            question_id,
            score,
            comment
          )
          VALUES ($1, $2, $3, $4)
          `,
          [
            assessment.assessment_session_id,
            i + 1,
            typeof answer === "number"
              ? answer
              : null,
            typeof answer === "string"
              ? answer
              : null
          ]
        );

      }

    }

    res.status(201).json({
      success: true,
      assessment
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message,
    });

  }

});
/* =========================
   GET QUESTIONS
========================= */

app.get("/api/questions", async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT
          t.domain,
          t.subdomain,

          q.question_id,
          q.question_type,
          q.question_role,
          q.question_text,

          q.option_a,
          q.option_b,
          q.option_c,
          q.option_d,
          q.option_e,

          q.display_order

      FROM questions q

      JOIN assessment_topics t
      ON q.topic_id = t.topic_id

      ORDER BY q.display_order ASC
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