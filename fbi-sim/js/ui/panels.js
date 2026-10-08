// Every desktop panel: a window definition with a render(body) function that
// redraws from app.state. Panels never touch the hidden truth beyond what the
// player has legitimately discovered.

import { h, clear, toast, modal, fmtMins } from './dom.js';
import { getSuspect, getWitness, getEvidence, getLocation, getPerson, hasWarrantFor, labelLegal } from '../engine/state.js';
import { LAB_DISCIPLINES } from '../engine/schema.js';
import { LAB_TURNAROUND_MIN, formatDuration } from '../engine/clock.js';
import * as store from '../engine/storage.js';

export const DOCK_ORDER = ['fieldlog', 'casefile', 'evidence', 'persons', 'interview', 'locations', '---', 'lab', 'records', 'legal', 'dispatch', '---', 'notebook', 'board', 'close', '---', 'settings', 'help'];

export function registerPanels(app) {
  const S = () => app.state;
  const t = () => app.state.truth;
  const reg = def => app.wm.register(def);
  const time = at => fmtMins(at, S().clock.startISO);
  const tag = (txt, cls = '') => h('span', { class: `tag ${cls}` }, txt);
  const readOnly = () => S().closed;

  // ------------------------------------------------------------ FIELD LOG
  reg({
    id: 'fieldlog', title: 'Field Log', icon: '▤', size: { w: 640, h: 520 }, x: 16, y: 12,
    render(body) {
      body.classList.add('col');
      const wrap = h('div', { class: 'log-stream' });
      for (const e of S().log.slice(-80)) {
        const kind = e.kind === 'dispatch' || e.kind === 'hint' ? 'dispatch' : e.kind === 'legal' ? 'judge' : (e.speaker || '').split(':')[0] || (['system', 'evidence', 'lab', 'records', 'procedure'].includes(e.kind) ? (e.kind === 'procedure' ? 'procedure' : 'notice') : 'narrator');
        const who = e.speaker ? app.speakerLabel(e.speaker) : e.kind.toUpperCase();
        wrap.append(h('div', { class: `entry ${kind}` }, h('div', { class: 'who' }, `${time(e.at)} · ${who}`), h('div', { class: 'narr' }, e.text)));
      }
      body.append(wrap);
      wrap.scrollTop = wrap.scrollHeight;
    }
  });

  // ------------------------------------------------------------ CASE FILE
  reg({
    id: 'casefile', title: 'Case File', icon: '▣', size: { w: 560, h: 520 }, x: 680, y: 12,
    render(body) {
      const c = t();
      body.append(
        h('div', { class: 'card-head' }, h('span', { class: 'banner' }, `${c.caseNumber}`), h('span', { class: 'muted small' }, `${c.setting?.fieldOffice || ''} · ${c.setting?.city || ''}, ${c.setting?.state || ''}`)),
        h('h2', {}, c.title),
        h('dl', { class: 'kv' },
          h('dt', {}, 'Crime'), h('dd', {}, c.crimeType),
          h('dt', {}, 'Date'), h('dd', {}, c.crime?.when || c.setting?.dateOfCrime || ''),
          h('dt', {}, 'Victim'), h('dd', {}, `${c.victim.name}, ${c.victim.age}, ${c.victim.occupation}`),
          h('dt', {}, 'Deadline'), h('dd', {}, `${c.deadlineHours} hours from assignment`),
          h('dt', {}, 'Difficulty'), h('dd', {}, `${S().settings.difficulty} / ${S().settings.length}`)),
        h('h2', {}, 'Supervisor briefing'), h('p', { class: 'narr' }, c.supervisorBriefing),
        h('h2', {}, 'Initial report'), h('p', { class: 'narr' }, c.initialReport),
        h('h2', {}, 'Victim'), h('p', { class: 'narr' }, c.victim.description),
        h('h2', {}, 'Established timeline'),
        h('ul', { class: 'timeline' }, (c.timeline || []).filter(x => x.knownInitially).map(x => h('li', {}, `${x.time}: ${x.event}`)), (c.timeline || []).some(x => x.knownInitially) ? null : h('li', { class: 'muted' }, 'Nothing firm yet.')),
        h('h2', {}, 'Statements on file'),
        ...c.witnesses.filter(w => S().discovered.witnesses.includes(w.id)).map(w => h('div', { class: 'entry witness' }, h('div', { class: 'who' }, `${w.name} · ${w.role}`), h('div', { class: 'narr' }, w.initialStatement))),
        h('h2', {}, 'Scene'), h('p', { class: 'narr' }, getLocation(S(), c.crime?.where)?.description || '')
      );
    }
  });

  // ------------------------------------------------------------- EVIDENCE
  reg({
    id: 'evidence', title: 'Evidence', icon: '◈', size: { w: 720, h: 500 }, x: 60, y: 60,
    render(body) {
      const s = S();
      const ids = s.discovered.evidence;
      if (!app.selected.evidence || !ids.includes(app.selected.evidence)) app.selected.evidence = ids[0] || null;
      const list = h('ul', { class: 'list' });
      for (const id of ids) {
        const e = getEvidence(s, id), es = s.evidence[id];
        list.append(h('li', { class: `clickable ${app.selected.evidence === id ? 'sel' : ''}`, tabindex: '0', role: 'button', onClick: () => { app.selected.evidence = id; app.wm.refresh('evidence'); }, onKeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); app.selected.evidence = id; app.wm.refresh('evidence'); } } },
          h('div', {}, `${id.toUpperCase()} · ${e.name}`, es.excluded ? tag('inadmissible', 'bad') : null, es.labRequests.some(r => r.delivered) ? tag('lab', 'ok') : es.labRequests.length ? tag('lab pending', 'warn') : null),
          h('div', { class: 'meta' }, `${e.type} · ${getLocation(s, e.locationId)?.name || ''} · ${es.foundAt == null ? '' : time(es.foundAt)}`)));
      }
      if (!ids.length) list.append(h('li', { class: 'muted' }, 'Locker is empty. Visit and search locations.'));
      const detail = h('div', { class: 'detail' });
      const id = app.selected.evidence;
      if (id) {
        const e = getEvidence(s, id), es = s.evidence[id];
        const others = ids.filter(x => x !== id);
        const cmpSel = h('select', { 'aria-label': 'Compare with' }, others.map(x => h('option', { value: x }, `${x.toUpperCase()} ${getEvidence(s, x).name}`)));
        const labSel = h('select', { 'aria-label': 'Lab discipline' }, LAB_DISCIPLINES.filter(d => !es.labRequests.some(r => r.discipline === d)).map(d => h('option', { value: d }, `${d} (~${formatDuration(LAB_TURNAROUND_MIN[d])})`)));
        const words = h('input', { type: 'text', placeholder: 'Optional: what specifically do you look at?', 'aria-label': 'Examination focus' });
        detail.append(
          h('h2', {}, `${id.toUpperCase()} · ${e.name}`),
          es.excluded ? h('p', { class: 'danger small' }, `INADMISSIBLE: ${es.excludedReason}`) : null,
          h('dl', { class: 'kv' }, h('dt', {}, 'Type'), h('dd', {}, e.type), h('dt', {}, 'Recovered'), h('dd', {}, `${getLocation(s, e.locationId)?.name || ''}${es.foundAt == null ? '' : ', ' + time(es.foundAt)}`), h('dt', {}, 'Examined'), h('dd', {}, `${es.examinedCount}×`)),
          h('p', { class: 'narr' }, e.description),
          h('div', { class: 'chip-row' }, words),
          readOnly() ? null : h('div', { class: 'chip-row' },
            h('button', { class: 'btn small', type: 'button', onClick: () => app.examine(id, words.value) }, 'Examine'),
            others.length ? h('span', { class: 'row', style: 'margin:0' }, cmpSel, h('button', { class: 'btn small', type: 'button', onClick: () => app.compare(id, cmpSel.value) }, 'Compare')) : null,
            labSel.options.length ? h('span', { class: 'row', style: 'margin:0' }, labSel, h('button', { class: 'btn small', type: 'button', onClick: () => app.sendToLab(id, labSel.value) }, 'Send to lab')) : null,
            h('button', { class: 'btn small ghost', type: 'button', onClick: () => { app.interview.presentId = id; app.wm.show('interview'); } }, 'Present in interview')),
          h('h3', {}, 'Examination notes'),
          ...(es.notes || []).map(n => h('div', { class: 'entry narrator' }, h('div', { class: 'who' }, `${time(n.at)} · ${n.kind}`), h('div', { class: 'narr' }, n.text))),
          h('h3', {}, 'Laboratory'),
          es.labRequests.length ? h('table', {}, h('tbody', {}, es.labRequests.map(r => h('tr', {}, h('th', {}, r.discipline), h('td', {}, r.delivered ? r.result : h('span', { class: 'warn' }, `pending · ETA ${time(r.readyAt)}`)))))) : h('p', { class: 'muted small' }, 'No analysis requested.')
        );
      }
      body.append(h('div', { class: 'split' }, list, detail));
    }
  });

  // -------------------------------------------------------------- PERSONS
  reg({
    id: 'persons', title: 'Persons', icon: '☰', size: { w: 720, h: 520 }, x: 100, y: 80,
    render(body) {
      const s = S();
      const people = [...t().suspects.filter(x => s.discovered.suspects.includes(x.id)).map(x => ({ ...x, _kind: 'suspect' })), ...t().witnesses.filter(x => s.discovered.witnesses.includes(x.id)).map(x => ({ ...x, _kind: 'witness' }))];
      if (!app.selected.person || !people.some(p => p.id === app.selected.person)) app.selected.person = people[0]?.id || null;
      const list = h('ul', { class: 'list' });
      for (const p of people) {
        const ss = s.suspects[p.id];
        list.append(h('li', { class: `clickable ${app.selected.person === p.id ? 'sel' : ''}`, tabindex: '0', role: 'button', onClick: () => { app.selected.person = p.id; app.wm.refresh('persons'); }, onKeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); app.selected.person = p.id; app.wm.refresh('persons'); } } },
          h('div', {}, p.name, tag(p._kind), ss ? tag(ss.alibiStatus, ss.alibiStatus === 'broken' ? 'bad' : ss.alibiStatus === 'confirmed' ? 'ok' : '') : null, ss?.lawyeredUp ? tag('counsel', 'warn') : null),
          h('div', { class: 'meta' }, `${p.occupation || p.role || ''}${ss ? ` · mood: ${ss.mood} · rapport ${ss.rapport >= 0 ? '+' : ''}${ss.rapport}` : ''}`)));
      }
      const detail = h('div', { class: 'detail' });
      const p = people.find(x => x.id === app.selected.person);
      if (p) {
        const ss = s.suspects[p.id];
        const recs = s.records.filter(r => r.suspectId === p.id);
        const transcript = (ss || s.witnesses[p.id])?.transcript || [];
        detail.append(
          h('h2', {}, p.name),
          h('dl', { class: 'kv' },
            h('dt', {}, 'Role'), h('dd', {}, p._kind === 'suspect' ? `Person of interest · ${p.occupation}, ${p.age}` : `Witness · ${p.role}`),
            p.relationshipToVictim ? h('dt', {}, 'Link to victim') : null, p.relationshipToVictim ? h('dd', {}, p.relationshipToVictim) : null,
            ss ? h('dt', {}, 'Stated alibi') : null, ss ? h('dd', {}, `${p.alibi.claim} `, tag(ss.alibiStatus, ss.alibiStatus === 'broken' ? 'bad' : ss.alibiStatus === 'confirmed' ? 'ok' : '')) : null,
            ss ? h('dt', {}, 'Demeanour') : null, ss ? h('dd', {}, `${ss.mood}; rapport ${ss.rapport}${ss.lawyeredUp ? '; has requested counsel' : ''}`) : null),
          p.background ? h('p', { class: 'narr' }, p.background) : null,
          p._kind === 'witness' ? h('div', { class: 'entry witness' }, h('div', { class: 'who' }, 'Statement on file'), h('div', { class: 'narr' }, p.initialStatement)) : null,
          readOnly() ? null : h('div', { class: 'chip-row' },
            h('button', { class: 'btn small', type: 'button', onClick: () => { app.interview.personId = p.id; app.wm.show('interview'); } }, 'Interview'),
            ss && !recs.some(r => r.kind === 'criminal') ? h('button', { class: 'btn small ghost', type: 'button', onClick: () => app.pullRecord(p.id, 'criminal') }, 'Criminal history') : null,
            ss && !recs.some(r => r.kind === 'vehicle') ? h('button', { class: 'btn small ghost', type: 'button', onClick: () => app.pullRecord(p.id, 'vehicle') }, 'Vehicle records') : null,
            ss ? h('button', { class: 'btn small ghost', type: 'button', onClick: () => { app.legalPrefill = { kind: 'subpoena-phone', target: p.id }; app.wm.show('legal'); } }, 'Subpoena records') : null),
          recs.length ? h('h3', {}, 'Records') : null,
          ...recs.map(r => h('div', { class: 'entry notice' }, h('div', { class: 'who' }, `${r.kind} · ${time(r.at)}`), h('div', { class: 'narr' }, r.text))),
          h('h3', {}, `Interview record (${transcript.length})`),
          ...transcript.map(x => h('div', {}, h('div', { class: 'entry agent' }, h('div', { class: 'who' }, `${time(x.at)} · SA ${s.agent.name}`), h('div', { class: 'narr' }, x.q)), h('div', { class: 'entry suspect' }, h('div', { class: 'who' }, p.name), h('div', { class: 'narr' }, x.a))))
        );
      }
      body.append(h('div', { class: 'split' }, list, detail));
    }
  });

  // ------------------------------------------------------------ INTERVIEW
  reg({
    id: 'interview', title: 'Interview', icon: '◉', size: { w: 640, h: 540 }, x: 140, y: 40,
    render(body) {
      const s = S();
      const people = [...t().suspects.filter(x => s.discovered.suspects.includes(x.id)), ...t().witnesses.filter(x => s.discovered.witnesses.includes(x.id))];
      if (!app.interview.personId || !people.some(p => p.id === app.interview.personId)) app.interview.personId = people[0]?.id || null;
      const who = h('select', { 'aria-label': 'Person to interview', onChange: e => { app.interview.personId = e.target.value; app.wm.refresh('interview'); } }, people.map(p => h('option', { value: p.id, selected: p.id === app.interview.personId }, `${p.name} (${getSuspect(s, p.id) ? 'POI' : 'witness'})`)));
      const custody = h('label', { class: 'check small', style: 'margin:0' }, h('input', { type: 'checkbox', checked: app.interview.custody, onChange: e => { app.interview.custody = e.target.checked; } }), 'Custodial (field office, Miranda applies)');
      const p = getPerson(s, app.interview.personId);
      const ss = s.suspects[app.interview.personId];
      const transcript = (ss || s.witnesses[app.interview.personId])?.transcript || [];
      const log = h('div', { class: 'log-stream' });
      if (p) {
        log.append(h('div', { class: 'entry system' }, `${p.name}${ss ? ` · mood ${ss.mood} · rapport ${ss.rapport} · alibi ${ss.alibiStatus}` : ' · witness'}${ss?.lawyeredUp ? ' · HAS COUNSEL' : ''}`));
        for (const x of transcript) {
          log.append(h('div', { class: 'entry agent' }, h('div', { class: 'who' }, `${time(x.at)} · SA ${s.agent.name}`), h('div', { class: 'narr' }, x.q)), h('div', { class: 'entry suspect' }, h('div', { class: 'who' }, p.name.toUpperCase()), h('div', { class: 'narr' }, x.a)));
        }
        if (!transcript.length) log.append(h('div', { class: 'entry system' }, 'No questions asked yet. Build rapport before you press; ask about specifics.'));
      }
      const q = h('textarea', { placeholder: 'Ask a question or make a statement. Enter to send, Shift+Enter for a new line.', rows: '2', 'aria-label': 'Your words' });
      q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
      const evSel = h('select', { 'aria-label': 'Evidence to present' }, s.discovered.evidence.map(id => h('option', { value: id, selected: id === app.interview.presentId }, `${id.toUpperCase()} ${getEvidence(s, id).name}`)));
      const send = async () => { const txt = q.value; if (!txt.trim() || !p) return; q.value = ''; await app.ask(p.id, txt); };
      const present = async () => { if (!p || !evSel.value) return; const txt = q.value; q.value = ''; app.interview.presentId = null; await app.present(p.id, evSel.value, txt); };
      body.classList.add('col');
      body.append(
        h('div', { class: 'row', style: 'margin:0 0 8px' }, who, custody),
        log,
        readOnly() ? null : h('div', { class: 'composer' }, q,
          h('div', { class: 'row' },
            h('button', { class: 'btn small primary', type: 'button', onClick: send }, 'Ask'),
            s.discovered.evidence.length ? h('span', { class: 'row', style: 'margin:0' }, evSel, h('button', { class: 'btn small', type: 'button', onClick: present }, 'Present evidence')) : null,
            h('span', { class: 'muted small' }, 'Tip: rapport first, then specifics: times, routes, names.')))
      );
      log.scrollTop = log.scrollHeight;
    }
  });

  // ------------------------------------------------------------ LOCATIONS
  reg({
    id: 'locations', title: 'Locations', icon: '⌖', size: { w: 700, h: 480 }, x: 180, y: 60,
    render(body) {
      const s = S();
      const ids = s.discovered.locations;
      if (!app.selected.location || !ids.includes(app.selected.location)) app.selected.location = s.currentLocation || ids[0] || null;
      const list = h('ul', { class: 'list' });
      for (const id of ids) {
        const l = getLocation(s, id);
        list.append(h('li', { class: `clickable ${app.selected.location === id ? 'sel' : ''}`, tabindex: '0', role: 'button', onClick: () => { app.selected.location = id; app.wm.refresh('locations'); }, onKeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); app.selected.location = id; app.wm.refresh('locations'); } } },
          h('div', {}, l.name, s.currentLocation === id ? tag('here', 'ok') : null, l.isPrivate ? (hasWarrantFor(s, id) ? tag('warrant', 'ok') : tag('private', 'warn')) : null),
          h('div', { class: 'meta' }, `${l.type} · ${l.address}`)));
      }
      const detail = h('div', { class: 'detail' });
      const id = app.selected.location;
      if (id) {
        const l = getLocation(s, id);
        const notes = (s.locationNotes || {})[id] || [];
        const visited = notes.length > 0;
        const area = h('input', { type: 'text', placeholder: 'Where exactly? e.g. "the desk drawers", "the dumpster behind the building"', 'aria-label': 'Area to search' });
        detail.append(
          h('h2', {}, l.name),
          h('p', { class: 'muted small' }, `${l.type} · ${l.address}${l.isPrivate ? ' · PRIVATE PROPERTY' + (hasWarrantFor(s, id) ? ' (warrant on file)' : ' (no warrant: a search needs consent, exigency or a warrant)') : ''}`),
          visited ? h('p', { class: 'narr' }, l.description) : h('p', { class: 'muted' }, 'Not yet visited.'),
          readOnly() ? null : h('div', { class: 'chip-row' },
            h('button', { class: 'btn small', type: 'button', onClick: () => app.visit(id) }, s.currentLocation === id ? 'Look around' : 'Travel there'),
            h('button', { class: 'btn small ghost', type: 'button', onClick: () => app.canvass(id) }, 'Canvass'),
            l.isPrivate && !hasWarrantFor(s, id) ? h('button', { class: 'btn small ghost', type: 'button', onClick: () => { app.legalPrefill = { kind: 'search', target: id }; app.wm.show('legal'); } }, 'Apply for warrant') : null),
          readOnly() ? null : h('div', {}, h('h3', {}, 'Search'), h('div', { class: 'chip-row' }, (l.searchableAreas || []).map(a => h('button', { class: 'btn small ghost', type: 'button', onClick: () => app.search(id, a) }, a))),
            h('div', { class: 'row' }, area, h('button', { class: 'btn small', type: 'button', onClick: () => { if (area.value.trim()) app.search(id, area.value.trim()); } }, 'Search'))),
          h('h3', {}, 'Field notes'),
          ...notes.map(n => h('div', { class: 'entry narrator' }, h('div', { class: 'who' }, `${time(n.at)} · ${n.kind}${n.area ? ': ' + n.area : ''}`), h('div', { class: 'narr' }, n.text)))
        );
      }
      body.append(h('div', { class: 'split' }, list, detail));
    }
  });

  // ------------------------------------------------------------------ LAB
  reg({
    id: 'lab', title: 'Lab', icon: '⚗', size: { w: 600, h: 420 }, x: 220, y: 100,
    render(body) {
      const s = S();
      const rows = [];
      for (const [id, es] of Object.entries(s.evidence)) for (const r of es.labRequests) rows.push({ id, name: getEvidence(s, id).name, ...r });
      rows.sort((a, b) => a.readyAt - b.readyAt);
      body.append(h('p', { class: 'muted small' }, 'Submit items from the Evidence Locker. Results arrive when the in-game clock passes the ETA. Disciplines: fingerprints, DNA, ballistics, toxicology, digital forensics, trace, questioned documents.'));
      if (!rows.length) body.append(h('p', { class: 'muted' }, 'No requests in the queue.'));
      else body.append(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', {}, 'Analysis'), h('th', {}, 'Status'), h('th', {}, 'Result'))),
        h('tbody', {}, rows.map(r => h('tr', {}, h('td', {}, `${r.id.toUpperCase()} ${r.name}`), h('td', {}, r.discipline), h('td', {}, r.delivered ? tag('returned', 'ok') : h('span', { class: 'warn' }, `ETA ${time(r.readyAt)}`)), h('td', { class: 'narr' }, r.delivered ? r.result : ''))))));
    }
  });

  // -------------------------------------------------------------- RECORDS
  reg({
    id: 'records', title: 'Records', icon: '≡', size: { w: 600, h: 420 }, x: 240, y: 120,
    render(body) {
      const s = S();
      body.append(h('p', { class: 'muted small' }, 'Criminal history and vehicle registrations are available on request from the Persons panel. Phone and financial records require a subpoena (Legal panel) and take time to return.'));
      if (!s.records.length) body.append(h('p', { class: 'muted' }, 'No records pulled.'));
      for (const r of [...s.records].reverse()) body.append(h('div', { class: 'entry notice' }, h('div', { class: 'who' }, `${time(r.at)} · ${getSuspect(s, r.suspectId)?.name} · ${r.kind}`), h('div', { class: 'narr' }, r.text)));
      const pend = s.legal.filter(l => l.kind.startsWith('subpoena-') && l.status === 'granted' && !l.returned);
      if (pend.length) body.append(h('h3', {}, 'Awaiting return'), h('ul', {}, pend.map(l => h('li', {}, `${labelLegal(l.kind)} · ${getSuspect(s, l.target)?.name} · ETA ${time(l.readyAt)}`))));
    }
  });

  // ---------------------------------------------------------------- LEGAL
  reg({
    id: 'legal', title: 'Legal', icon: '§', size: { w: 640, h: 520 }, x: 200, y: 50,
    render(body) {
      const s = S();
      const pre = app.legalPrefill || {}; app.legalPrefill = null;
      const kind = h('select', { 'aria-label': 'Application type' }, [['search', 'Search warrant (location)'], ['subpoena-phone', 'Subpoena: phone records (person)'], ['subpoena-financial', 'Subpoena: financial records (person)']].map(([v, l]) => h('option', { value: v, selected: v === pre.kind }, l)));
      const target = h('select', { 'aria-label': 'Target' });
      const fillTargets = () => {
        clear(target);
        if (kind.value === 'search') for (const id of s.discovered.locations) target.append(h('option', { value: id, selected: id === pre.target }, getLocation(s, id).name));
        else for (const id of s.discovered.suspects) target.append(h('option', { value: id, selected: id === pre.target }, getSuspect(s, id).name));
      };
      kind.addEventListener('change', fillTargets); fillTargets();
      const just = h('textarea', { rows: '6', placeholder: 'Affidavit: state the specific facts you have gathered that establish probable cause, what you expect to find, and where. Hunches are not probable cause.', 'aria-label': 'Justification' });
      body.append(
        readOnly() ? null : h('form', { class: 'report-form', onSubmit: async e => { e.preventDefault(); const r = await app.fileLegal(kind.value, target.value, just.value); if (r) just.value = ''; } },
          h('label', {}, 'Application', kind), h('label', {}, 'Target', target), h('label', {}, 'Sworn justification', just),
          h('div', { class: 'row' }, h('button', { class: 'btn primary small', type: 'submit' }, 'Submit to magistrate / AUSA'), h('span', { class: 'muted small' }, 'Filing takes about 90 minutes of in-game time.'))),
        h('h3', {}, 'Applications'),
        s.legal.length ? h('table', {}, h('tbody', {}, [...s.legal].reverse().map(l => h('tr', {}, h('td', {}, labelLegal(l.kind)), h('td', {}, l.kind === 'search' ? getLocation(s, l.target)?.name : getSuspect(s, l.target)?.name), h('td', {}, tag(l.status, l.status === 'granted' ? 'ok' : l.status === 'denied' ? 'bad' : 'warn')), h('td', { class: 'small' }, l.reason || ''))))) : h('p', { class: 'muted' }, 'None filed.')
      );
    }
  });

  // ------------------------------------------------------------- DISPATCH
  reg({
    id: 'dispatch', title: 'Dispatch', icon: '⌁', size: { w: 560, h: 460 }, x: 260, y: 80,
    render(body) {
      const s = S();
      const log = h('div', { class: 'log-stream' });
      for (const e of s.log.filter(x => x.kind === 'dispatch' || x.kind === 'hint').slice(-40)) log.append(h('div', { class: 'entry dispatch' }, h('div', { class: 'who' }, `${time(e.at)} · DISPATCH`), h('div', { class: 'narr' }, e.text)));
      const q = h('input', { type: 'text', placeholder: 'Message your supervisor (procedure, resources, charges, time)...', 'aria-label': 'Message to dispatch' });
      const send = () => { const v = q.value.trim(); if (!v) return; q.value = ''; app.dispatch(v); };
      q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
      body.classList.add('col');
      body.append(h('p', { class: 'muted small' }, `Encrypted channel to your SSA. Hints taken so far: ${s.hints}. Each hint costs score.`), log,
        readOnly() ? null : h('div', { class: 'row composer' }, q, h('button', { class: 'btn small primary', type: 'button', onClick: send }, 'Send'), h('button', { class: 'btn small ghost', type: 'button', onClick: () => app.hint(q.value.trim()) }, 'Request hint')));
      log.scrollTop = log.scrollHeight;
    }
  });

  // ------------------------------------------------------------- NOTEBOOK
  reg({
    id: 'notebook', title: 'Notebook', icon: '✎', size: { w: 560, h: 480 }, x: 280, y: 60,
    render(body) {
      const s = S();
      const ta = h('textarea', { class: 'notebook-text', 'aria-label': 'Your notes', placeholder: 'Your own notes. Saved automatically.' }, s.notes || '');
      let timer; ta.addEventListener('input', () => { s.notes = ta.value; clearTimeout(timer); timer = setTimeout(() => app.autosave(), 500); });
      body.append(h('h3', {}, `Facts established (${s.facts.length})`),
        s.facts.length ? h('ul', { class: 'small' }, s.facts.map(f => h('li', {}, h('span', { class: 'faint' }, `${time(f.at)} `), f.text))) : h('p', { class: 'muted small' }, 'Facts the GM confirms are logged here automatically.'),
        h('h3', {}, 'Procedure log'),
        s.procedureErrors.length ? h('ul', { class: 'small danger' }, s.procedureErrors.map(p => h('li', {}, `${time(p.at)} ${p.text}`))) : h('p', { class: 'muted small' }, 'Clean so far.'),
        h('h3', {}, 'Your notes'), ta);
    }
  });

  // ----------------------------------------------------------- CASE BOARD
  reg({
    id: 'board', title: 'Case Board', icon: '⊞', size: { w: 760, h: 520 }, x: 120, y: 40,
    render(body) {
      const s = S();
      const nodes = [
        ...s.discovered.suspects.map(id => ({ id, col: 0, label: getSuspect(s, id).name })),
        ...s.discovered.evidence.map(id => ({ id, col: 1, label: `${id.toUpperCase()} ${getEvidence(s, id).name}` })),
        ...s.facts.map((f, i) => ({ id: `f${i}`, col: 2, label: f.text.slice(0, 70) + (f.text.length > 70 ? '…' : '') }))
      ];
      const cols = [h('div', {}, h('h3', {}, 'Suspects')), h('div', {}, h('h3', {}, 'Evidence')), h('div', {}, h('h3', {}, 'Facts'))];
      const sel = app.selected.boardNode;
      const els = new Map();
      for (const n of nodes) {
        const el = h('div', { class: `node ${sel === n.id ? 'sel' : ''}`, tabindex: '0', role: 'button', dataset: { id: n.id }, onClick: () => pick(n.id), onKeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(n.id); } } }, n.label);
        els.set(n.id, el); cols[n.col].append(el);
      }
      const pick = async id => {
        if (readOnly()) return;
        if (!sel) { app.selected.boardNode = id; app.wm.refresh('board'); return; }
        if (sel === id) { app.selected.boardNode = null; app.wm.refresh('board'); return; }
        const existing = s.board.links.findIndex(l => (l.from === sel && l.to === id) || (l.from === id && l.to === sel));
        if (existing >= 0) { s.board.links.splice(existing, 1); }
        else {
          const label = await modal(h('div', {}, h('p', {}, `Link ${nodes.find(n => n.id === sel)?.label} ↔ ${nodes.find(n => n.id === id)?.label}`), h('input', { id: 'linkLabel', type: 'text', placeholder: 'Label (optional): e.g. "owns", "found at", "contradicts"' })), { title: 'New link', buttons: [{ label: 'Link', value: true, primary: true }, { label: 'Cancel', value: false }] });
          if (label) s.board.links.push({ from: sel, to: id, label: document.getElementById('linkLabel')?.value || '' });
        }
        app.selected.boardNode = null; app.autosave(); app.wm.refresh('board');
      };
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const wrap = h('div', { class: 'board' }, svg, h('div', { class: 'cols' }, cols));
      body.append(h('p', { class: 'muted small' }, 'Click one card, then another, to link them (click a linked pair again to unlink). Links are yours; the GM does not see them.'), wrap,
        s.board.links.length ? h('ul', { class: 'small' }, s.board.links.map(l => h('li', {}, `${nodes.find(n => n.id === l.from)?.label || l.from} — ${l.label || 'linked'} — ${nodes.find(n => n.id === l.to)?.label || l.to}`))) : null);
      requestAnimationFrame(() => {
        const r0 = wrap.getBoundingClientRect();
        svg.setAttribute('viewBox', `0 0 ${r0.width} ${r0.height}`);
        for (const l of s.board.links) {
          const a = els.get(l.from), b = els.get(l.to); if (!a || !b) continue;
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', ra.left + ra.width / 2 - r0.left); line.setAttribute('y1', ra.top + ra.height / 2 - r0.top);
          line.setAttribute('x2', rb.left + rb.width / 2 - r0.left); line.setAttribute('y2', rb.top + rb.height / 2 - r0.top);
          line.setAttribute('stroke', 'currentColor'); line.setAttribute('stroke-width', '1.5'); line.setAttribute('opacity', '0.6');
          svg.append(line);
        }
      });
    }
  });

  // ------------------------------------------------------------ CLOSE CASE
  reg({
    id: 'close', title: 'Close Case', icon: '⚑', size: { w: 640, h: 580 }, x: 160, y: 30,
    render(body) {
      const s = S();
      if (s.closed) { body.append(h('p', {}, 'This case is closed.'), h('button', { class: 'btn small', type: 'button', onClick: () => app.showDebrief(s.grade) }, 'View debrief')); return; }
      const culprit = h('select', { 'aria-label': 'Culprit' }, s.discovered.suspects.map(id => h('option', { value: id }, getSuspect(s, id).name)));
      const motive = h('textarea', { rows: '2', placeholder: 'Why did they do it?' });
      const means = h('textarea', { rows: '2', placeholder: 'How was it done? Weapon, method, access.' });
      const opp = h('textarea', { rows: '2', placeholder: 'When and how did they have the chance? Address their alibi.' });
      const charges = h('input', { type: 'text', placeholder: 'e.g. 18 U.S.C. § 1111 murder; § 1512 witness tampering' });
      const narrative = h('textarea', { rows: '4', placeholder: 'Your theory of the case in a paragraph.' });
      const evBoxes = s.discovered.evidence.map(id => h('label', { class: 'check small' }, h('input', { type: 'checkbox', value: id }), `${id.toUpperCase()} ${getEvidence(s, id).name}${s.evidence[id].excluded ? ' (inadmissible)' : ''}`));
      body.append(h('p', { class: 'banner' }, 'CLOSING REPORT · FD-CR'),
        h('p', { class: 'muted small' }, 'Name the responsible party, state motive, means and opportunity, select the evidence that proves each, and list charges. The AUSA grades what you actually collected, not what you believe.'),
        h('form', { class: 'report-form', onSubmit: e => {
          e.preventDefault();
          const evidenceIds = evBoxes.map(b => b.querySelector('input')).filter(i => i.checked).map(i => i.value);
          if (!motive.value.trim() || !means.value.trim() || !opp.value.trim()) { toast('Motive, means and opportunity are required.', 'warn'); return; }
          if (!evidenceIds.length) { toast('Select the key evidence.', 'warn'); return; }
          app.closeCase({ culpritId: culprit.value, motive: motive.value.trim(), means: means.value.trim(), opportunity: opp.value.trim(), charges: charges.value.trim(), narrative: narrative.value.trim(), evidenceIds });
        } },
          h('label', {}, 'Responsible party', culprit), h('label', {}, 'Motive', motive), h('label', {}, 'Means', means), h('label', {}, 'Opportunity', opp),
          h('label', {}, 'Charges', charges), h('label', {}, 'Theory of the case', narrative),
          h('h3', {}, 'Key evidence'), ...evBoxes,
          h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Arrest and close case'))));
    }
  });

  // ------------------------------------------------------------- SETTINGS
  reg({
    id: 'settings', title: 'Settings', icon: '⚙', size: { w: 560, h: 520 }, x: 300, y: 60,
    render(body) {
      const st = app.settings; const s = S();
      const opt = (label, el) => h('label', {}, label, el);
      const sel = (val, opts, on) => h('select', { onChange: e => { on(e.target.value); app.applySettings(); app.wm.refresh('settings'); } }, opts.map(([v, l]) => h('option', { value: v, selected: String(val) === v }, l)));
      const chk = (val, on) => h('input', { type: 'checkbox', checked: val, onChange: e => { on(e.target.checked); app.applySettings(); } });
      body.append(h('h3', {}, 'Display'),
        opt('Theme', sel(st.theme || 'green', [['green', 'Phosphor green'], ['amber', 'Amber'], ['blue', 'Cold blue']], v => { st.theme = v; })),
        opt('Typewriter speed', sel(st.typeSpeed || 'normal', [['off', 'Instant'], ['fast', 'Fast'], ['normal', 'Normal'], ['slow', 'Slow']], v => { st.typeSpeed = v; })),
        h('label', { class: 'check' }, chk(!!st.reduceMotion, v => { st.reduceMotion = v; }), 'Reduce motion (no scanlines, no blinking, instant text)'),
        h('label', { class: 'check' }, chk(st.scanlines !== false, v => { st.scanlines = v; }), 'Scanlines'),
        h('label', { class: 'check' }, chk(!!st.highContrast, v => { st.highContrast = v; }), 'High contrast text'),
        h('h3', {}, 'Save slots'),
        h('ul', { class: 'slot-list' }, store.listSlots().map(sl => h('li', {},
          h('span', { class: 'slot-info' }, h('b', {}, sl.slot === 0 ? 'Autosave' : `Slot ${sl.slot}`), sl.empty ? 'empty' : `${sl.caseNumber} · ${formatDuration(sl.elapsed || 0)} · ${new Date(sl.savedAt).toLocaleString()}`),
          h('span', { class: 'row', style: 'margin:0' },
            sl.slot === 0 ? null : h('button', { class: 'btn small', type: 'button', onClick: async () => { if (sl.empty || await modal(`Overwrite slot ${sl.slot}?`, { buttons: [{ label: 'Overwrite', value: true, danger: true }, { label: 'Cancel', value: false }] })) { store.saveSlot(sl.slot, s); app.slot = sl.slot; toast(`Saved to slot ${sl.slot}.`); app.wm.refresh('settings'); } } }, 'Save here'))))),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', type: 'button', onClick: () => store.exportState(s) }, 'Export .json'),
          h('label', { class: 'btn small file-btn' }, 'Import .json', h('input', { type: 'file', accept: '.json,application/json', hidden: true, onChange: async e => { const f = e.target.files[0]; if (!f) return; try { app.loadState(await store.importStateFromFile(f), 0); toast('Imported.'); } catch (err) { toast(err.message, 'danger'); } } })),
          h('button', { class: 'btn small ghost', type: 'button', onClick: () => { app.autosave(); app.renderSlots(); app.showScreen('newcase'); } }, 'Back to assignment desk')),
        h('h3', {}, 'Game Master'),
        h('p', { class: 'small muted' }, `${app.provider.name} · ${app.apiOpts.model}. Change on the login screen (Back to assignment desk → Change agent / key). Turns so far: ${s.turnCount}.`),
        h('details', {}, h('summary', { class: 'muted small' }, 'Last raw GM reply (debug)'), h('pre', { class: 'small', style: 'white-space:pre-wrap' }, s.history[s.history.length - 1]?.content || '')));
    }
  });

  // ----------------------------------------------------------------- HELP
  reg({
    id: 'help', title: 'Help', icon: '?', size: { w: 600, h: 520 }, x: 320, y: 40,
    render(body) {
      body.append(h('h3', {}, 'How to work a case'),
        h('ol', { class: 'small' },
          h('li', {}, 'Read the Case File: briefing, initial report, statements.'),
          h('li', {}, 'Visit the scene. Search specific places. Canvass.'),
          h('li', {}, 'Examine evidence closely; send items to the lab early, results take hours.'),
          h('li', {}, 'Interview everyone. Build rapport, then press on specifics. Present evidence to confront contradictions.'),
          h('li', {}, 'Pull records. Subpoena phone and financial records with real justification.'),
          h('li', {}, 'Apply for warrants before searching private property.'),
          h('li', {}, 'Keep the notebook and board current. Watch the clock.'),
          h('li', {}, 'Close the case with evidence that proves motive, means and opportunity.')),
        h('h3', {}, 'Command bar'),
        h('table', { class: 'small' }, h('tbody', {}, [
          ['visit <location>', 'travel to a known location'], ['search <area>', 'search a specific spot at your current location'], ['canvass', 'knock on doors near your current location'],
          ['examine <evidence>', 'close look at an item'], ['compare <e1> <e2>', 'compare two items'], ['lab <evidence> <discipline>', 'submit for analysis'],
          ['ask <person> <question>', 'interview'], ['present <evidence> to <person>', 'confront with an item'], ['record <person> criminal|vehicle', 'pull a record'],
          ['dispatch <message>', 'talk to your supervisor'], ['hint', 'ask for direction (costs score)'], ['note <text>', 'add a note'],
          ['warrant', 'open the legal panel'], ['close', 'open the closing report'], ['status', 'time and progress'], ['open <panel>', 'open a panel'], ['<anything else>', 'free action, narrated by the GM']
        ].map(([c, d]) => h('tr', {}, h('td', {}, h('code', {}, c)), h('td', {}, d))))),
        h('h3', {}, 'Keys'),
        h('p', { class: 'small' }, h('kbd', {}, '/'), ' focus command bar · ', h('kbd', {}, 'Alt+1..9'), ' open panels · ', h('kbd', {}, 'Esc'), ' close focused panel · click streaming text to skip the typewriter.'),
        h('p', { class: 'small muted' }, 'Everything is fictional. Names, places and companies are invented. The GM is an AI model using your API key; the key never leaves your browser except to that provider.'));
    }
  });
}
