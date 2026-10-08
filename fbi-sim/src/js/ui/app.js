// Main controller: screens, API config, actions, command bar, save/load.

import { $, $$, h, clear, toast, modal } from './dom.js';
import { Typewriter } from './typewriter.js';
import { WindowManager } from './windows.js';
import { runBoot } from './boot.js';
import { registerPanels, DOCK_ORDER } from './panels.js';
import { PROVIDERS, getProvider, complete } from '../providers/index.js';
import { generateCase } from '../engine/caseGenerator.js';
import { runTurn } from '../engine/gm.js';
import { gradeCase } from '../engine/grader.js';
import { newGameState, requestLab, pullRecord, processDue, remainingMinutes, getSuspect, getWitness, getEvidence, getLocation, getPerson, addLog, addFact, labelLegal } from '../engine/state.js';
import { formatClock, formatDuration } from '../engine/clock.js';
import { LAB_DISCIPLINES } from '../engine/schema.js';
import * as store from '../engine/storage.js';

const SPEED = { off: 0, fast: 4, normal: 12, slow: 28 };

export class App {
  constructor() {
    this.state = null;
    this.settings = store.loadSettings();
    this.api = store.loadApiConfig();
    this.busy = false;
    this.abort = null;
    this.slot = 0;
    this.wm = null;
    this.selected = { evidence: null, person: null, location: null, compare: null, boardNode: null };
    this.interview = { personId: null, custody: false };
  }

  // ---------------------------------------------------------------- startup
  async init() {
    this.applySettings();
    this.setupLogin();
    this.setupNewCase();
    this.setupDesktop();
    await runBoot($('#bootLog'), { reduceMotion: this.settings.reduceMotion });
    this.showScreen('login');
    $('#agentName').focus();
  }

  showScreen(name) {
    for (const s of $$('.screen')) s.classList.add('hidden');
    $(`#screen-${name}`).classList.remove('hidden');
  }

  applySettings() {
    const s = this.settings;
    document.body.classList.toggle('reduce-motion', !!s.reduceMotion);
    document.body.classList.toggle('no-scanlines', s.scanlines === false);
    document.body.dataset.theme = s.theme || 'green';
    document.body.dataset.contrast = s.highContrast ? 'high' : 'normal';
    store.saveSettings(s);
  }

  get provider() { return getProvider(this.api.providerId); }
  get apiOpts() {
    return { provider: this.provider, apiKey: this.api.apiKey, model: this.api.model || this.provider.defaultModel, baseUrl: this.api.baseUrl || undefined };
  }

