// Prompt for grading the closing report and writing the debrief.

export function buildGradingPrompt({ truth, report, stats }) {
  return `You are the Game Master of an FBI investigation simulation. The case is now CLOSED. The player has filed a closing report. Grade it against the hidden case truth and write the full debrief. You may now reveal everything.

CASE TRUTH (JSON):
${JSON.stringify(truth)}

PLAYER'S CLOSING REPORT:
- Accused: ${report.culpritName} (suspect id ${report.culpritId})
- Motive stated: ${report.motive}
- Means stated: ${report.means}
- Opportunity stated: ${report.opportunity}
- Key evidence cited (ids and names): ${report.evidence.map(e => `${e.id}: ${e.name}`).join('; ') || 'none'}
- Charges: ${report.charges}
- Narrative of the case as the player understands it: ${report.narrative || '(none given)'}

INVESTIGATION STATISTICS (computed by the game code; treat as fact):
- Correct culprit: ${stats.correctCulprit ? 'YES' : 'NO'}
- Evidence the player actually collected (ids): ${stats.collectedEvidence.join(', ') || 'none'}
- Evidence the player cited that they never actually collected: ${stats.uncollectedCited.join(', ') || 'none'}
- Evidence excluded for bad procedure: ${stats.excludedEvidence.join(', ') || 'none'}
- Proving clues found: ${stats.provingFound.join(', ') || 'none'} of ${stats.provingTotal}
- Lab results obtained: ${stats.labResults.join(', ') || 'none'}
- Suspects interviewed: ${stats.interviewed.join(', ') || 'none'}
- Alibis checked: ${JSON.stringify(stats.alibiStatus)}
- Procedure errors: ${stats.procedureErrors.length ? stats.procedureErrors.join(' | ') : 'none'}
- Hints taken: ${stats.hints}
- In-game time used: ${stats.hoursUsed} of ${stats.deadlineHours} hours (${stats.overDeadline ? 'OVER deadline' : 'within deadline'})
- Facts established in notebook: ${stats.factCount}

GRADING INSTRUCTIONS
- Judge "motiveCorrect" on substance, not wording.
- Judge each of means / opportunity / motive as "backed" only if the evidence the player ACTUALLY COLLECTED (and that was not excluded) supports it. Evidence cited but never collected does not count.
- Charges are "appropriate" if they broadly match the truth's charges for the actual conduct.
- Score 0-100. Rough weights: correct culprit 40, motive 10, each element backed 8 (24 total), appropriate charges 6, proving clues found 10, procedure 5, efficiency and hints 5. A wrong culprit caps the score at 35 regardless of the rest.
- Rating: 90+ "Commendation", 75-89 "Case Closed", 55-74 "Closed with Reservations", 35-54 "Returned by the AUSA", below 35 "Wrongful Arrest" (if wrong culprit) or "Case Collapsed".
- If the player named the wrong person: the debrief must show that the real culprit walked, what happens to the wrongly accused, and what the player missed.
- If the player named the right person but with weak evidence: the debrief shows the AUSA's concerns and what might not survive a motion to suppress.

DEBRIEF CONTENT (write it as the supervisor's post-case debrief, then a factual "What Actually Happened" section):
1. The supervisor's verdict in their own voice (3-6 sentences).
2. WHAT ACTUALLY HAPPENED: the full true story from the timeline, including the culprit, motive, means, opportunity, and the cover-up. 150-300 words.
3. WHAT YOU GOT RIGHT.
4. WHAT YOU MISSED: proving clues not found, alibis never checked, lab work never requested, records never pulled, questions never asked. Be specific.
5. RED HERRINGS: each one, who it pointed at, and the innocent explanation.
6. PROCEDURE: any errors and their consequence, or a note that procedure was clean.

Reply with ONE JSON object and nothing else:
{
  "score": 0,
  "rating": "",
  "culpritCorrect": true,
  "motiveCorrect": true,
  "elements": { "motive": { "backed": true, "note": "" }, "means": { "backed": true, "note": "" }, "opportunity": { "backed": true, "note": "" } },
  "chargesAppropriate": true,
  "verdict": "the supervisor's spoken verdict",
  "whatHappened": "",
  "gotRight": ["..."],
  "missed": ["..."],
  "redHerrings": ["..."],
  "procedure": "",
  "outcome": "one paragraph: what happens next for the accused, the real culprit, and the agent"
}`;
}
