// The Game Master turn loop. Builds the context the GM sees, streams the
// reply, parses the JSON, and applies validated state changes.

import { GM_SYSTEM_PROMPT } from '../prompts/gmSystem.js';
import { buildSummaryPrompt } from '../prompts/summary.js';
import { extractJSON, extractPartialNarrative } from './json.js';
import { complete } from '../providers/index.js';
import {
  applyChanges, addLog, spendTime, baseCostFor, processDue, remainingMinutes,
  getSuspect, getWitness, getEvidence, getLocation, hasWarrantFor
} from './state.js';
import { formatClock, formatDuration } from './clock.js';

const RECENT_TURNS = 12;           // turns kept verbatim
const SUMMARIZE_AFTER = 20;        // when history exceeds this, fold the oldest into the summary

/** Visible state the GM is given each turn (never the truth's hidden conclusions; those are in the truth block). */
export function buildStateSnapshot(state) {
  const t = state.truth;
  const suspects = t.suspects.map(s => {
    const ss = state.suspects[s.id];
    return {
      id: s.id, name: s.name, known: state.discovered.suspects.includes(s.id),
      mood: ss.mood, rapport: ss.rapport, alibiStatus: ss.alibiStatus, lawyeredUp: ss.lawyeredUp,
      evidencePresented: ss.presented.map(id => getEvidence(state, id)?.name).filter(Boolean),
      priorExchanges: ss.transcript.slice(-12).map(x => ({ agent: x.q, them: x.a.slice(0, 500) }))
    };
  });
  const witnesses = t.witnesses.filter(w => state.discovered.witnesses.includes(w.id)).map(w => ({
    id: w.id, name: w.name, priorExchanges: state.witnesses[w.id].transcript.slice(-8).map(x => ({ agent: x.q, them: x.a.slice(0, 400) }))
  }));
  const evidence = state.discovered.evidence.map(id => {
    const e = getEvidence(state, id); const es = state.evidence[id];
    return {
      id, name: e.name, examinedCount: es.examinedCount, excluded: es.excluded,
      labResults: es.labRequests.filter(r => r.delivered).map(r => ({ discipline: r.discipline, result: r.result })),
      labPending: es.labRequests.filter(r => !r.delivered).map(r => r.discipline)
    };
  });
  return {
    agent: state.agent,
    inGameTime: formatClock(state.clock.startISO, state.clock.elapsedMinutes),
    elapsed: formatDuration(state.clock.elapsedMinutes),
    timeRemaining: formatDuration(remainingMinutes(state)),
    overDeadline: remainingMinutes(state) < 0,
    currentLocation: state.currentLocation,
    knownLocations: state.discovered.locations,
    warrantsGranted: state.legal.filter(l => l.status === 'granted').map(l => ({ kind: l.kind, target: l.target })),
    legalDenied: state.legal.filter(l => l.status === 'denied').map(l => ({ kind: l.kind, target: l.target, reason: l.reason })),
    recordsPulled: state.records.map(r => ({ suspectId: r.suspectId, kind: r.kind })),
    evidence, suspects, witnesses,
    factsEstablished: state.facts.map(f => f.text),
    procedureErrors: state.procedureErrors.map(p => p.text),
    hintsTaken: state.hints
  };
}