  // ------------------------------------------------------------------ login
  setupLogin() {
    const sel = $('#providerSelect');
    for (const p of PROVIDERS) sel.append(h('option', { value: p.id }, p.name));
    sel.value = this.api.providerId || 'anthropic';
    $('#apiKey').value = this.api.apiKey || '';
    $('#modelInput').value = this.api.model || '';
    $('#baseUrl').value = this.api.baseUrl || '';
    $('#rememberKey').checked = !!this.api.remember;
    $('#badgeNumber').value = this.api.badge || this.makeBadge();
    $('#agentName').value = this.api.agentName || '';
    const syncProvider = () => {
      const p = getProvider(sel.value);
      $('#modelInput').placeholder = p.defaultModel || 'model id';
      const dl = clear($('#modelList'));
      for (const m of p.models) dl.append(h('option', { value: m }));
      $('#baseUrlRow').classList.toggle('hidden', !p.allowCustomBaseUrl);
      $('#baseUrl').placeholder = p.defaultBaseUrl;
      $('#providerNotes').innerHTML = `${p.notes ? p.notes + ' ' : ''}${p.keyUrl ? `Get a key: <a href="${p.keyUrl}" target="_blank" rel="noopener">${p.keyUrl}</a>` : ''}`;
    };
    sel.addEventListener('change', syncProvider);
    syncProvider();
    const readForm = () => {
      this.api = {
        providerId: sel.value, apiKey: $('#apiKey').value.trim(), model: $('#modelInput').value.trim(), baseUrl: $('#baseUrl').value.trim(),
        remember: $('#rememberKey').checked, badge: $('#badgeNumber').value, agentName: $('#agentName').value.trim()
      };
      store.saveApiConfig({ ...this.api, apiKey: this.api.remember ? this.api.apiKey : '' });
    };
    $('#testConn').addEventListener('click', async () => {
      readForm();
      const st = $('#connStatus');
      st.textContent = 'Testing...';
      try {
        const text = await complete(this.provider, { ...this.apiOpts, json: false, maxTokens: 20, temperature: 0, messages: [{ role: 'user', content: 'Reply with the single word READY.' }] });
        st.textContent = text.trim() ? `Link OK (${this.apiOpts.model}): "${text.trim().slice(0, 40)}"` : 'Link OK (empty reply)';
        st.className = 'accent small';
      } catch (err) { st.textContent = `Failed: ${err.message}`; st.className = 'danger small'; }
    });
    $('#forgetKey').addEventListener('click', () => { store.forgetApiKey(); $('#apiKey').value = ''; $('#rememberKey').checked = false; toast('Stored key removed.'); });
    $('#loginForm').addEventListener('submit', e => {
      e.preventDefault();
      readForm();
      if (!this.api.apiKey && this.provider.id !== 'ollama') { toast('Enter an API key for the Game Master.', 'warn'); $('#apiKey').focus(); return; }
      this.agent = { name: this.api.agentName || 'Agent', badge: this.api.badge };
      $('#newcaseAgent').textContent = `SA ${this.agent.name} · Badge ${this.agent.badge} · GM: ${this.provider.name}`;
      this.renderSlots();
      this.showScreen('newcase');
    });
  }

  makeBadge() { return `${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(100 + Math.random() * 900)}`; }

