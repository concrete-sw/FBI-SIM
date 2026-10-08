# FBI-SIM

A single-player, text-driven FBI investigation simulation that runs entirely in
your browser. You are a Special Agent working one case from first briefing to
arrest: case files, evidence, lab work, records, warrants, interviews,
interrogations, and a closing report that is graded against what actually
happened. An AI model, connected with **your own API key**, plays the Game
Master: it narrates, voices every suspect and witness, acts as your supervisor
and as the magistrate judge.

Everything is fictional. Names, places, companies and the cases themselves are
invented by the AI at the start of each game. The insignia is an original design
and nothing here is affiliated with any real agency.

## How it works

The **code owns the game state; the AI narrates and role-plays inside it.**

1. **Case generation.** One AI call produces a hidden *case truth* as JSON: the
   crime, the victim, a full timeline, 4 to 6 suspects (background, personality,
   way of speaking, secret, alibi and whether it is true), the culprit with
   motive, means and opportunity, every piece of evidence (where it is, what a
   close look shows, what the lab shows, who it points to), locations,
   witnesses, red herrings, and at least three independent clues that together
   prove guilt. The JSON is validated (`src/js/engine/schema.js`) and regenerated
   with the validation errors fed back if it is not playable.
2. **Every GM turn** sends the GM system prompt, the case truth, the current
   state (what you have found, in-game time, every suspect's mood, rapport and
   prior answers), a rolling summary of older turns, and the recent turns.
3. **The GM replies in JSON**: narrative text plus state changes (evidence
   found, locations unlocked, people added, facts learned, mood and rapport
   changes, alibi status, procedure errors, legal decisions). The code validates
   every id against the truth before applying anything. Malformed JSON is
   retried once, then shown as plain text with no state change.
4. **The truth is never shown** until the case is closed. Lab results, records
   and subpoena returns are produced by the code from the truth, on the in-game
   clock, so the AI cannot leak or invent them.

The GM rules (stay in character, never reveal, never contradict, fair play,
how to voice innocent and guilty suspects, warrants and probable cause, Miranda,
chain of custody, consequences of bad procedure, hints that cost score, and so
on) live in `src/js/prompts/gmSystem.js`. Read it; it is the heart of the game.

## Quick start (no tools needed)

1. Download the project: on GitHub click the green **Code** button, then
   **Download ZIP**, and unzip it anywhere.
2. Open the `fbi-sim` folder and **double-click `index.html`**. It opens in
   your browser. Press any key to skip the boot screen.
3. On the login screen type an agent name, pick your AI provider, paste your
   API key (see the table below for where to get one), click
   **Test connection**, then **Authenticate**.
4. Pick a crime type and click **Request assignment**. Generating a case
   takes between thirty seconds and a couple of minutes.

That is all. `index.html` is a single self-contained file: no install, no
server, no build. It works in current Chrome, Edge, Firefox and Safari, on a
laptop or a tablet. Your key is stored only in your browser (if you tick
"remember") and is sent only to the provider you pick.

Keyboard: `/` focuses the command bar, `Alt+1..9` opens panels, `Esc` closes
the focused panel, `Tab` moves through everything. A reduce-motion setting
turns off scanlines, blinking and the typewriter.

You can also host the folder on GitHub Pages, Netlify or any static host.

## Getting an API key and connecting it

On the login screen pick a provider, paste a key, optionally choose a model,
press **Test connection**, then **Authenticate**.

| Provider | Where to get a key | Notes |
| --- | --- | --- |
| Anthropic (Claude) | <https://console.anthropic.com/settings/keys> | Direct browser calls supported. Default `claude-sonnet-5-5`. |
| OpenAI | <https://platform.openai.com/api-keys> | Default `gpt-4.1`. |
| Google Gemini | <https://aistudio.google.com/apikey> | Free tier available. Default `gemini-2.5-flash`. |
| DeepSeek | <https://platform.deepseek.com/api_keys> | Default `deepseek-chat`. |
| xAI (Grok) | <https://console.x.ai/> | Default `grok-4`. |
| Groq | <https://console.groq.com/keys> | Fast open-weight models. |
| Mistral | <https://console.mistral.ai/api-keys/> | |
| Ollama (local) | <https://ollama.com/> | No key. Start with `OLLAMA_ORIGINS="*" ollama serve`. |
| Custom | | Any OpenAI-compatible `/chat/completions` endpoint with SSE streaming. Set the base URL. |

**CORS.** The game calls the provider straight from your browser. Anthropic,
OpenAI, Gemini, DeepSeek, xAI, Groq and Mistral allow this. If a provider
rejects browser calls (the console shows a CORS error), run a small proxy that
adds the `Access-Control-Allow-Origin` header and point the **Custom** provider
at it.

