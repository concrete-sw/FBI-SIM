// Prompt that produces the hidden case truth. The result is validated by
// engine/schema.js and regenerated if invalid.

export const CASE_SCHEMA_TEXT = `{
  "caseNumber": "string, format like 'NY-2026-HC-04471'",
  "title": "short operation-style case title",
  "crimeType": "the crime type requested",
  "setting": { "city": "invented or real-sounding US city", "state": "US state", "dateOfCrime": "YYYY-MM-DD", "fieldOffice": "FBI field office name" },
  "victim": { "name": "", "age": 0, "occupation": "", "description": "two sentences", "background": "a paragraph; include what made them a target" },
  "crime": {
    "summary": "two-sentence public summary of what was found or reported",
    "whatReallyHappened": "a detailed paragraph of the hidden truth, step by step, including how the culprit did it and how they covered it up",
    "when": "date and time", "where": "locationId of the primary scene"
  },
  "timeline": [ { "time": "YYYY-MM-DD HH:MM", "event": "what happened", "involves": ["suspectId or witnessId"], "knownInitially": false } ],
  "suspects": [
    {
      "id": "s1", "name": "", "age": 0, "occupation": "", "background": "a paragraph of what a records check and a few phone calls would establish: job, family, reputation, known troubles. This is shown to the player; put anything hidden in secret or alibi.whatActuallyHappened",
      "personality": "a sentence", "speechStyle": "how they talk: vocabulary, rhythm, tics, education, region",
      "relationshipToVictim": "", "secret": "an unrelated personal secret they will hide (affair, debt, minor crime, shame)",
      "alibi": { "claim": "what they say they were doing", "isTrue": true, "whatActuallyHappened": "the truth of their whereabouts" },
      "isCulprit": false, "initialMood": "calm|cooperative|nervous|defensive|grieving",
      "motiveIfAny": "a motive that exists whether or not they are guilty, or null",
      "criminalHistory": "clean, or a short record", "vehicle": "make, model, colour, plate, or null",
      "phoneRecordsSummary": "what a subpoena of their phone records would show (calls, texts, cell-site location) that matters to the case",
      "financialsSummary": "what a subpoena of their bank records would show that matters to the case"
    }
  ],
  "culprit": { "suspectId": "s3", "motive": "", "means": "", "opportunity": "", "howItWasDone": "a paragraph" },
  "evidence": [
    {
      "id": "e1", "name": "", "type": "physical|document|digital|biological|weapon|vehicle|financial|photo",
      "locationId": "where it is", "exactSpot": "the specific place a search must look (e.g. 'inside the lining of the duffel bag in the hall closet')",
      "initiallyKnown": false, "requiresWarrant": false,
      "description": "what it looks like at a glance",
      "closeLookReveals": ["concrete detail 1", "concrete detail 2"],
      "lab": { "fingerprints": "result or null", "dna": "result or null", "ballistics": "result or null", "toxicology": "result or null", "digital": "result or null", "trace": "result or null", "documents": "result or null" },
      "pointsTo": "suspectId, or null", "isRedHerring": false, "significance": "what this really means in the truth"
    }
  ],
  "locations": [
    {
      "id": "loc1", "name": "", "address": "invented street address", "type": "crime scene|residence|workplace|public|vehicle|other",
      "initiallyKnown": true, "isPrivate": false, "ownerSuspectId": null,
      "description": "a paragraph of atmosphere", "sharpEyeDetails": ["detail a careful agent notices", "another"],
      "searchableAreas": ["area 1", "area 2", "area 3"],
      "canvassYields": "what neighbours or bystanders here would say if canvassed"
    }
  ],
  "witnesses": [
    {
      "id": "w1", "name": "", "role": "relationship to the case", "speechStyle": "", "initiallyKnown": true,
      "whatTheySaw": "the truth of what they observed", "reliability": "high|medium|low", "bias": "a sentence",
      "initialStatement": "the statement already on file, as they gave it, including any honest errors"
    }
  ],
  "redHerrings": [ { "description": "", "pointsAt": "suspectId", "viaEvidenceId": "evidenceId or null", "whyMisleading": "the innocent explanation" } ],
  "provingClues": [ { "evidenceId": "e4", "whatItProves": "how this clue, with the others, establishes guilt" } ],
  "charges": ["the federal charges a correct closing report should list"],
  "initialReport": "the initial incident report as the agent first reads it: who, what, where, when, as known at the start. 150-250 words. Must not reveal hidden facts.",
  "supervisorBriefing": "the supervisor's spoken briefing to the agent, in their voice, 120-200 words, ending with marching orders",
  "deadlineHours": 72
}`;

