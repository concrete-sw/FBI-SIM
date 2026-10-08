// Game state: everything the code owns. The GM proposes changes; applyChanges
// validates every id against the truth before accepting it.

import { BASE_COST, DIFFICULTY_TIME_SCALE, LAB_TURNAROUND_MIN, SUBPOENA_TURNAROUND_MIN } from './clock.js';

export const MOODS = ['calm', 'cooperative', 'nervous', 'defensive', 'hostile', 'grieving', 'evasive', 'shaken', 'silent', 'lawyered'];

export function newGameState({ agent, truth, settings }) {
  const startISO = (() => {
    const d = new Date(`${truth.setting?.dateOfCrime || '2026-03-10'}T08:00:00`);
    if (isNaN(d)) return new Date().toISOString();
    d.setDate(d.getDate() + 1);
    return d.toISOString();
  })();

  const state = {
    version: 1,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    agent: { ...agent },
    settings: { ...settings },
    truth,
    clock: { startISO, elapsedMinutes: 0, deadlineMinutes: (truth.deadlineHours || 72) * 60 },
    discovered: {
      evidence: truth.evidence.filter(e => e.initiallyKnown).map(e => e.id),
      locations: truth.locations.filter(l => l.initiallyKnown).map(l => l.id),
      suspects: truth.suspects.map(s => s.id),
      witnesses: truth.witnesses.filter(w => w.initiallyKnown).map(w => w.id)
    },
    evidence: {},     // id -> { examinedCount, labRequests: [], excluded, excludedReason, foundAt }
    suspects: {},     // id -> { mood, rapport, alibiStatus, lawyeredUp, transcript: [], presented: [] }
    witnesses: {},    // id -> { transcript: [] }
    legal: [],        // { id, kind: 'search'|'arrest'|'subpoena-phone'|'subpoena-financial', target, justification, status, decidedAt, reason, readyAt }
    records: [],      // { suspectId, kind, text, at }
    facts: [],        // { text, at, source }
    notes: '',
    board: { links: [] },   // { from, to, label }
    log: [],          // { at, kind, text, speaker }
    history: [],      // recent GM turns [{ role, content }]
    summary: '',
    turnCount: 0,
    hints: 0,
    procedureErrors: [],
    currentLocation: truth.locations.find(l => l.initiallyKnown)?.id || null,
    closed: false,
    report: null,
    grade: null
  };
  for (const e of truth.evidence) state.evidence[e.id] = { examinedCount: 0, labRequests: [], excluded: false, excludedReason: '', foundAt: e.initiallyKnown ? 0 : null };
  for (const s of truth.suspects) state.suspects[s.id] = { mood: s.initialMood || 'calm', rapport: 0, alibiStatus: 'unverified', lawyeredUp: false, transcript: [], presented: [] };
  for (const w of truth.witnesses) state.witnesses[w.id] = { transcript: [] };
  return state;
}

export function timeScale(state) {
  return DIFFICULTY_TIME_SCALE[state.settings.difficulty] || 1;
}

export function spendTime(state, minutes) {
  state.clock.elapsedMinutes += Math.max(0, Math.round(minutes));
}

export function remainingMinutes(state) {
  return state.clock.deadlineMinutes - state.clock.elapsedMinutes;
}

export function baseCostFor(actionType, state) {
  return Math.round((BASE_COST[actionType] ?? BASE_COST.free) * timeScale(state));
}

export function addLog(state, kind, text, speaker = null) {
  state.log.push({ at: state.clock.elapsedMinutes, kind, text, speaker });
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}

export function addFact(state, text, source = 'gm') {
  if (!text || state.facts.some(f => f.text === text)) return;
  state.facts.push({ text, at: state.clock.elapsedMinutes, source });
}

export const getSuspect = (state, id) => state.truth.suspects.find(s => s.id === id);
export const getWitness = (state, id) => state.truth.witnesses.find(w => w.id === id);
export const getEvidence = (state, id) => state.truth.evidence.find(e => e.id === id);
export const getLocation = (state, id) => state.truth.locations.find(l => l.id === id);
export const getPerson = (state, id) => getSuspect(state, id) || getWitness(state, id);