**Cost and model choice.** Case generation is one large call (roughly 8 to 15k
output tokens). Each turn sends the whole truth plus state, so a standard case
is a few thousand input tokens per turn. A fast mid-tier model (Sonnet, Flash,
DeepSeek) is a fine Game Master; larger models write better suspects. Models
that cannot reliably produce JSON will fall back to plain text often and the
state will not advance.

## Playing

- **Case File**: briefing, initial report, statements, known timeline.
- **Locations**: travel, look around, search a specific spot, canvass. Private
  property needs consent, exigency or a warrant, or what you find is thrown out.
- **Evidence**: examine, compare two items, send to the lab (fingerprints, DNA,
  ballistics, toxicology, digital, trace, documents). Results arrive after
  in-game hours pass. Present an item in an interview.
- **Persons**: profiles, demeanour, rapport, alibi status (unverified,
  confirmed, broken), everything they have said, criminal and vehicle records.
- **Interview**: pick who to question, type freely, toggle custodial, present
  evidence. Rapport opens people up; pressure without cause shuts them down.
- **Lab**, **Records**, **Legal** (search warrants and subpoenas, judged on
  the probable cause you have actually gathered).
- **Dispatch**: your supervisor. Procedure, resources, charges, time. Hints on
  request, vague at first, and they cost score.
- **Notebook** (automatic facts plus your notes) and **Case Board** (link
  suspects, evidence and facts).
- **Close Case**: name the culprit, motive, means, opportunity, key evidence
  and charges. The AI grades it, the truth is unsealed, and the debrief shows
  what happened, what you missed and which leads were red herrings. Arrest the
  wrong person and the real culprit walks.
- **Clock**: every action costs in-game time and the case has a deadline that
  difficulty tightens.
- **Save**: autosave after every turn, five manual slots, export and import as
  a JSON file (Settings).

The command bar accepts typed commands too (`help` lists them), and anything it
does not recognise is sent to the GM as a free action.

## Adding a provider

All adapters live in `src/js/providers/` and share one interface:

```js
{
  id, name, defaultModel, models, keyUrl, notes, defaultBaseUrl, allowCustomBaseUrl,
  async *stream({ apiKey, model, system, messages, json, maxTokens, temperature, baseUrl, signal })
  // yields text chunks
}
```

- **OpenAI-compatible endpoint**: add one `makeOpenAICompatible({...})` entry to
  the `PROVIDERS` array in `src/js/providers/index.js`, then rebuild. That is all.
- **Different protocol**: copy `src/js/providers/gemini.js` or `anthropic.js`, implement
  `stream()` (use `readSSE` and `throwForStatus` from `sse.js`), and add the
  object to `PROVIDERS`.

`messages` is `[{ role: 'user' | 'assistant', content }]`; `system` is a
string; when `json` is true ask the API for a JSON object if it supports that.

## Project layout

```
fbi-sim/
  index.html              BUILT single-file game (double-click this). Do not edit by hand.
  src/index.html          source page (ES modules; needs a local server to run)
  src/css/style.css       terminal theme, windows, responsive rules
  src/assets/insignia.svg original fictional insignia
  src/js/main.js          entry point
  src/js/providers/       AI provider adapters and registry
  src/js/prompts/         GM system prompt, case generation, grading, summary
  src/js/engine/          schema validation, state, clock, GM turn loop, grader, storage
  src/js/ui/              window manager, panels, typewriter, boot, app controller
  dev/build.js            bundles src/ into index.html
  dev/mock-gm.js          offline mock GM for UI testing, with dev/sample-case.json
```

## Developing

Edit the files under `src/`, then rebuild the single-file version:

```bash
node fbi-sim/dev/build.js
```

While developing you can also serve `src/` directly so changes show without a
rebuild (ES modules need a server):

```bash
cd fbi-sim/src && python3 -m http.server 8080   # then open http://localhost:8080
```

Commit the rebuilt `index.html` with your source changes so the double-click
version stays current.

## Testing without spending tokens

`dev/mock-gm.js` is a tiny OpenAI-compatible server that returns the sample
case and scripted replies:

```bash
node fbi-sim/dev/mock-gm.js        # http://localhost:8787/v1
```

In the game choose **Custom**, base URL `http://localhost:8787/v1`, any key.
It exercises every panel and state transition; it is not a game.

## Content notes

The GM is instructed to keep violence at the restraint of a case report, to use
only invented people and companies, and to redirect out-of-character or
rule-breaking requests in character. The provider's own safety systems still
apply. This is a work of fiction for entertainment and is not legal or
procedural advice.