export function buildCaseGenerationPrompt({ crimeType, difficulty, length, agentName }) {
  const lengthGuide = {
    short: 'SHORT case: 4 suspects, 6-8 evidence items, 3-4 locations, 2-3 witnesses. Deadline 48 in-game hours.',
    standard: 'STANDARD case: 5 suspects, 8-11 evidence items, 4-5 locations, 3-4 witnesses. Deadline 72 in-game hours.',
    long: 'LONG case: 6 suspects, 11-14 evidence items, 5-6 locations, 4-5 witnesses. Deadline 120 in-game hours.'
  }[length] || 'STANDARD case: 5 suspects, 8-11 evidence items, 4-5 locations, 3-4 witnesses. Deadline 72 in-game hours.';

  const difficultyGuide = {
    rookie: 'ROOKIE difficulty: the culprit\'s alibi has an obvious hole; two of the proving clues are easy to find at known locations; only one red herring is strong. Witness reliability mostly high.',
    agent: 'AGENT difficulty: the culprit\'s alibi is plausible and breaks only on specifics; proving clues are spread across locations, lab work and records; two solid red herrings. Mixed witness reliability.',
    veteran: 'VETERAN difficulty: the culprit is composed and prepared; at least one proving clue requires a subpoena or a warrant to reach; one proving clue only appears through the lab; three convincing red herrings, one of which points at a suspect with a real but unrelated secret. Several witnesses are honestly wrong about something.'
  }[difficulty] || 'AGENT difficulty.';

  return `You are designing the hidden ground truth for a realistic FBI investigation game. The player is Special Agent ${agentName}. Produce ONE complete, internally consistent case as JSON matching the schema below exactly. This JSON is never shown to the player; it is the secret the Game Master plays from. Be specific and concrete everywhere: real-feeling names, addresses, times, objects. Vague entries make the game unplayable.

CRIME TYPE: ${crimeType}
${lengthGuide}
${difficultyGuide}

DESIGN REQUIREMENTS
1. Exactly one suspect has "isCulprit": true. "culprit.suspectId" must match. The culprit must have motive, means and opportunity that make sense together, and a cover-up that a competent investigator can unpick.
2. Every innocent suspect must have a reason to look suspicious: an unrelated secret, a false or shaky alibi for innocent reasons, a grudge, a financial motive, or presence near the scene. Give each one a distinct personality and speech style so the Game Master can voice them differently.
3. "provingClues" must list at least 3 independent pieces of evidence (different evidence ids, found in different ways: e.g. one physical at a scene, one from the lab, one from records or a witness) that TOGETHER prove the culprit's guilt beyond reasonable doubt. None of them may be "initiallyKnown". The case must be solvable without a confession.
4. Include 2 or 3 "redHerrings", each pointing at an innocent suspect, each with an innocent explanation discoverable in play.
5. Every evidence item must have a real "locationId" from "locations" and an "exactSpot". Items at the primary scene can be "initiallyKnown": true (already collected by ERT). The others are found only by searching the right spot, and some should require a warrant because they are inside private property of a suspect.
6. Lab results: fill in only the disciplines that would actually yield something; set the rest to null. At least two items should have meaningful lab findings. Results are written as an examiner would report them ("Partial latent print on the trigger guard, 9 points of comparison with the right thumb of S3 (exemplar on file from 2019 arrest).").
7. Phone and financial record summaries must be consistent with the timeline. The culprit's records should contain a subtle inconsistency with their alibi (a cell-site hit in the wrong place, a cash withdrawal, a call to a number they deny knowing).
8. The timeline must be complete and consistent with every alibi, every evidence item, and every witness account. Entries marked "knownInitially": true are what the initial report establishes.
9. Witnesses' "initialStatement" may contain honest errors consistent with their "reliability" and "bias". "whatTheySaw" is the truth.
10. "initialReport" and "supervisorBriefing" must not leak hidden facts. The briefing should be in the supervisor's voice: dry, direct, a little tired, and end with clear first steps.
11. Everything is fictional. Invent names, companies, addresses and agencies (other than the FBI itself). No real people. Keep violence described with the restraint of a case report.
12. Where a value is absent, use JSON null (never the string "null", "none" or "N/A").
13. Use the id conventions s1..s6 for suspects, w1..w5 for witnesses, e1..e14 for evidence, loc1..loc6 for locations.

SCHEMA (follow exactly; no extra top-level keys):
${CASE_SCHEMA_TEXT}

Reply with the JSON object only. No markdown fences, no commentary.`;
}
