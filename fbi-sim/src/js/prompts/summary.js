// Prompt for the rolling summary of older turns.

export function buildSummaryPrompt({ previousSummary, turns }) {
  const transcript = turns.map(t => `${t.role === 'user' ? 'AGENT' : 'GM'}: ${t.content}`).join('\n\n');
  return `You maintain a running summary of an FBI investigation role-play so the Game Master can remember older events. Update the summary below with the new turns. Keep it factual and compact (under 400 words): what the agent did, where they went, what they found, what each person said (including any lies or contradictions the agent surfaced), rapport and mood shifts, warrants and legal decisions, procedure errors, and hints given. Write in the third person, past tense. Do not add commentary or speculation. Do not reveal anything the agent has not learned.

PREVIOUS SUMMARY:
${previousSummary || '(none)'}

NEW TURNS:
${transcript}

Reply with the updated summary as plain text only.`;
}