/** Turn a UI action into the structured message the GM receives. */
export function describeAction(state, action) {
  const words = (action.text || '').trim();
  switch (action.type) {
    case 'dispatch': return `[ACTION: DISPATCH]\nAgent to handler: ${words}`;
    case 'hint': return `[ACTION: DISPATCH - the agent is asking for guidance; a hint is requested]\nAgent to handler: ${words || 'Where should I be looking?'}`;
    case 'visit': {
      const loc = getLocation(state, action.locationId);
      const warrant = hasWarrantFor(state, loc.id) ? 'The agent HAS a search warrant for this location.' : (loc.isPrivate ? 'The agent has NO warrant for this private location.' : 'Public or consented location.');
      return `[ACTION: VISIT location=${loc.id} ("${loc.name}", ${loc.address})]\n${warrant}\nAgent: ${words || 'I head over and take in the scene.'}`;
    }
    case 'search': {
      const loc = getLocation(state, action.locationId);
      const warrant = hasWarrantFor(state, loc.id) ? 'The agent HAS a search warrant for this location.' : (loc.isPrivate ? 'The agent has NO warrant for this private location.' : 'Public or consented location.');
      return `[ACTION: SEARCH location=${loc.id} ("${loc.name}") area="${action.area || 'general'}"]\n${warrant}\nAgent: ${words || `I search the ${action.area}.`}`;
    }
    case 'canvass': {
      const loc = getLocation(state, action.locationId);
      return `[ACTION: CANVASS location=${loc.id} ("${loc.name}") - the agent canvasses neighbours and bystanders]\nAgent: ${words || 'I knock on doors and ask what people saw.'}`;
    }
    case 'interview': {
      const p = getSuspect(state, action.personId) || getWitness(state, action.personId);
      const kind = getSuspect(state, action.personId) ? 'SUSPECT' : 'WITNESS';
      const ss = state.suspects[action.personId];
      const custody = action.custody ? 'Setting: formal interview room at the field office (custodial).' : 'Setting: non-custodial conversation at a place of the agent\'s choosing.';
      const lawyer = ss?.lawyeredUp ? 'NOTE: this person has already requested counsel.' : '';
      return `[ACTION: INTERVIEW ${kind} id=${p.id} ("${p.name}")]\n${custody} ${lawyer}\nAgent says: "${words}"`;
    }
    case 'present': {
      const p = getSuspect(state, action.personId) || getWitness(state, action.personId);
      const ev = getEvidence(state, action.evidenceId);
      return `[ACTION: PRESENT EVIDENCE to id=${p.id} ("${p.name}") item=${ev.id} ("${ev.name}")]\nThe agent places the item in front of them.${state.evidence[ev.id].excluded ? ' (This item was obtained unlawfully.)' : ''}\nAgent says: "${words || 'Explain this.'}"`;
    }
    case 'examine': {
      const ev = getEvidence(state, action.evidenceId);
      return `[ACTION: EXAMINE evidence=${ev.id} ("${ev.name}") - examination number ${state.evidence[ev.id].examinedCount + 1}]\nAgent: ${words || 'I take a close look.'}`;
    }
    case 'compare': {
      const a = getEvidence(state, action.evidenceId); const b = getEvidence(state, action.evidenceId2);
      return `[ACTION: COMPARE evidence=${a.id} ("${a.name}") with evidence=${b.id} ("${b.name}")]\nAgent: ${words || 'I lay them side by side.'}`;
    }
    case 'legal': {
      const app = state.legal.find(l => l.id === action.legalId);
      const targetName = app.kind === 'search' ? getLocation(state, app.target)?.name : getSuspect(state, app.target)?.name;
      return `[ACTION: LEGAL application id=${app.id} kind=${app.kind} target=${app.target} ("${targetName}")]\nThe agent's sworn justification:\n"""${app.justification}"""\nDecide on probable cause actually in the state. Respond as the magistrate judge (warrants) or the AUSA (subpoenas) and set legalDecision.`;
    }
    case 'arrest': {
      const p = getSuspect(state, action.personId);
      return `[ACTION: ARREST suspect=${p.id} ("${p.name}")]\nAgent: ${words || 'I move to take them into custody.'}`;
    }
    default: return `[ACTION: FREE]\nAgent: ${words}`;
  }
}

function speakerFor(state, action) {
  if (action.type === 'dispatch' || action.type === 'hint') return 'dispatch';
  if (action.type === 'legal') return 'judge';
  if (action.type === 'interview' || action.type === 'present') return `${getSuspect(state, action.personId) ? 'suspect' : 'witness'}:${action.personId}`;
  return 'narrator';
}

/**
 * Run one GM turn.
 *   onNarrative(text) is called repeatedly with the narrative so far (for the typewriter).
 *   Returns { narrative, speaker, changes, notices, raw, fallback }.
 */
