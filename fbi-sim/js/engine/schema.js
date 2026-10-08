// Validation of the generated case truth. Returns a list of problems; an
// empty list means the case is playable. The generator regenerates on
// problems, feeding them back to the model.

export const LAB_DISCIPLINES = ['fingerprints', 'dna', 'ballistics', 'toxicology', 'digital', 'trace', 'documents'];

export function validateCase(c) {
  const problems = [];
  const need = (cond, msg) => { if (!cond) problems.push(msg); };
  if (!c || typeof c !== 'object') return ['Case is not an object'];

  need(typeof c.caseNumber === 'string' && c.caseNumber, 'caseNumber missing');
  need(typeof c.title === 'string' && c.title, 'title missing');
  need(c.victim && c.victim.name, 'victim.name missing');
  need(c.crime && c.crime.whatReallyHappened, 'crime.whatReallyHappened missing');
  need(typeof c.initialReport === 'string' && c.initialReport.length > 80, 'initialReport missing or too short');
  need(typeof c.supervisorBriefing === 'string' && c.supervisorBriefing.length > 80, 'supervisorBriefing missing or too short');
  need(Array.isArray(c.timeline) && c.timeline.length >= 4, 'timeline needs at least 4 entries');

  const suspects = Array.isArray(c.suspects) ? c.suspects : [];
  need(suspects.length >= 4 && suspects.length <= 6, `need 4-6 suspects, got ${suspects.length}`);
  const sIds = new Set();
  for (const s of suspects) {
    need(s.id && !sIds.has(s.id), `suspect id missing or duplicate: ${s.id}`);
    sIds.add(s.id);
    need(s.name, `suspect ${s.id} missing name`);
    need(s.speechStyle, `suspect ${s.id} missing speechStyle`);
    need(s.alibi && typeof s.alibi.claim === 'string' && typeof s.alibi.isTrue === 'boolean', `suspect ${s.id} alibi incomplete`);
    need(typeof s.isCulprit === 'boolean', `suspect ${s.id} isCulprit must be boolean`);
  }
  const culprits = suspects.filter(s => s.isCulprit);
  need(culprits.length === 1, `exactly one suspect must be the culprit, got ${culprits.length}`);
  need(c.culprit && sIds.has(c.culprit.suspectId), 'culprit.suspectId does not match a suspect');
  if (c.culprit && culprits.length === 1) need(c.culprit.suspectId === culprits[0].id, 'culprit.suspectId disagrees with isCulprit flags');
  need(c.culprit && c.culprit.motive && c.culprit.means && c.culprit.opportunity, 'culprit motive/means/opportunity missing');

  const locations = Array.isArray(c.locations) ? c.locations : [];
  need(locations.length >= 3, 'need at least 3 locations');
  const lIds = new Set();
  for (const l of locations) {
    need(l.id && !lIds.has(l.id), `location id missing or duplicate: ${l.id}`);
    lIds.add(l.id);
    need(l.name && l.description, `location ${l.id} missing name/description`);
    need(Array.isArray(l.searchableAreas) && l.searchableAreas.length >= 2, `location ${l.id} needs searchableAreas`);
  }
  need(locations.some(l => l.initiallyKnown), 'at least one location must be initiallyKnown');

  const evidence = Array.isArray(c.evidence) ? c.evidence : [];
  need(evidence.length >= 6, `need at least 6 evidence items, got ${evidence.length}`);
  const eIds = new Set();
  for (const e of evidence) {
    need(e.id && !eIds.has(e.id), `evidence id missing or duplicate: ${e.id}`);
    eIds.add(e.id);
    need(e.name && e.description, `evidence ${e.id} missing name/description`);
    need(lIds.has(e.locationId), `evidence ${e.id} locationId "${e.locationId}" does not exist`);
    need(e.exactSpot, `evidence ${e.id} missing exactSpot`);
    need(Array.isArray(e.closeLookReveals) && e.closeLookReveals.length >= 1, `evidence ${e.id} needs closeLookReveals`);
    if (e.pointsTo != null) need(sIds.has(e.pointsTo), `evidence ${e.id} pointsTo unknown suspect ${e.pointsTo}`);
    if (!e.lab || typeof e.lab !== 'object') e.lab = {};
  }
  need(evidence.some(e => e.lab && LAB_DISCIPLINES.some(d => e.lab[d])), 'at least one evidence item needs a lab result');

  const witnesses = Array.isArray(c.witnesses) ? c.witnesses : [];
  need(witnesses.length >= 2, 'need at least 2 witnesses');
  const wIds = new Set();
  for (const w of witnesses) {
    need(w.id && !wIds.has(w.id) && !sIds.has(w.id), `witness id missing/duplicate: ${w.id}`);
    wIds.add(w.id);
    need(w.name && w.whatTheySaw && w.initialStatement, `witness ${w.id} incomplete`);
  }

  const proving = Array.isArray(c.provingClues) ? c.provingClues : [];
  const provingIds = new Set(proving.map(p => p.evidenceId));
  need(provingIds.size >= 3, `need at least 3 independent provingClues, got ${provingIds.size}`);
  for (const p of proving) {
    need(eIds.has(p.evidenceId), `provingClue references unknown evidence ${p.evidenceId}`);
    const ev = evidence.find(e => e.id === p.evidenceId);
    if (ev) need(!ev.initiallyKnown, `proving clue ${p.evidenceId} must not be initiallyKnown`);
  }

  const rh = Array.isArray(c.redHerrings) ? c.redHerrings : [];
  need(rh.length >= 2 && rh.length <= 3, `need 2-3 redHerrings, got ${rh.length}`);
  for (const r of rh) {
    need(sIds.has(r.pointsAt), `redHerring pointsAt unknown suspect ${r.pointsAt}`);
    if (c.culprit) need(r.pointsAt !== c.culprit.suspectId, 'a red herring must not point at the culprit');
  }

  need(Array.isArray(c.charges) && c.charges.length >= 1, 'charges missing');
  need(typeof c.deadlineHours === 'number' && c.deadlineHours >= 24, 'deadlineHours missing');
  return problems;
}
