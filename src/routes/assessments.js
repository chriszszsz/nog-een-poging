const express = require('express');

const router = express.Router();

// tijdelijke in-memory opslag
// later vervangen door database
let assessments = [];


/**
 * GET alle assessments
 */
router.get('/', (req, res) => {

  res.json(assessments);

});


/**
 * GET assessment op ID
 */
router.get('/:id', (req, res) => {

  const assessment = assessments.find(
    a => a.id === req.params.id
  );

  if (!assessment) {

    return res.status(404).json({
      error: 'Assessment niet gevonden'
    });

  }

  res.json(assessment);

});


/**
 * POST nieuwe assessment
 */
router.post('/', async (req, res) => {

  try {

    const assessment = {

      id: `asm-${Date.now()}`,

      ...req.body

    };

    assessments.push(assessment);

    console.log('Assessment opgeslagen:', assessment);

    res.status(201).json({
      success: true,
      assessment
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: 'Opslaan mislukt'
    });

  }

});

module.exports = router;