/** Apply a validated GM changes block. Returns a list of human-readable notices. */
export function applyChanges(state, changes, context = {}) {
  const notices = [];
  if (!changes || typeof changes !== 'object') return notices;
  const t = state.truth;

  for (const id of asArray(changes.evidenceFound)) {
    const ev = getEvidence(state, id);
    if (!ev || state.discovered.evidence.includes(id)) continue;
    state.discovered.evidence.push(id);
    state.evidence[id].foundAt = state.clock.elapsedMinutes;
    if (ev.requiresWarrant && context.unlawfulSearch) {
      state.evidence[id].excluded = true;
      state.evidence[id].excludedReason = 'Seized without a warrant; inadmissible.';
      notices.push(`Evidence logged (INADMISSIBLE): ${ev.name}`);
    } else {
      notices.push(`Evidence logged: ${ev.name}`);
    }
    addLog(state, 'evidence', `Collected: ${ev.name}`);
  }
  for (const id of asArray(changes.locationsUnlocked)) {
    if (getLocation(state, id) && !state.discovered.locations.includes(id)) {
      state.discovered.locations.push(id);
      notices.push(`Location added: ${getLocation(state, id).name}`);
    }
  }
  for (const id of asArray(changes.personsAdded)) {
    if (getSuspect(state, id) && !state.discovered.suspects.includes(id)) {
      state.discovered.suspects.push(id);
      notices.push(`Person of interest added: ${getSuspect(state, id).name}`);
    } else if (getWitness(state, id) && !state.discovered.witnesses.includes(id)) {
      state.discovered.witnesses.push(id);
      notices.push(`Witness added: ${getWitness(state, id).name}`);
    }
  }
  for (const f of asArray(changes.factsLearned).slice(0, 3)) {
    if (typeof f === 'string' && f.trim()) { addFact(state, f.trim()); notices.push(`Fact noted: ${f.trim()}`); }
  }
  if (changes.moodChanges && typeof changes.moodChanges === 'object') {
    for (const [id, mood] of Object.entries(changes.moodChanges)) {
      if (state.suspects[id] && MOODS.includes(mood)) state.suspects[id].mood = mood;
    }
  }
  if (changes.rapportDelta && typeof changes.rapportDelta === 'object') {
    for (const [id, d] of Object.entries(changes.rapportDelta)) {
      if (state.suspects[id] && Number.isFinite(d)) state.suspects[id].rapport = clamp(state.suspects[id].rapport + clamp(Math.round(d), -3, 3), -10, 10);
    }
  }
  if (changes.alibiStatus && typeof changes.alibiStatus === 'object') {
    for (const [id, st] of Object.entries(changes.alibiStatus)) {
      if (state.suspects[id] && ['unverified', 'confirmed', 'broken'].includes(st)) {
        if (state.suspects[id].alibiStatus !== st) notices.push(`Alibi of ${getSuspect(state, id).name}: ${st.toUpperCase()}`);
        state.suspects[id].alibiStatus = st;
      }
    }
  }
  for (const id of asArray(changes.lawyeredUp)) {
    if (state.suspects[id] && !state.suspects[id].lawyeredUp) {
      state.suspects[id].lawyeredUp = true;
      state.suspects[id].mood = 'lawyered';
      notices.push(`${getSuspect(state, id).name} has requested counsel. Questioning must stop.`);
    }
  }
  if (typeof changes.procedureError === 'string' && changes.procedureError.trim()) {
    state.procedureErrors.push({ at: state.clock.elapsedMinutes, text: changes.procedureError.trim() });
    notices.push(`PROCEDURE: ${changes.procedureError.trim()}`);
    addLog(state, 'procedure', changes.procedureError.trim());
  }
  if (changes.hintGiven === true) { state.hints += 1; notices.push('Hint taken (score penalty).'); }

  if (changes.legalDecision && typeof changes.legalDecision === 'object' && context.legalId) {
    const app = state.legal.find(l => l.id === context.legalId);
    if (app && app.status === 'pending') {
      app.status = changes.legalDecision.granted ? 'granted' : 'denied';
      app.reason = String(changes.legalDecision.reason || '');
      app.decidedAt = state.clock.elapsedMinutes;
      if (app.status === 'granted' && app.kind.startsWith('subpoena-')) {
        const k = app.kind.replace('subpoena-', '');
        app.readyAt = state.clock.elapsedMinutes + Math.round((SUBPOENA_TURNAROUND_MIN[k] || 480) * timeScale(state));
      }
      notices.push(`${labelLegal(app.kind)} ${app.status.toUpperCase()}: ${app.target}`);
      addLog(state, 'legal', `${labelLegal(app.kind)} for ${app.target}: ${app.status}`);
    }
  }
  return notices;
}

