// Closing report: deterministic statistics + AI-written debrief.

import { buildGradingPrompt } from '../prompts/grading.js';
import { extractJSON } from './json.js';
import { complete } from '../providers/index.js';
import { getEvidence, getSuspect } from './state.js';

export function computeStats(state, report) {
  const t = state.truth;
  const collected = state.discovered.evidence.filter(id => !state.evidence[id].excluded);
  const excluded = state.discovered.evidence.filter(id => state.evidence[id].excluded);
  const provingIds = [...new Set(t.provingClues.map(p => p.evidenceId))];
  const labResults = [];
  for (const [id, es] of Object.entries(state.evidence)) for (const r of es.labRequests) if (r.delivered) labResults.push(`${getEvidence(state, id).name} / ${r.discipline}`);
  const alibiStatus = {};
  for (const s of t.suspects) alibiStatus[s.name] = state.suspects[s.id].alibiStatus;
  const hoursUsed = Math.round(state.clock.elapsedMinutes / 6) / 10;
  return {
    correctCulprit: report.culpritId === t.culprit.suspectId,
    collectedEvidence: collected,
    uncollectedCited: report.evidence.map(e => e.id).filter(id => !collected.includes(id)),
    excludedEvidence: excluded,
    provingFound: provingIds.filter(id => collected.includes(id)),
    provingTotal: provingIds.length,
    labResults,
    interviewed: t.suspects.filter(s => state.suspects[s.id].transcript.length).map(s => s.name),
    alibiStatus,
    procedureErrors: state.procedureErrors.map(p => p.text),
    hints: state.hints,
    hoursUsed,
    deadlineHours: t.deadlineHours,
    overDeadline: state.clock.elapsedMinutes > state.clock.deadlineMinutes,
    factCount: state.facts.length
  };
}

export async function gradeCase({ state, report, provider, apiKey, model, baseUrl, onStatus, signal }) {
  const stats = computeStats(state, report);
  const prompt = buildGradingPrompt({ truth: state.truth, report, stats });
  let grade = null;
  for (let attempt = 1; attempt <= 2 && !grade; attempt++) {
    onStatus?.(attempt === 1 ? 'Supervisor is reviewing the closing report...' : 'Re-requesting debrief...');
    try {
      const raw = await complete(provider, { apiKey, model, baseUrl, json: true, system: 'You grade investigations fairly and write vivid, factual debriefs. Output only JSON.', messages: [{ role: 'user', content: prompt }], maxTokens: 4000, temperature: 0.6, signal });
      grade = extractJSON(raw);
    } catch (err) {
      if (signal?.aborted) throw err;
      if (attempt === 2) grade = fallbackGrade(state, report, stats);
    }
  }
  // Code has the last word on the parts it can verify.
  grade.culpritCorrect = stats.correctCulprit;
  grade.score = Math.max(0, Math.min(100, Math.round(Number(grade.score) || 0)));
  if (!stats.correctCulprit) grade.score = Math.min(grade.score, 35);
  grade.rating = grade.rating || ratingFor(grade.score, stats.correctCulprit);
  grade.stats = stats;
  return grade;
}

export function ratingFor(score, correct) {
  if (score >= 90) return 'Commendation';
  if (score >= 75) return 'Case Closed';
  if (score >= 55) return 'Closed with Reservations';
  if (score >= 35) return 'Returned by the AUSA';
  return correct ? 'Case Collapsed' : 'Wrongful Arrest';
}

function fallbackGrade(state, report, stats) {
  const t = state.truth;
  const culprit = getSuspect(state, t.culprit.suspectId);
  let score = stats.correctCulprit ? 40 : 0;
  score += Math.round(10 * stats.provingFound.length / Math.max(1, stats.provingTotal));
  score += stats.procedureErrors.length ? 0 : 5;
  score += Math.max(0, 5 - stats.hints);
  return {
    score, rating: ratingFor(score, stats.correctCulprit), culpritCorrect: stats.correctCulprit, motiveCorrect: null,
    elements: {}, chargesAppropriate: null,
    verdict: stats.correctCulprit ? 'You got the right person. The AUSA will decide how much of it holds up.' : 'You arrested the wrong person. The case is being reassigned.',
    whatHappened: `${t.crime.whatReallyHappened}\n\nCulprit: ${culprit?.name}. Motive: ${t.culprit.motive}. Means: ${t.culprit.means}. Opportunity: ${t.culprit.opportunity}.\n\n${t.culprit.howItWasDone}`,
    gotRight: [], missed: t.provingClues.filter(p => !stats.provingFound.includes(p.evidenceId)).map(p => `${getEvidence(state, p.evidenceId)?.name}: ${p.whatItProves}`),
    redHerrings: t.redHerrings.map(r => `${r.description} (pointed at ${getSuspect(state, r.pointsAt)?.name}): ${r.whyMisleading}`),
    procedure: stats.procedureErrors.join(' | ') || 'Procedure was clean.',
    outcome: '(The AI debrief could not be generated; this summary was produced by the game.)'
  };
}
