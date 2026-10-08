// localStorage persistence: settings, API config, and several case slots.

const KEY_SETTINGS = 'fbisim.settings';
const KEY_API = 'fbisim.api';
const KEY_SLOT = n => `fbisim.slot.${n}`;
export const SLOT_COUNT = 5;

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export const loadSettings = () => read(KEY_SETTINGS, { reduceMotion: false, typeSpeed: 'normal', theme: 'green' });
export const saveSettings = s => write(KEY_SETTINGS, s);

export const loadApiConfig = () => read(KEY_API, { providerId: 'anthropic', apiKey: '', model: '', baseUrl: '', remember: false });
export const saveApiConfig = c => write(KEY_API, c);
export const forgetApiKey = () => { const c = loadApiConfig(); c.apiKey = ''; c.remember = false; write(KEY_API, c); };

export function listSlots() {
  const out = [];
  for (let i = 1; i <= SLOT_COUNT; i++) {
    const s = read(KEY_SLOT(i), null);
    out.push(s ? { slot: i, savedAt: s.savedAt, title: s.state?.truth?.title, caseNumber: s.state?.truth?.caseNumber, agent: s.state?.agent?.name, elapsed: s.state?.clock?.elapsedMinutes, closed: s.state?.closed } : { slot: i, empty: true });
  }
  return out;
}
export function saveSlot(n, state) { return write(KEY_SLOT(n), { savedAt: new Date().toISOString(), state }); }
export function loadSlot(n) { return read(KEY_SLOT(n), null)?.state || null; }
export function deleteSlot(n) { try { localStorage.removeItem(KEY_SLOT(n)); } catch { /* ignore */ } }

export function exportState(state) {
  const blob = new Blob([JSON.stringify({ app: 'fbi-sim', version: 1, savedAt: new Date().toISOString(), state }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(state.truth?.caseNumber || 'case').replace(/[^\w-]+/g, '_')}.fbisim.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function importStateFromFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read file'));
    r.onload = () => {
      try {
        const parsed = JSON.parse(r.result);
        const state = parsed?.state || parsed;
        if (!state?.truth?.suspects || !state?.clock) throw new Error('Not an FBI-SIM save file');
        resolve(state);
      } catch (e) { reject(e); }
    };
    r.readAsText(file);
  });
}