export function labelLegal(kind) {
  return { search: 'Search warrant', arrest: 'Arrest warrant', 'subpoena-phone': 'Phone records subpoena', 'subpoena-financial': 'Financial records subpoena' }[kind] || kind;
}

export function hasWarrantFor(state, locationId) {
  return state.legal.some(l => l.kind === 'search' && l.status === 'granted' && l.target === locationId);
}

export function requestLab(state, evidenceId, discipline) {
  const es = state.evidence[evidenceId];
  if (!es) throw new Error('Unknown evidence');
  if (es.labRequests.some(r => r.discipline === discipline)) throw new Error('Already submitted for that analysis');
  const readyAt = state.clock.elapsedMinutes + Math.round((LAB_TURNAROUND_MIN[discipline] || 600) * timeScale(state));
  es.labRequests.push({ discipline, requestedAt: state.clock.elapsedMinutes, readyAt, delivered: false, result: null });
  addLog(state, 'lab', `Submitted ${getEvidence(state, evidenceId).name} for ${discipline}`);
  return readyAt;
}

/** Deliver any lab results and subpoena returns whose time has come. Returns notices. */
export function processDue(state) {
  const notices = [];
  const now = state.clock.elapsedMinutes;
  for (const [id, es] of Object.entries(state.evidence)) {
    for (const r of es.labRequests) {
      if (!r.delivered && r.readyAt <= now) {
        r.delivered = true;
        const ev = getEvidence(state, id);
        const raw = ev.lab?.[r.discipline];
        r.result = raw ? String(raw) : `No probative result. ${disciplineNoResult(r.discipline)}`;
        notices.push(`LAB RESULT (${r.discipline}): ${ev.name}`);
        addLog(state, 'lab', `Lab returned ${r.discipline} on ${ev.name}: ${r.result}`);
        if (raw) addFact(state, `Lab (${r.discipline}) on "${ev.name}": ${r.result}`, 'lab');
      }
    }
  }
  for (const app of state.legal) {
    if (app.status === 'granted' && app.kind.startsWith('subpoena-') && app.readyAt != null && app.readyAt <= now && !app.returned) {
      app.returned = true;
      const s = getSuspect(state, app.target);
      const kind = app.kind.replace('subpoena-', '');
      const text = kind === 'phone' ? (s?.phoneRecordsSummary || 'Nothing of note.') : (s?.financialsSummary || 'Nothing of note.');
      state.records.push({ suspectId: app.target, kind, text, at: now });
      notices.push(`RECORDS RETURNED (${kind}): ${s?.name || app.target}`);
      addLog(state, 'records', `${kind} records for ${s?.name}: ${text}`);
      addFact(state, `${kind === 'phone' ? 'Phone' : 'Financial'} records for ${s?.name}: ${text}`, 'records');
    }
  }
  return notices;
}

function disciplineNoResult(d) {
  return {
    fingerprints: 'No latent prints of comparison value.',
    dna: 'Insufficient or degraded biological material.',
    ballistics: 'Item is not a firearm or ammunition component.',
    toxicology: 'No controlled substances or toxins detected.',
    digital: 'No recoverable data of relevance.',
    trace: 'No transferable trace material identified.',
    documents: 'No indicia of alteration or hidden content.'
  }[d] || '';
}

export function pullRecord(state, suspectId, kind) {
  const s = getSuspect(state, suspectId);
  if (!s) throw new Error('Unknown suspect');
  if (state.records.some(r => r.suspectId === suspectId && r.kind === kind)) throw new Error('Already pulled');
  let text;
  if (kind === 'criminal') text = s.criminalHistory || 'No record.';
  else if (kind === 'vehicle') text = s.vehicle || 'No vehicle registered.';
  else throw new Error('That record requires a subpoena');
  state.records.push({ suspectId, kind, text, at: state.clock.elapsedMinutes });
  addLog(state, 'records', `${kind} record for ${s.name}: ${text}`);
  addFact(state, `${kind === 'criminal' ? 'Criminal history' : 'Vehicle registration'} for ${s.name}: ${text}`, 'records');
  return text;
}

export function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
function asArray(x) { return Array.isArray(x) ? x : []; }