export async function runTurn({ state, action, provider, apiKey, model, baseUrl, onNarrative, onStatus, signal }) {
  const actionText = describeAction(state, action);
  const snapshot = buildStateSnapshot(state);
  const context = [
    'CASE TRUTH (hidden; never reveal):',
    JSON.stringify(state.truth),
    '',
    'CURRENT STATE:',
    JSON.stringify(snapshot),
    '',
    state.summary ? `SUMMARY OF EARLIER PLAY:\n${state.summary}` : 'SUMMARY OF EARLIER PLAY: (case just opened)'
  ].join('\n');

  const messages = [
    { role: 'user', content: `${context}\n\n(The transcript of recent turns follows as separate messages. Reply only to the final ACTION.)` },
    { role: 'assistant', content: '{"narrative": "Understood. Standing by for the agent\'s next action.", "speaker": "narrator"}' },
    ...state.history.slice(-RECENT_TURNS),
    { role: 'user', content: actionText }
  ];

  let raw = '';
  let parsed = null;
  let fallback = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    onStatus?.(attempt === 1 ? 'Transmitting...' : 'Malformed reply; retrying...');
    raw = '';
    let lastShown = '';
    const msgs = attempt === 1 ? messages : [...messages.slice(0, -1), { role: 'user', content: `${actionText}\n\n(Your previous reply was not valid JSON. Reply with exactly one JSON object as specified, "narrative" first.)` }];
    try {
      raw = await complete(provider, { apiKey, model, baseUrl, json: true, system: GM_SYSTEM_PROMPT, messages: msgs, maxTokens: 2500, temperature: 0.85, signal }, (chunk, text) => {
        const n = extractPartialNarrative(text);
        if (n != null && n !== lastShown) { lastShown = n; onNarrative?.(n); }
      });
    } catch (err) {
      if (signal?.aborted || attempt === 2) throw err;
      continue;
    }
    try {
      parsed = extractJSON(raw);
      if (typeof parsed.narrative !== 'string') throw new Error('no narrative');
      break;
    } catch {
      parsed = null;
    }
  }
  if (!parsed) {
    fallback = true;
    const n = extractPartialNarrative(raw);
    parsed = { narrative: (n && n.length > 20) ? n : raw.replace(/^[{\s"]*narrative"?\s*:?\s*"?/, '').trim(), speaker: speakerFor(state, action), changes: {} };
  }
  onNarrative?.(parsed.narrative);

  // Time.
  const base = baseCostFor(action.type, state);
  const extraTime = Math.min(240, Math.max(0, Number(parsed.extraTimeMinutes) || 0));
  spendTime(state, base + extraTime);

  // Context flags for applyChanges.
  const ctx = {};
  if (action.type === 'search' || action.type === 'visit') {
    const loc = getLocation(state, action.locationId);
    ctx.unlawfulSearch = loc.isPrivate && !hasWarrantFor(state, loc.id);
    state.currentLocation = loc.id;
  }
  if (action.type === 'legal') ctx.legalId = action.legalId;
  if (action.type === 'examine') state.evidence[action.evidenceId].examinedCount += 1;
  if (action.type === 'present' && state.suspects[action.personId]) {
    const pr = state.suspects[action.personId].presented;
    if (!pr.includes(action.evidenceId)) pr.push(action.evidenceId);
  }
  const notices = applyChanges(state, parsed.changes || {}, ctx);

  // Transcript bookkeeping.
  const speaker = parsed.speaker || speakerFor(state, action);
  if (action.type === 'interview' || action.type === 'present') {
    const q = action.type === 'present' ? `[Presents ${getEvidence(state, action.evidenceId).name}] ${action.text || ''}`.trim() : action.text;
    const entry = { q, a: parsed.narrative, at: state.clock.elapsedMinutes };
    if (state.suspects[action.personId]) state.suspects[action.personId].transcript.push(entry);
    else if (state.witnesses[action.personId]) state.witnesses[action.personId].transcript.push(entry);
  }
  addLog(state, action.type, parsed.narrative, speaker);
  state.history.push({ role: 'user', content: actionText }, { role: 'assistant', content: JSON.stringify({ narrative: parsed.narrative, speaker, changes: parsed.changes || {} }) });
  state.turnCount += 1;

  // Deliver lab and records whose time has come.
  notices.push(...processDue(state));

  // Fold old turns into the rolling summary (best effort; failure is harmless).
  if (state.history.length > SUMMARIZE_AFTER * 2) {
    const old = state.history.splice(0, state.history.length - RECENT_TURNS);
    try {
      onStatus?.('Updating case summary...');
      const turns = old.map(t => ({ role: t.role, content: t.role === 'assistant' ? safeNarrative(t.content) : t.content }));
      state.summary = (await complete(provider, { apiKey, model, baseUrl, json: false, system: 'You summarise role-play transcripts precisely.', messages: [{ role: 'user', content: buildSummaryPrompt({ previousSummary: state.summary, turns }) }], maxTokens: 1200, temperature: 0.3, signal })).trim();
    } catch {
      state.history.unshift(...old);
    }
  }
  return { narrative: parsed.narrative, speaker, changes: parsed.changes || {}, notices, raw, fallback, timeSpent: base + extraTime };
}

function safeNarrative(json) {
  try { return JSON.parse(json).narrative || json; } catch { return json; }
}
