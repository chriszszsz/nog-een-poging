import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "./config/db.js";
import { authMiddleware }
from "./middleware/auth.js";
import OpenAI from "openai";
dotenv.config();
const openai = new OpenAI({
  baseURL: "https://maturity-tool-ai-resource.services.ai.azure.com/openai/v1",
  apiKey: process.env.AZURE_OPENAI_KEY
});

const MODEL = "gpt-4o";



const app = express();

/* =========================
   MIDDLEWARE
========================= */

app.use(cors());

app.use(express.json());

app.use(helmet());



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
      SELECT
        s.assessment_session_id AS id,

        s.company_name,
        s.maturity_level,
        s.average_score,
        s.assessment_date,
        s.status,
        s.report_suggestion,
        s.spider_scores,
        s.details,
        s.last_updated,

        c.title AS campaign_title,

        u.first_name,
        u.last_name

      FROM assessment_sessions s

      LEFT JOIN assessment_campaigns c
        ON s.campaign_id = c.campaign_id

      LEFT JOIN users u
        ON s.user_id = u.user_id

      ORDER BY s.assessment_session_id DESC
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

const check = await pool.query(`
  SELECT
    COUNT(*) FILTER (WHERE status IN ('WAITING_FOR_REPORT','RESULTS_READY')) AS done,
    COUNT(*) AS total
  FROM campaign_participants
  WHERE campaign_id = $1
`, [campaign_id]);

const { done, total } = check.rows[0];

if (Number(done) === Number(total)) {

  console.log("✅ Alle deelnemers klaar → start AI");

  await generateCampaignReport(campaign_id);

}

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
   CREATE COMPANY
========================= */

app.post("/api/companies", async (req, res) => {

  try {

    const {
      company_name,
      address,
      city,
      postcode
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO companies
      (company_name, address, city, postcode)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [company_name, address, city, postcode]
    );

    res.status(201).json(result.rows[0]);

  } catch (err) {

    console.error("CREATE COMPANY ERROR:");
    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }

});

/* =========================
   GET USERS
========================= */

app.post("/api/users", async (req, res) => {

  try {

    const {
      first_name,
      last_name,
      email,
      role_description,
      company_id
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO users
      (first_name, last_name, email, role, role_description, company_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [
        first_name,
        last_name,
        email,
        "participant",   // ✅ hardcoded
        role_description,
        company_id
      ]
    );

    res.json(result.rows[0]);

  } catch (err) {

    console.error("USER CREATE ERROR:", err); // 🔥 belangrijk

    res.status(500).json({
      error: err.message
    });

  }

});

app.get("/api/users", async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT
        user_id,
        company_id,
        first_name,
        last_name,
        email,
        role,
        role_description
      FROM users
      ORDER BY first_name ASC
    `);

    res.json(result.rows);

  } catch (err) {

    console.error("GET USERS ERROR:", err);

    res.status(500).json({
      error: err.message
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
   GET CAMPAIGNS
========================= */

app.get("/api/campaigns", async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT
        c.campaign_id,
        c.title,
        c.created_at,

        co.company_name,

        COUNT(cp.user_id) AS participant_count,

        MAX(cp.status) AS status

      FROM assessment_campaigns c

      JOIN companies co
        ON c.company_id = co.company_id

      LEFT JOIN campaign_participants cp
        ON c.campaign_id = cp.campaign_id

      GROUP BY
        c.campaign_id,
        co.company_name

      ORDER BY c.created_at DESC
    `);

    res.json(result.rows);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }

});