  // --------------------------------------------------------------- new case
  setupNewCase() {
    $('#newCaseForm').addEventListener('submit', async e => {
      e.preventDefault();
      let crimeType = $('#crimeType').value;
      if (crimeType === 'Random') { const opts = $$('#crimeType option').map(o => o.value).filter(v => v !== 'Random'); crimeType = opts[Math.floor(Math.random() * opts.length)]; }
      const settings = { crimeType, difficulty: $('#difficulty').value, length: $('#caseLength').value };
      await this.startNewCase(settings);
    });
    $('#genCancel').addEventListener('click', () => this.abort?.abort());
    $('#backToLogin').addEventListener('click', () => this.showScreen('login'));
    $('#importFile').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try { const st = await store.importStateFromFile(f); this.loadState(st, 0); toast('Case imported.'); } catch (err) { toast(`Import failed: ${err.message}`, 'danger'); }
      e.target.value = '';
    });
  }

  renderSlots() {
    const ul = clear($('#slotList'));
    for (const s of store.listSlots()) {
      const label = s.slot === 0 ? 'Autosave' : `Slot ${s.slot}`;
      if (s.empty) { ul.append(h('li', {}, h('span', { class: 'slot-info muted' }, h('b', {}, label), 'empty'))); continue; }
      ul.append(h('li', {},
        h('span', { class: 'slot-info' }, h('b', {}, `${label}: ${s.caseNumber || ''} ${s.title || ''}`), `SA ${s.agent} · ${formatDuration(s.elapsed || 0)} elapsed${s.closed ? ' · CLOSED' : ''} · saved ${new Date(s.savedAt).toLocaleString()}`),
        h('span', { class: 'row' },
          h('button', { class: 'btn small', type: 'button', onClick: () => { this.loadState(store.loadSlot(s.slot), s.slot); } }, 'Resume'),
          h('button', { class: 'btn small ghost danger', type: 'button', onClick: async () => { if (await modal(`Delete ${label}?`, { buttons: [{ label: 'Delete', value: true, danger: true }, { label: 'Cancel', value: false }] })) { store.deleteSlot(s.slot); this.renderSlots(); } } }, '✕'))));
    }
  }

  async startNewCase(settings) {
    const st = $('#genStatus');
    const btn = $('#newCaseForm button[type=submit]');
    btn.disabled = true; $('#genCancel').classList.remove('hidden');
    this.abort = new AbortController();
    try {
      const truth = await generateCase({ ...this.apiOpts, settings, agentName: this.agent.name, signal: this.abort.signal, onProgress: msg => { st.textContent = msg; } });
      this.state = newGameState({ agent: this.agent, truth, settings });
      this.slot = 0;
      addLog(this.state, 'system', `Case ${truth.caseNumber} opened. ${truth.title}.`);
      addLog(this.state, 'dispatch', truth.supervisorBriefing, 'dispatch');
      this.autosave();
      st.textContent = '';
      this.enterDesktop(true);
    } catch (err) {
      st.textContent = this.abort.signal.aborted ? 'Cancelled.' : `Could not open a case: ${err.message}`;
      st.className = 'danger small';
    } finally { btn.disabled = false; $('#genCancel').classList.add('hidden'); this.abort = null; }
  }

  loadState(state, slot) {
    this.state = state;
    this.slot = slot || 0;
    this.agent = state.agent;
    if (state.closed && state.grade) { this.showDebrief(state.grade); return; }
    this.enterDesktop(false);
  }

  autosave() {
    if (!this.state) return;
    store.saveSlot(0, this.state);
    if (this.slot) store.saveSlot(this.slot, this.state);
  }

  // ---------------------------------------------------------------- desktop
  setupDesktop() {
    this.wm = new WindowManager($('#windowArea'), $('#dock'));
    registerPanels(this);
    this.wm.buildDock(DOCK_ORDER);
    $('#cmdBar').addEventListener('submit', e => { e.preventDefault(); const v = $('#cmdInput').value.trim(); if (!v) return; $('#cmdInput').value = ''; this.handleCommand(v); });
    document.addEventListener('keydown', e => {
      if (e.target.matches('input, textarea, select') && e.key !== 'Escape') return;
      if (e.key === '/' ) { e.preventDefault(); $('#cmdInput').focus(); }
      if (e.altKey && /^[1-9]$/.test(e.key)) { const id = DOCK_ORDER.filter(x => x !== '---')[Number(e.key) - 1]; if (id) { e.preventDefault(); this.wm.show(id); } }
    });
    window.addEventListener('beforeunload', () => this.autosave());
  }

  enterDesktop(fresh) {
    this.wm.closeAll();
    this.showScreen('desktop');
    this.updateTopbar();
    this.wm.show('fieldlog');
    if (fresh) { this.wm.show('casefile'); this.wm.focus('fieldlog'); }
    const due = processDue(this.state);
    for (const n of due) toast(n, 'info');
    this.wm.refreshAll();
    $('#cmdInput').focus();
  }

  updateTopbar() {
    const s = this.state; if (!s) return;
    $('#topCase').textContent = `${s.truth.caseNumber} · ${s.truth.title}`;
    $('#topClock').textContent = formatClock(s.clock.startISO, s.clock.elapsedMinutes);
    const rem = remainingMinutes(s);
    const dl = $('#topDeadline');
    dl.textContent = rem >= 0 ? `DEADLINE IN ${formatDuration(rem)}` : `OVER DEADLINE BY ${formatDuration(-rem)}`;
    dl.className = `mono deadline ${rem < 0 ? 'danger' : rem < 12 * 60 ? 'warn' : ''}`;
    $('#topAgent').textContent = `SA ${s.agent.name} · ${s.agent.badge}`;
  }

  setStatus(text, busy = false) {
    const el = $('#topStatus');
    el.textContent = text || '';
    el.classList.toggle('busy', busy);
  }

  // ---------------------------------------------------------------- actions
  /** Run a GM turn for an action. Returns the turn result or null. */
  async act(action) {
    if (!this.state || this.state.closed) return null;
    if (this.busy) { toast('Wait for the current transmission to finish.', 'warn'); return null; }
    this.busy = true;
    this.abort = new AbortController();
    const target = this.liveTarget(action);
    const agentLine = this.agentLineFor(action);
    const liveWrap = h('div', { class: 'entry live' }, h('div', { class: 'who' }, 'GM'), h('div', { class: 'stream' }));
    if (target) {
      if (agentLine) target.append(h('div', { class: 'entry agent' }, h('div', { class: 'who' }, `SA ${this.state.agent.name}`), h('div', { class: 'narr' }, agentLine)));
      target.append(liveWrap);
      liveWrap.scrollIntoView({ block: 'end' });
    }
    const tw = new Typewriter(liveWrap.querySelector('.stream'), { speedMs: SPEED[this.settings.typeSpeed ?? 'normal'] ?? 12, reduceMotion: this.settings.reduceMotion });
    liveWrap.addEventListener('click', () => tw.skip());
    this.setStatus('Transmitting...', true);
    let result = null;
    try {
      result = await runTurn({ state: this.state, action, ...this.apiOpts, signal: this.abort.signal,
        onNarrative: text => tw.update(text), onStatus: s => this.setStatus(s, true) });
      liveWrap.querySelector('.who').textContent = this.speakerLabel(result.speaker);
      liveWrap.className = `entry ${result.speaker.split(':')[0]}`;
      tw.finish(result.narrative);
      await this.waitTypewriter(tw);
      for (const n of result.notices) toast(n, n.startsWith('PROCEDURE') ? 'danger' : n.includes('INADMISSIBLE') ? 'warn' : '');
      if (result.fallback) toast('GM reply was not well-formed; shown as plain text, no state changes applied.', 'warn');
      this.afterTurn(action, result);
    } catch (err) {
      tw.finish('');
      liveWrap.className = 'entry procedure';
      liveWrap.querySelector('.stream').textContent = this.abort.signal.aborted ? 'Transmission cancelled.' : `LINK ERROR: ${err.message}`;
      toast(err.message, 'danger', 8000);
    } finally {
      this.busy = false; this.abort = null; this.setStatus('');
      this.updateTopbar();
      this.autosave();
      this.wm.refreshAll();
      this.checkDeadline();
    }
    return result;
  }

  waitTypewriter(tw) {
    return new Promise(res => { const poll = () => (tw.shown >= tw.target.length ? res() : setTimeout(poll, 50)); poll(); });
  }

  afterTurn(action, result) {
    const s = this.state;
    if (action.type === 'examine' || action.type === 'compare') {
      const es = s.evidence[action.evidenceId];
      es.notes = es.notes || [];
      es.notes.push({ at: s.clock.elapsedMinutes, text: result.narrative, kind: action.type });
      if (action.type === 'compare') { const e2 = s.evidence[action.evidenceId2]; e2.notes = e2.notes || []; e2.notes.push({ at: s.clock.elapsedMinutes, text: result.narrative, kind: 'compare' }); }
    }
    if (action.type === 'visit' || action.type === 'search' || action.type === 'canvass') {
      const ls = (s.locationNotes = s.locationNotes || {});
      (ls[action.locationId] = ls[action.locationId] || []).push({ at: s.clock.elapsedMinutes, text: result.narrative, kind: action.type, area: action.area });
    }
    if (action.type === 'legal') {
      const app = s.legal.find(l => l.id === action.legalId);
      if (app && app.status === 'pending') { app.status = 'denied'; app.reason = 'No decision was recorded; resubmit.'; }
    }
    // Badges for windows that gained content and are not focused.
    for (const n of result.notices) {
      if (n.startsWith('Evidence')) this.bump('evidence');
      if (n.startsWith('Location')) this.bump('locations');
      if (n.startsWith('Person') || n.startsWith('Witness')) this.bump('persons');
      if (n.startsWith('Fact')) this.bump('notebook');
      if (n.startsWith('LAB')) this.bump('lab');
      if (n.startsWith('RECORDS')) this.bump('records');
    }
  }

  bump(id) {
    const w = this.wm.open.get(id);
    if (w && w.el.classList.contains('focused')) return;
    this.badges = this.badges || {};
    this.badges[id] = (this.badges[id] || 0) + 1;
    this.wm.setBadge(id, this.badges[id]);
  }

  checkDeadline() {
    const rem = remainingMinutes(this.state);
    if (rem < 0 && !this.state.deadlineWarned) {
      this.state.deadlineWarned = true;
      toast('You are past the case deadline. The supervisor expects a closing report. Every extra hour costs score.', 'danger', 9000);
    }
  }

  liveTarget(action) {
    const prefer = (action.type === 'interview' || action.type === 'present') ? 'interview' : (action.type === 'dispatch' || action.type === 'hint') ? 'dispatch' : 'fieldlog';
    const w = this.wm.open.get(prefer) || this.wm.open.get('fieldlog');
    if (!w) return null;
    this.wm.focus(this.wm.open.has(prefer) ? prefer : 'fieldlog');
    return w.body.querySelector('.log-stream') || w.body;
  }

  agentLineFor(a) {
    const s = this.state;
    switch (a.type) {
      case 'visit': return `Travels to ${getLocation(s, a.locationId).name}. ${a.text || ''}`.trim();
      case 'search': return `Searches ${a.area} at ${getLocation(s, a.locationId).name}. ${a.text || ''}`.trim();
      case 'canvass': return `Canvasses around ${getLocation(s, a.locationId).name}.`;
      case 'examine': return `Examines ${getEvidence(s, a.evidenceId).name}. ${a.text || ''}`.trim();
      case 'compare': return `Compares ${getEvidence(s, a.evidenceId).name} with ${getEvidence(s, a.evidenceId2).name}.`;
      case 'interview': return `To ${getPerson(s, a.personId).name}: "${a.text}"`;
      case 'present': return `Presents ${getEvidence(s, a.evidenceId).name} to ${getPerson(s, a.personId).name}. ${a.text ? `"${a.text}"` : ''}`.trim();
      case 'legal': { const app = s.legal.find(l => l.id === a.legalId); return `Files ${labelLegal(app.kind)} application.`; }
      case 'arrest': return `Moves to arrest ${getSuspect(s, a.personId).name}.`;
      default: return a.text || '';
    }
  }

  speakerLabel(speaker) {
    const s = this.state;
    if (!speaker) return 'GM';
    if (speaker === 'dispatch') return 'DISPATCH';
    if (speaker === 'judge') return 'MAGISTRATE / AUSA';
    const [kind, id] = speaker.split(':');
    if ((kind === 'suspect' || kind === 'witness') && id) return (getPerson(s, id)?.name || id).toUpperCase();
    return 'FIELD NARRATIVE';
  }

  // Convenience wrappers used by panels and commands.
  dispatch(text) { return this.act({ type: 'dispatch', text }); }
  hint(text) { return this.act({ type: 'hint', text }); }
  visit(locationId, text) { return this.act({ type: 'visit', locationId, text }); }
  search(locationId, area, text) { return this.act({ type: 'search', locationId, area, text }); }
  canvass(locationId, text) { return this.act({ type: 'canvass', locationId, text }); }
  examine(evidenceId, text) { return this.act({ type: 'examine', evidenceId, text }); }
  compare(evidenceId, evidenceId2) { return this.act({ type: 'compare', evidenceId, evidenceId2 }); }
  ask(personId, text, custody = this.interview.custody) {
    if (!text?.trim()) { toast('Type a question first.', 'warn'); return null; }
    const ss = this.state.suspects[personId];
    if (ss?.lawyeredUp) toast(`${getSuspect(this.state, personId).name} has counsel. Expect no answers.`, 'warn');
    return this.act({ type: 'interview', personId, text: text.trim(), custody });
  }
  present(personId, evidenceId, text) { return this.act({ type: 'present', personId, evidenceId, text }); }

  sendToLab(evidenceId, discipline) {
    try {
      const ready = requestLab(this.state, evidenceId, discipline);
      toast(`${getEvidence(this.state, evidenceId).name} submitted for ${discipline}. ETA ${formatClock(this.state.clock.startISO, ready)}.`, 'info');
      this.state.clock.elapsedMinutes += 5;
      this.updateTopbar(); this.autosave(); this.wm.refreshAll();
    } catch (err) { toast(err.message, 'warn'); }
  }

  pullRecord(suspectId, kind) {
    try {
      pullRecord(this.state, suspectId, kind);
      this.state.clock.elapsedMinutes += 20;
      toast(`${kind} record pulled for ${getSuspect(this.state, suspectId).name}.`, 'info');
      this.updateTopbar(); this.autosave(); this.wm.refreshAll();
    } catch (err) { toast(err.message, 'warn'); }
  }

  fileLegal(kind, target, justification) {
    if (!justification || justification.trim().length < 40) { toast('Write a real justification (at least a few sentences).', 'warn'); return null; }
    const id = `L${this.state.legal.length + 1}`;
    this.state.legal.push({ id, kind, target, justification: justification.trim(), status: 'pending', filedAt: this.state.clock.elapsedMinutes });
    return this.act({ type: 'legal', legalId: id });
  }

  // ----------------------------------------------------------- command bar
  handleCommand(line) {
    const s = this.state;
    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(' ');
    const c = cmd.toLowerCase();
    const findLoc = q => this.fuzzy(s.truth.locations.filter(l => s.discovered.locations.includes(l.id)), q);
    const findEv = q => this.fuzzy(s.truth.evidence.filter(e => s.discovered.evidence.includes(e.id)), q);
    const findPerson = q => this.fuzzy([...s.truth.suspects, ...s.truth.witnesses.filter(w => s.discovered.witnesses.includes(w.id))], q);
    const bad = msg => toast(msg, 'warn');
    switch (c) {
      case 'help': case '?': this.wm.show('help'); return;
      case 'open': case 'show': { const id = DOCK_ORDER.find(x => x !== '---' && (x === arg.toLowerCase() || this.wm.defs.get(x)?.title.toLowerCase().startsWith(arg.toLowerCase()))); return id ? this.wm.show(id) : bad(`No panel "${arg}".`); }
      case 'dispatch': case 'radio': case 'd': return arg ? this.dispatch(arg) : this.wm.show('dispatch');
      case 'hint': return this.hint(arg);
      case 'visit': case 'go': { const l = findLoc(arg); return l ? this.visit(l.id) : bad(`Unknown location "${arg}". Known: ${s.discovered.locations.map(id => `${id} ${getLocation(s, id).name}`).join(', ')}`); }
      case 'search': { if (!s.currentLocation) return bad('Visit a location first.'); return this.search(s.currentLocation, arg || 'general area'); }
      case 'canvass': { const l = arg ? findLoc(arg) : getLocation(s, s.currentLocation); return l ? this.canvass(l.id) : bad('Visit a location first.'); }
      case 'examine': case 'exam': case 'look': { const e = findEv(arg); return e ? (this.selected.evidence = e.id, this.examine(e.id)) : bad(`Unknown evidence "${arg}". Try: ${s.discovered.evidence.join(', ')}`); }
      case 'compare': { const [a, b] = arg.split(/\s+(?:with|and|,)\s+|\s+/); const ea = findEv(a), eb = findEv(b); return ea && eb ? this.compare(ea.id, eb.id) : bad('compare <evidence> <evidence>'); }
      case 'lab': { const m = arg.match(/^(\S+)\s+(\S+)$/); if (!m) return bad(`lab <evidence> <${LAB_DISCIPLINES.join('|')}>`); const e = findEv(m[1]); const d = LAB_DISCIPLINES.find(x => x.startsWith(m[2].toLowerCase())); return e && d ? this.sendToLab(e.id, d) : bad('Unknown evidence or discipline.'); }
      case 'ask': case 'interview': case 'question': case 'q': {
        const m = arg.match(/^(\S+)\s+(.+)$/); if (!m) return bad('ask <person> <question>');
        const p = findPerson(m[1]); if (!p) return bad(`Unknown person "${m[1]}".`);
        this.interview.personId = p.id; this.wm.show('interview'); return this.ask(p.id, m[2]);
      }
      case 'present': case 'show-evidence': {
        const m = arg.match(/^(\S+)\s+(?:to\s+)?(\S+)\s*(.*)$/); if (!m) return bad('present <evidence> to <person> [words]');
        const e = findEv(m[1]), p = findPerson(m[2]); if (!e || !p) return bad('Unknown evidence or person.');
        this.interview.personId = p.id; this.wm.show('interview'); return this.present(p.id, e.id, m[3]);
      }
      case 'record': case 'records': { const m = arg.match(/^(\S+)\s+(criminal|vehicle)$/i); if (!m) return bad('record <person> criminal|vehicle'); const p = findPerson(m[1]); return p ? this.pullRecord(p.id, m[2].toLowerCase()) : bad('Unknown person.'); }
      case 'warrant': case 'subpoena': case 'legal': return this.wm.show('legal');
      case 'note': case 'n': { if (!arg) return this.wm.show('notebook'); s.notes = (s.notes ? s.notes + '\n' : '') + arg; this.autosave(); this.wm.refresh('notebook'); return toast('Note added.'); }
      case 'save': return this.wm.show('settings');
      case 'export': return store.exportState(s);
      case 'close': case 'arrest': return this.wm.show('close');
      case 'status': case 'time': return toast(`${formatClock(s.clock.startISO, s.clock.elapsedMinutes)} · ${formatDuration(remainingMinutes(s))} to deadline · ${s.discovered.evidence.length} items · ${s.facts.length} facts`, 'info', 7000);
      default: return this.act({ type: 'free', text: line });
    }
  }

  fuzzy(list, q) {
    if (!q) return null;
    const ql = q.toLowerCase();
    return list.find(x => x.id.toLowerCase() === ql) || list.find(x => x.name.toLowerCase().startsWith(ql)) || list.find(x => x.name.toLowerCase().includes(ql)) || list.find(x => x.name.toLowerCase().split(/\s+/).some(w => w.startsWith(ql)));
  }

  // ------------------------------------------------------------- close case
  async closeCase(report) {
    if (this.busy) return;
    const culprit = getSuspect(this.state, report.culpritId);
    const ok = await modal(`You are about to arrest ${culprit.name} and close ${this.state.truth.caseNumber}. This cannot be undone. If you are wrong, the real culprit walks.`, { title: 'Confirm arrest', buttons: [{ label: 'Make the arrest', value: true, primary: true }, { label: 'Not yet', value: false }] });
    if (!ok) return;
    this.busy = true; this.abort = new AbortController();
    this.setStatus('Filing closing report...', true);
    try {
      report.culpritName = culprit.name;
      report.evidence = report.evidenceIds.map(id => ({ id, name: getEvidence(this.state, id)?.name }));
      const grade = await gradeCase({ state: this.state, report, ...this.apiOpts, signal: this.abort.signal, onStatus: s => this.setStatus(s, true) });
      this.state.closed = true; this.state.report = report; this.state.grade = grade;
      addLog(this.state, 'system', `Case closed. Arrested ${culprit.name}. Rating: ${grade.rating} (${grade.score}).`);
      this.autosave();
      this.showDebrief(grade);
    } catch (err) { toast(`Closing failed: ${err.message}`, 'danger', 8000); }
    finally { this.busy = false; this.abort = null; this.setStatus(''); }
  }

  showDebrief(grade) {
    const s = this.state; const t = s.truth;
    const culprit = getSuspect(s, t.culprit.suspectId);
    const body = clear($('#debriefBody'));
    const scoreClass = grade.score >= 75 ? '' : grade.score >= 45 ? 'mid' : 'bad';
    const li = arr => h('ul', {}, (arr || []).map(x => h('li', {}, typeof x === 'string' ? x : JSON.stringify(x))));
    body.append(
      h('div', { class: 'card-head' }, h('span', { class: 'banner' }, 'CASE CLOSED · DEBRIEF · TRUTH UNSEALED'), h('span', { class: 'muted' }, `${t.caseNumber} · ${t.title}`)),
      h('div', { class: `score ${scoreClass}` }, `${grade.score} / 100`),
      h('h1', {}, grade.rating),
      h('p', { class: 'muted' }, `Accused: ${s.report?.culpritName}. Actual culprit: ${culprit?.name}. ${grade.culpritCorrect ? 'Correct.' : 'WRONG. The real culprit walked.'}`),
      h('h2', {}, 'Supervisor'), h('p', { class: 'narr' }, grade.verdict || ''),
      h('h2', {}, 'What actually happened'), h('p', { class: 'narr' }, grade.whatHappened || ''),
      h('div', { class: 'kv' },
        h('dt', {}, 'Culprit'), h('dd', {}, `${culprit?.name} (${culprit?.occupation})`),
        h('dt', {}, 'Motive'), h('dd', {}, t.culprit.motive), h('dt', {}, 'Means'), h('dd', {}, t.culprit.means), h('dt', {}, 'Opportunity'), h('dd', {}, t.culprit.opportunity),
        h('dt', {}, 'Charges'), h('dd', {}, (t.charges || []).join('; '))),
      h('h2', {}, 'Your report, element by element'),
      h('table', {}, h('tbody', {}, ['motive', 'means', 'opportunity'].map(k => h('tr', {}, h('th', {}, k), h('td', {}, grade.elements?.[k]?.backed ? h('span', { class: 'tag ok' }, 'backed') : h('span', { class: 'tag bad' }, 'not backed')), h('td', {}, grade.elements?.[k]?.note || ''))),
        h('tr', {}, h('th', {}, 'charges'), h('td', {}, grade.chargesAppropriate ? h('span', { class: 'tag ok' }, 'appropriate') : h('span', { class: 'tag warn' }, 'questioned')), h('td', {}, '')))),
      h('h2', {}, 'What you got right'), li(grade.gotRight),
      h('h2', {}, 'What you missed'), li(grade.missed),
      h('h2', {}, 'Red herrings'), li(grade.redHerrings),
      h('h2', {}, 'Procedure'), h('p', { class: 'narr' }, grade.procedure || ''),
      h('h2', {}, 'Outcome'), h('p', { class: 'narr' }, grade.outcome || ''),
      h('h2', {}, 'Statistics'),
      h('table', {}, h('tbody', {}, Object.entries({
        'Proving clues found': `${grade.stats?.provingFound?.length ?? 0} of ${grade.stats?.provingTotal ?? '?'}`,
        'Evidence collected': grade.stats?.collectedEvidence?.length ?? 0, 'Evidence excluded': grade.stats?.excludedEvidence?.length ?? 0,
        'Hints taken': grade.stats?.hints ?? 0, 'Procedure errors': grade.stats?.procedureErrors?.length ?? 0,
        'Time used': `${grade.stats?.hoursUsed ?? '?'}h of ${grade.stats?.deadlineHours ?? '?'}h`
      }).map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, String(v)))))),
      h('details', {}, h('summary', { class: 'muted' }, 'Full hidden timeline'), h('ul', { class: 'timeline' }, (t.timeline || []).map(x => h('li', {}, `${x.time}: ${x.event}`)))),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', onClick: () => { this.renderSlots(); this.showScreen('newcase'); } }, 'New assignment'),
        h('button', { class: 'btn ghost', type: 'button', onClick: () => store.exportState(s) }, 'Export case file'),
        h('button', { class: 'btn ghost', type: 'button', onClick: () => { this.showScreen('desktop'); } }, 'Review workstation (read-only)'))
    );
    this.showScreen('debrief');
  }
}
