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
        JSON.stringify(spider_scores),
        details,
        last_updated
      ]
    );

    const assessment = result.rows[0];

    // antwoorden opslaan
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
            assessment.id,
            i + 1,
            typeof answer === "number" ? answer : null,
            typeof answer === "string" ? answer : null
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