app.get("/api/campaigns/:id/details", async (req, res) => {
  try {
    const campaign_id = req.params.id;

    /* =========================
       1. CAMPAIGN INFO
    ========================= */

    const campaignResult = await pool.query(`
      SELECT
        c.campaign_id,
        c.title,
        c.created_at,
        c.report,
        co.company_name
      FROM assessment_campaigns c
      JOIN companies co ON c.company_id = co.company_id
      WHERE c.campaign_id = $1
    `, [campaign_id]);

    if (campaignResult.rows.length === 0) {
      return res.status(404).json({ error: "Campaign niet gevonden" });
    }

    const campaign = campaignResult.rows[0];


  /* =========================
   SAVE CAMPAIGN REPORT
========================= */

app.put("/api/campaigns/:id/report", async (req, res) => {
  try {
    const campaign_id = req.params.id;
    const { report } = req.body;

    await pool.query(
      `
      UPDATE assessment_campaigns
      SET report = $1
      WHERE campaign_id = $2
      `,
      [report, campaign_id]
    );

    res.json({ success: true });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }
});

    /* =========================
       2. ASSESSMENTS (tabel)
    ========================= */

    const assessmentsResult = await pool.query(`
      SELECT
        s.assessment_session_id,
        s.average_score,
        s.assessment_date,
        s.status,
        u.first_name,
        u.last_name
      FROM assessment_sessions s
      JOIN users u ON s.user_id = u.user_id
      WHERE s.campaign_id = $1
      ORDER BY s.assessment_date DESC
    `, [campaign_id]);

    const assessments = assessmentsResult.rows;

    /* =========================
       3. AGGREGATED SCORE
    ========================= */

    let average_score = null;

    if (assessments.length > 0) {
      const total = assessments.reduce((sum, a) => sum + Number(a.average_score || 0), 0);
      average_score = (total / assessments.length).toFixed(1);
    }

    /* =========================
       4. AGGREGATED SPIDERCHART
    ========================= */

    const spiderResult = await pool.query(`
      SELECT spider_scores
      FROM assessment_sessions
      WHERE campaign_id = $1
    `, [campaign_id]);

    let aggregatedSpider = {};

    spiderResult.rows.forEach(row => {

      const scores = typeof row.spider_scores === "string"
  ? JSON.parse(row.spider_scores)
  : row.spider_scores;

      if (!scores) return;

      Object.entries(scores).forEach(([key, value]) => {

        if (!aggregatedSpider[key]) {
          aggregatedSpider[key] = {
            total: 0,
            count: 0
          };
        }

        aggregatedSpider[key].total += Number(value);
        aggregatedSpider[key].count += 1;

      });

    });

    const spider_scores = {};

    Object.entries(aggregatedSpider).forEach(([key, val]) => {
      spider_scores[key] = Number((val.total / val.count).toFixed(2));
    });

    /* =========================
       RESPONSE
    ========================= */

    res.json({
      campaign,
      assessments,
      aggregated: {
        average_score,
        spider_scores
      }
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
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
          s.average_score,
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

/* =========================
   GET SINGLE RESULT DETAIL
========================= */

app.get(
  "/api/results/:id",
  authMiddleware,
  async (req, res) => {

    try {

      const sessionResult =
        await pool.query(
          `
          SELECT *
          FROM assessment_sessions
          WHERE assessment_session_id = $1
          `,
          [req.params.id]
        );

      if (sessionResult.rows.length === 0) {
        return res.status(404).json({
          error: "Niet gevonden"
        });
      }

      const answersResult =
        await pool.query(
          `
          SELECT
            q.question_id,
            q.question_text,
            q.question_type,

            a.score,
            a.comment,

            -- ✅ mapping score → juiste tekst uit DB
            CASE a.score
              WHEN 1 THEN q.option_a
              WHEN 2 THEN q.option_b
              WHEN 3 THEN q.option_c
              WHEN 4 THEN q.option_d
              WHEN 5 THEN q.option_e
            END AS answer_text

          FROM assessment_answers a

          JOIN questions q
          ON a.question_id = q.question_id

          WHERE a.assessment_session_id = $1

          ORDER BY q.question_id ASC
          `,
          [req.params.id]
        );

      res.json({
        session: sessionResult.rows[0],
        answers: answersResult.rows
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
   AI tester
========================= */

app.post("/api/test-ai", async (req, res) => {

  try {

    const campaign_id = req.body.campaign_id || 2;

    console.log("🧪 TEST AI RUN");

    // Hergebruik exact dezelfde data query
    const result = await pool.query(`
      SELECT
        s.assessment_session_id,
        u.role_description,
        q.question_text,
        a.score,
        a.comment
      FROM assessment_answers a
      JOIN assessment_sessions s
        ON a.assessment_session_id = s.assessment_session_id
      JOIN users u
        ON s.user_id = u.user_id
      JOIN questions q
        ON a.question_id = q.question_id
      WHERE s.campaign_id = $1
      ORDER BY s.assessment_session_id, q.question_id
    `, [campaign_id]);

    const rows = result.rows;

    const participantsMap = {};

    rows.forEach(r => {
      if (!participantsMap[r.assessment_session_id]) {
        participantsMap[r.assessment_session_id] = {
          role: r.role_description,
          answers: []
        };
      }

      participantsMap[r.assessment_session_id].answers.push({
        question: r.question_text,
        score: r.score,
        comment: r.comment
      });
    });

    const participants = Object.values(participantsMap);

    const aiInput = {
      participant_count: participants.length,
      participants
    };

    // 🔥 AI CALL
    const response = await openai.chat.completions.create({
  model: MODEL,
  messages: [
    {
      role: "system",
      content: `
Je bent een senior consultant gespecialiseerd in digitale maturiteit, governance, informatiebeveiliging, IT-organisatie en organisatieanalyse.

Je analyseert assessmentdata afkomstig van meerdere rollen binnen een organisatie en stelt op basis daarvan een professioneel adviesrapport op voor directie en management.

DOEL

Het doel is niet om scores samen te vatten.

Het doel is om de organisatie achter de scores te begrijpen, de onderliggende dynamiek bloot te leggen en directie inzicht te geven in de belangrijkste risico's, oorzaken en verbeterprioriteiten.

Je schrijft alsof je een adviesrapport oplevert aan directie, bestuur, aandeelhouders of een auditcommissie.

---

BELANGRIJKE REGELS

* Gebruik geen namen van deelnemers.
* Gebruik uitsluitend de aangeleverde data.
* Doe geen aannames die niet door de data worden ondersteund.
* Gebruik geen privacygevoelige informatie.
* Analyseer verschillen tussen rollen expliciet.
* Benoem inconsistenties expliciet.
* Verklaar verschillen (WHY), niet alleen beschrijven (WHAT).
* Zoek actief naar onderliggende oorzaken.
* Leg verbanden tussen onderwerpen en domeinen.
* Trek conclusies over organisatiegedrag, governance en besluitvorming.
* Maak zichtbaar waar formele inrichting afwijkt van dagelijkse praktijk.
* Maak zichtbaar waar percepties tussen rollen uiteenlopen.
* Gebruik de assessmentresultaten als bewijs voor je conclusies.

---

VERMIJD VAGE TAAL

Gebruik geen formuleringen zoals:
- "gemengd beeld"
- "verschillen zichtbaar"
- "ruimte voor verbetering"
- "aandachtspunt"

Wees expliciet, concreet en scherp.

---

SCOREVERWERKING

* De assessment gebruikt antwoordopties a t/m e.
* Converteer deze altijd naar een schaal van 1 t/m 5:

a = 1  
b = 2  
c = 3  
d = 4  
e = 5  

* Gebruik uitsluitend de schaal 1-5.
* Indien andere waarden voorkomen, negeer deze.
* Rapporteer nooit scores buiten de schaal 1-5.

---

ANALYSEPRINCIPES

Voor iedere belangrijke observatie moet je:

1. Beschrijven wat zichtbaar is in de data.
2. Verklaren waarom dit waarschijnlijk gebeurt.
3. Beschrijven welke organisatorische dynamiek hierachter zit.
4. Benoemen welke risico's hierdoor ontstaan.
5. Beschrijven welke managementactie logisch volgt.

Beschrijf nooit alleen een scoreverschil.

Ga altijd een niveau dieper.

---

DIAGNOSTISCHE VERDIEPING

Formuleer waar mogelijk onderbouwde hypothesen over de organisatie.

Gebruik formuleringen zoals:
- "Dit suggereert dat..."
- "Dit patroon wijst vaak op..."
- "Dit komt typisch voor in organisaties waar..."

Leg verbanden met bekende organisatorische patronen zoals:
- gebrek aan ownership
- silo-vorming
- informele besluitvorming
- onvoldoende governance-verankering

---

MATURITEITSINTERPRETATIE

Positioneer impliciet de ontwikkelfase van de organisatie, bijvoorbeeld:

- ad hoc / persoonsafhankelijk
- formeel ingericht maar niet geborgd
- gedeeltelijk geïntegreerd
- organisatiebreed verankerd

Maak duidelijk waar de organisatie zich bevindt zonder expliciet een maturity score te noemen.

---

KWALITATIEVE ANTWOORDEN

Analyseer ook open antwoorden.

Wanneer antwoorden:

* leeg zijn  
* nietszeggend zijn  
* placeholdertekst bevatten  
* irrelevante inhoud bevatten  

interpreteer dit als een mogelijk signaal van:

* beperkte betrokkenheid  
* beperkte kennis  
* gebrek aan eigenaarschap  
* lage volwassenheid  
* onvoldoende communicatie  
* onvoldoende bewustzijn  

Gebruik dit actief als diagnostisch signaal.

---

RISICO-CONCRETISERING

Maak risico’s concreet en tastbaar.

Beschrijf impact in termen van:

* vertraging in besluitvorming  
* operationele fouten  
* inconsistent naleven van processen  
* auditbevindingen  
* security-incidenten  
* afhankelijkheid van individuen  

Vermijd abstracte termen zoals "verhoogd risico" zonder concrete impact.

---

VERBANDEN TUSSEN DOMEINEN

Analyseer niet per onderwerp in isolatie.

Zoek expliciet naar verbanden tussen:

* Strategie ↔ Governance  
* Governance ↔ Risicomanagement  
* Governance ↔ Operatie  
* Governance ↔ IT  
* Rollen & Verantwoordelijkheden ↔ Uitvoering  
* Leveranciersmanagement ↔ Risicobeheersing  
* Architectuur ↔ Strategie  
* Continuïteit ↔ Kennisborging  
* Beleid ↔ Naleving  
* Servicelevel Management ↔ Leverancierssturing  

---

SCHRIJFSTIJL

Schrijf:

* professioneel  
* analytisch  
* adviserend  
* directiegericht  
* volledig uitgewerkt  

Schrijf als managementconsultant.

Leg altijd uit:

* waarom  
* waardoor  
* met welke gevolgen  

---

RAPPORTSTRUCTUUR

BOVENAAN HET RAPPORT MOET ALTIJD EXACT DEZE REGEL STAAN:

### 🚨 TEST MARKER: AXIANS_AI_REPORT_ACTIVE 🚨

---

# 1. Executive Summary

...

# 2. Organisatiediagnose

...

# 3. Analyse van Alignment

...

# 4. Verschillen tussen Perspectieven

...

# 5. Kritische Risico's

...

# 6. Aanbevelingen en Prioriteiten

...

# 7. Conclusie voor Directie

...

---

BELANGRIJKSTE INSTRUCTIE

De waarde van het rapport zit niet in het beschrijven van scores.

De waarde van het rapport zit in het verklaren van de organisatie achter de scores.

Schrijf daarom een geïntegreerd adviesrapport dat leest als het werk van een ervaren managementconsultant en niet als een samenvatting van een assessment.


`
    },
    {
      role: "user",
      content: JSON.stringify(aiInput)
    }
  ],
  temperature: 0.2,
});

    const report = response.choices[0].message.content;

    // ✅ GEEN DB UPDATE → alleen teruggeven
    res.json({
      participants: participants.length,
      report
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }

});

/* =========================
   AI RAPPORT GENEREREN
========================= */
async function generateCampaignReport(campaign_id) {

  try {

    // 1. Haal ALLE antwoorden + rol
    const result = await pool.query(`
      SELECT
        s.assessment_session_id,
        u.role_description,

        q.question_text,

        a.score,
        a.comment

      FROM assessment_answers a

      JOIN assessment_sessions s
        ON a.assessment_session_id = s.assessment_session_id

      JOIN users u
        ON s.user_id = u.user_id

      JOIN questions q
        ON a.question_id = q.question_id

      WHERE s.campaign_id = $1

      ORDER BY s.assessment_session_id, q.question_id
    `, [campaign_id]);

    const rows = result.rows;

    // 2. Groeperen per assessment (deelnemer)
    const participantsMap = {};

    rows.forEach(r => {

      if (!participantsMap[r.assessment_session_id]) {
        participantsMap[r.assessment_session_id] = {
          role: r.role_description,
          answers: []
        };
      }

      participantsMap[r.assessment_session_id].answers.push({
        question: r.question_text,
        score: r.score,
        comment: r.comment
      });

    });

    const participants = Object.values(participantsMap);

    // 3. Bouw input voor AI (🔥 BELANGRIJK)
    const aiInput = {
      participants
    };

    // 4. AI CALL
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
  role: "system",
  content: `
Je bent een senior consultant gespecialiseerd in digitale maturiteit en organisatieanalyse.

Je taak is om een diepgaande analyse te maken op basis van assessment data van meerdere rollen binnen een organisatie.

BELANGRIJK:
- Gebruik GEEN namen (privacy)
- Gebruik de data zoals gegeven (scores a t/m e. Zet det deze om naar 1 - 5 schaal)
- Analyseer verschillen tussen rollen en perspectieven
- Zoek naar onderliggende oorzaken van verschillen
- Leg verbanden tussen onderwerpen (bijv. governance ↔ operatie)
- Benoem inconsistencies expliciet
- Ga verder dan beschrijven — verklaar waarom iets gebeurt

SCHRIJFSTIJL:
- professioneel en analytisch
- volledig uitgewerkt (geen bullet-only output)
- duidelijke argumentatie
- advisory tone (consultant)

STRUCTUUR:

1. Samenvatting
→ bondige maar inhoudelijke overview van de belangrijkste bevindingen

2. Integrale analyse
→ leg verbanden tussen domeinen (strategie, governance, operatie, IT)
→ beschrijf patronen en onderliggende dynamiek

3. Verschillen tussen rollen
→ waar zien rollen de wereld anders
→ wat zegt dat over de organisatie

4. Kritische risico’s
→ niet alleen wat, maar waarom dit riskant is
→ impact op organisatie (concreet)

5. Aanbevelingen
→ strategisch + operationeel
→ logische vervolgstappen (geen generieke adviezen)

Belangrijk:
- vermijd algemene zinnen
- schrijf alsof je een adviesrapport oplevert aan directie

EXTRA ANALYSE INSTRUCTIES:

- Als scores buiten het bereik 1-5 verschijnen, negeer deze en gebruik alleen 1-5 schaal.
- Verklaar verschillen tussen rollen (WHY), niet alleen beschrijven (WHAT).
- Interpreteer ontbrekende of slechte antwoorden (zoals lege velden of irrelevante tekst) als signalen over organisatiegedrag (bijv. betrokkenheid, kennisniveau of cultuur).
- Trek conclusies over alignment tussen strategie en operatie.
- Benoem implicaties voor governance, besluitvorming en risico’s.


Gebruik de data zoals gegeven — maak geen aannames buiten de data.
`
        },
        {
          role: "user",
          content: JSON.stringify(aiInput)
        }
      ],
      temperature: 0.2,
    });

    const report = response.choices[0].message.content;


    // 5. Opslaan
    await pool.query(`
      UPDATE assessment_campaigns
      SET report = $1
      WHERE campaign_id = $2
    `, [report, campaign_id]);

    // 6. Status update
    await pool.query(`
      UPDATE campaign_participants
      SET status = 'RESULTS_READY'
      WHERE campaign_id = $1
    `, [campaign_id]);

    console.log("✅ AI rapport succesvol gegenereerd");

  } catch (err) {

    console.error("❌ AI GENERATION ERROR:", err);

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

