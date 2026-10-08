// Generates and validates the hidden case truth.

import { buildCaseGenerationPrompt } from '../prompts/caseGeneration.js';
import { validateCase, deepClean } from './schema.js';
import { extractJSON } from './json.js';
import { complete } from '../providers/index.js';

export async function generateCase({ provider, apiKey, model, baseUrl, settings, agentName, onProgress, maxAttempts = 3, signal }) {
  const prompt = buildCaseGenerationPrompt({ ...settings, agentName });
  let lastProblems = [];
  let lastText = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onProgress?.(`Generating case file (attempt ${attempt} of ${maxAttempts})...`, 0);
    const messages = [{ role: 'user', content: prompt }];
    if (attempt > 1 && lastProblems.length) {
      messages[0].content += `\n\nYOUR PREVIOUS ATTEMPT FAILED VALIDATION. Fix every problem below and output the complete corrected JSON:\n- ${lastProblems.join('\n- ')}`;
    }
    let chars = 0;
    try {
      lastText = await complete(provider, {
        apiKey, model, baseUrl, json: true, maxTokens: 16000, temperature: 0.9, signal,
        system: 'You are a meticulous crime-fiction case designer who outputs only valid JSON.',
        messages
      }, (chunk, text) => { chars = text.length; onProgress?.(`Generating case file (attempt ${attempt})... ${chars} chars`, chars); });
      const parsed = deepClean(extractJSON(lastText));
      lastProblems = validateCase(parsed);
      if (lastProblems.length === 0) {
        normalizeCase(parsed, settings);
        return parsed;
      }
      onProgress?.(`Validation failed: ${lastProblems.slice(0, 3).join('; ')}`, chars);
    } catch (err) {
      if (signal?.aborted) throw err;
      lastProblems = [`Output was not parseable JSON (${err.message}). Output the whole object as valid JSON.`];
      onProgress?.(`Attempt ${attempt} failed: ${err.message}`, chars);
    }
  }
  throw new Error(`Could not generate a valid case after ${maxAttempts} attempts. Last problems: ${lastProblems.join('; ')}`);
}

function normalizeCase(c, settings) {
  c.crimeType = c.crimeType || settings.crimeType;
  c.setting = c.setting || {};
  for (const s of c.suspects) {
    s.initialMood = s.initialMood || 'calm';
    s.criminalHistory = s.criminalHistory || 'No record.';
  }
  for (const e of c.evidence) {
    e.initiallyKnown = !!e.initiallyKnown;
    e.requiresWarrant = !!e.requiresWarrant;
    e.isRedHerring = !!e.isRedHerring;
    e.lab = e.lab || {};
  }
  for (const l of c.locations) {
    l.initiallyKnown = !!l.initiallyKnown;
    l.isPrivate = !!l.isPrivate;
    l.sharpEyeDetails = l.sharpEyeDetails || [];
  }
  for (const w of c.witnesses) w.initiallyKnown = w.initiallyKnown !== false;
  c.timeline = c.timeline || [];
  c.redHerrings = c.redHerrings || [];
}
