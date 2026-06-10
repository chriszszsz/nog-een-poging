import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "./config/db.js";
import { authMiddleware }
from "./middleware/auth.js";

dotenv.config();

const app = express();

/* =========================
   MIDDLEWARE
========================= */

app.use((req, res, next) => {

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();

});

app.use(express.json());

app.use(helmet());

app.use(cors());


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
   MY CAMPAIGNS
========================= */

app.get(
  "/api/my-campaigns",
  authMiddleware,

  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT
            c.campaign_id,
            c.title,

            cp.status,
            cp.current_question,
            cp.progress_percentage,
            cp.answers,

            c.created_at,

            co.company_name,

            (
              SELECT COUNT(*)

              FROM campaign_participants cp2

              WHERE
                cp2.campaign_id =
                c.campaign_id

            ) AS total_participants,

            (
              SELECT COUNT(*)

              FROM campaign_participants cp3

              WHERE
                cp3.campaign_id =
                c.campaign_id

                AND cp3.status IN
                (
                  'WAITING_FOR_REPORT',
                  'RESULTS_READY'
                )

            ) AS completed_participants

          FROM campaign_participants cp

          JOIN assessment_campaigns c
          ON cp.campaign_id =
             c.campaign_id

          JOIN companies co
          ON c.company_id =
             co.company_id

          WHERE cp.user_id = $1

          ORDER BY c.created_at DESC
          `,
          [req.user.user_id]
        );

      res.json(result.rows);

    } catch (err) {

      console.error(err);

      res.status(500).json({
        error: err.message,
      });

    }

  }
);

/* =========================
   SAVE PROGRESS
========================= */

app.post(
  "/api/save-progress",
  authMiddleware,

  async (req, res) => {

    try {

      const {
        campaign_id,
        current_question,
        progress_percentage,
        answers
      } = req.body;

      await pool.query(
  `
        UPDATE campaign_participants
        SET
          current_question = $1,
          progress_percentage = $2,
          answers = $3,
          status = 'IN_PROGRESS'

        WHERE
          campaign_id = $4
          AND user_id = $5
        `,
        [
          current_question,
          progress_percentage,
          JSON.stringify(answers),
          campaign_id,
          req.user.user_id
        ]
      );

      res.json({
        success: true
      });

    } catch (err) {

      console.error(err);

      res.status(500).json({
        error: err.message
      });

    }

  }
);

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

app.post(
  "/api/assessments",
  authMiddleware,

  async (req, res) => {

  try {

    const {
      campaign_id,
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
        campaign_id,
        user_id,
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
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      )
      RETURNING *
      `,
      [
        campaign_id,
        req.user.user_id,
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
    await pool.query(
  `
  UPDATE campaign_participants
  SET status = 'WAITING_FOR_REPORT'
  WHERE
    campaign_id = $1
    AND user_id = $2
  `,
  [
    campaign_id,
    req.user.user_id
  ]
);

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
   LOGIN
========================= */

app.get("/api/login", (req, res) => {

  res.json({
    message: "GET login route bestaat ✅"
  });

});

app.post("/api/login", async (req, res) => {

  try {

    console.log("LOGIN REQUEST RECEIVED");

    const {
      email,
      password
    } = req.body;

    console.log("Email:", email);

    const result = await pool.query(
      `
      SELECT *
      FROM users
      WHERE email = $1
      `,
      [email]
    );

    console.log("Users gevonden:", result.rows.length);

    if (result.rows.length === 0) {

      return res.status(401).json({
        error: "Gebruiker niet gevonden"
      });

    }

    const user = result.rows[0];

    console.log("User gevonden:", user.email);

    const validPassword =
      await bcrypt.compare(
        password,
        user.password_hash
      );

    console.log("Password valid:", validPassword);

    if (!validPassword) {

      return res.status(401).json({
        error: "Onjuist wachtwoord"
      });

    }

    const token = jwt.sign(
  {
    user_id: user.user_id,
    email: user.email,
    role: user.role
  },
  process.env.JWT_SECRET,
  {
    expiresIn: "12h"
  }
);

    console.log("JWT TOKEN GEMAAKT");

    res.json({

      success: true,

      token,

      user: {

        user_id: user.user_id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role,
        company_id: user.company_id

      }

    });

  } catch (err) {

    console.error("LOGIN ERROR:");
    console.error(err);

    res.status(500).json({
      error: err.message,
    });

  }

});

/* =========================
   GET COMPANIES
========================= */

app.get("/api/companies", async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT *
      FROM companies
      ORDER BY company_name ASC
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
   GET USERS
========================= */

app.get("/api/users", async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT
        user_id,
        company_id,
        first_name,
        last_name,
        email,
        role
      FROM users
      ORDER BY first_name ASC
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
   CREATE CAMPAIGN
========================= */

app.post("/api/campaigns", async (req, res) => {

  try {

    const {
      company_id,
      title,
      participant_ids
    } = req.body;


    const existing =
      await pool.query(
        `
        SELECT c.campaign_id

        FROM assessment_campaigns c

        JOIN campaign_participants cp
        ON c.campaign_id = cp.campaign_id

        WHERE
          c.company_id = $1
          AND cp.status IN
          (
            'NOT_STARTED',
            'IN_PROGRESS',
            'WAITING_FOR_REPORT'
          )

        LIMIT 1
        `,
        [company_id]
      );

    if (existing.rows.length > 0) {

      return res.status(400).json({
        error:
          "Er loopt al een actieve assessment campagne voor dit bedrijf."
      });

    } 
    
    const campaignResult =
      await pool.query(
        `
        INSERT INTO assessment_campaigns
        (
          company_id,
          title
        )
        VALUES
        (
          $1,
          $2
        )
        RETURNING *
        `,
        [
          company_id,
          title
        ]
      );

    const campaign =
      campaignResult.rows[0];

    for (const user_id of participant_ids) {

      await pool.query(
        `
        INSERT INTO campaign_participants
        (
          campaign_id,
          user_id
        )
        VALUES
        (
          $1,
          $2
        )
        `,
        [
          campaign.campaign_id,
          user_id
        ]
      );

    }

    res.status(201).json({
      success: true,
      campaign
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message,
    });

  }

});

/* =========================
   GET LATEST RESULT
========================= */

app.get(
  "/api/latest-result",
  authMiddleware,

  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT *
          FROM assessment_sessions
          WHERE company_name = (
            SELECT co.company_name
            FROM users u

            JOIN companies co
            ON u.company_id = co.company_id

            WHERE u.user_id = $1
          )
          ORDER BY assessment_date DESC
          LIMIT 1
          `,
          [req.user.user_id]
        );

      if (result.rows.length === 0) {

        return res.json(null);

      }

      res.json(result.rows[0]);

    } catch (err) {

      console.error(err);

      res.status(500).json({
        error: err.message
      });

    }

  }
);

/* =========================
   GET COMPANY RESULTS
========================= */

app.get(
  "/api/results",
  authMiddleware,

  async (req, res) => {

    try {

      const result = await pool.query(
        `
                SELECT
          s.assessment_session_id,
          s.campaign_id,
          s.maturity_level,
          s.assessment_date,
          s.status,

          c.title AS campaign_title,

          u.first_name,
          u.last_name

        FROM assessment_sessions s

        JOIN assessment_campaigns c
        ON s.campaign_id = c.campaign_id

        JOIN users u
        ON s.user_id = u.user_id

        WHERE c.company_id = (
          SELECT company_id
          FROM users
          WHERE user_id = $1
        )

        ORDER BY s.assessment_date DESC
        `,
        [req.user.user_id]
      );

      res.json(result.rows);

    } catch (err) {

      console.error(err);

      res.status(500).json({
        error: err.message
      });

    }

  }
);

/* =========================================
   LOAD RESULTS HISTORY
========================================= */

async function loadResultsHistory() {

  try {

    const response =
      await fetch(
        `${backend}/api/results`,
        {
          headers: {
            Authorization:
              `Bearer ${token}`
          }
        }
      );

    const data =
      await response.json();

    console.log(
      "Result history:",
      data
    );

    renderResultsHistory(data);

  } catch (err) {

    console.error(err);

  }

}

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