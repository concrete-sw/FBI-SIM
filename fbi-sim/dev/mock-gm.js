// Offline mock Game Master. Speaks the OpenAI chat-completions protocol with
// SSE streaming so the game can be exercised end to end without an API key.
//
//   node fbi-sim/dev/mock-gm.js            # listens on http://localhost:8787/v1
// Works with the built index.html opened from disk and with the served src/.
//
// In the game, pick provider "Custom (OpenAI-compatible)", base URL
// http://localhost:8787/v1, any key. The mock serves the sample case and
// scripted replies; it is for development and UI testing, not for play.

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const sampleCase = readFileSync(path.join(here, 'sample-case.json'), 'utf8');
const PORT = Number(process.env.PORT || 8787);

function reply(userText) {
  if (userText.includes('designing the hidden ground truth')) return sampleCase;
  if (userText.includes('closing report. Grade it')) {
    return JSON.stringify({
      score: 82, rating: 'Case Closed', culpritCorrect: true, motiveCorrect: true,
      elements: { motive: { backed: true, note: 'Ledgers establish the fraud.' }, means: { backed: true, note: 'Revolver matched.' }, opportunity: { backed: false, note: 'Toll records were never obtained.' } },
      chargesAppropriate: true,
      verdict: 'Good work. The AUSA will take it. Next time get the toll records before you knock on the boat.',
      whatHappened: 'Marcus Vance killed Daniel Okafor to stop him handing the ledgers to CBP.',
      gotRight: ['Right man', 'Right motive'], missed: ['Toll gantry records'], redHerrings: ['Reyes was drunk at the bar all night.'],
      procedure: 'Clean.', outcome: 'Vance is arraigned Monday.'
    });
  }
  if (userText.includes('running summary')) return 'The agent worked the scene and interviewed Vance, who claimed to be at the Anchor Bar.';
  const m = userText.match(/\[ACTION: (\w+)([^\]]*)\]/);
  const type = m ? m[1] : 'FREE';
  const detail = m ? m[2] : '';
  const changes = {};
  let narrative = `(mock GM) You ${type.toLowerCase()}. The room is quiet.\n\nNothing you can use yet.`;
  let speaker = 'narrator';
  if (type === 'DISPATCH') { narrative = 'Copy that, Agent. Keep it by the book and get the lab moving.'; speaker = 'dispatch'; if (/hint is requested/.test(userText)) changes.hintGiven = true; }
  if (type === 'SEARCH' && /loc1/.test(detail) && /rear loading door/i.test(detail)) { narrative = 'Behind the warehouse bay, the rear loading door does not sit true in its frame. A folded piece of cardboard is wedged at the latch. [You photograph it in place before bagging it.]'; changes.evidenceFound = ['e3']; changes.factsLearned = ['The rear loading door had been wedged open from inside.']; }
  if (type === 'SEARCH' && /loc1/.test(detail) && /desk/i.test(detail)) { narrative = 'Under the blotter you find a paper desk calendar, the handwriting cramped and hurried.'; changes.evidenceFound = ['e4']; }
  if (type === 'VISIT') { narrative = 'You arrive. The air smells of brine and diesel. A sharp eye catches the rear door hanging slightly open.'; changes.locationsUnlocked = ['loc4']; }
  if (type === 'INTERVIEW') { narrative = '"Honestly, friend, I was at the Anchor until half past midnight. Ask Sal." [He spreads his hands.]'; speaker = 'suspect:s1'; changes.moodChanges = { s1: 'evasive' }; changes.rapportDelta = { s1: -1 }; }
  if (type === 'PRESENT') { narrative = '[He looks at it a long moment.] "Okay. I left earlier than I said. I didn\'t want Carol to know about the money."'; speaker = 'suspect:s1'; changes.alibiStatus = { s1: 'broken' }; }
  if (type === 'EXAMINE') { narrative = 'Deformed, but the rifling is clear: six lands and grooves, right twist. No jacket. The kind of round an old revolver throws.'; }
  if (type === 'LEGAL') { narrative = 'The magistrate reads your affidavit twice. "You have a broken alibi and a witness placing his car at the marina. That is probable cause. Granted, limited to the vessel and its lockers."'; speaker = 'judge'; changes.legalDecision = { granted: true, reason: 'Specific facts tie the target to the scene.' }; }
  return JSON.stringify({ narrative, speaker, extraTimeMinutes: 0, changes });
}

const server = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.writeHead(404, cors); return res.end('not found'); }
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    let msgs = [];
    try { msgs = JSON.parse(body).messages || []; } catch { /* ignore */ }
    const last = [...msgs].reverse().find(m => m.role === 'user')?.content || '';
    const text = reply(last);
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const chunks = text.match(/[\s\S]{1,64}/g) || [];
    let i = 0;
    const tick = () => {
      if (i < chunks.length) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i++] } }] })}\n\n`); setTimeout(tick, 3); }
      else { res.write('data: [DONE]\n\n'); res.end(); }
    };
    tick();
  });
});
server.listen(PORT, () => console.log(`mock GM listening on http://localhost:${PORT}/v1`));
