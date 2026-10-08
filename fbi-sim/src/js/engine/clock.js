// In-game clock. Actions cost minutes; the case has a deadline.

export const BASE_COST = {
  dispatch: 5, hint: 10, visit: 45, search: 30, canvass: 60, examine: 15, compare: 15,
  interview: 40, present: 10, legal: 90, records: 20, lab: 5, note: 0, free: 15, arrest: 60
};

export const DIFFICULTY_TIME_SCALE = { rookie: 0.8, agent: 1.0, veteran: 1.25 };

export const LAB_TURNAROUND_MIN = {
  fingerprints: 6 * 60, dna: 24 * 60, ballistics: 10 * 60, toxicology: 18 * 60,
  digital: 12 * 60, trace: 14 * 60, documents: 8 * 60
};

export const SUBPOENA_TURNAROUND_MIN = { phone: 8 * 60, financial: 12 * 60 };

export function formatClock(startISO, elapsedMinutes) {
  const d = new Date(startISO);
  d.setMinutes(d.getMinutes() + elapsedMinutes);
  const pad = n => String(n).padStart(2, '0');
  const day = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getDay()];
  return `${day} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDuration(minutes) {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  return `${h}h ${m % 60}m`;
}
