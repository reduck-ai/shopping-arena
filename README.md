# Shopping Arena

AI shopping agents, compared on real stores, by [Reduck](https://reduck.ai).

The same shopping prompt goes to several agents on real store sites. Define an eval in one file, run it, read every step, and share the results.

The same prompt goes to each **arm**, and each returns its conversation. An arm is a **runner** under a name, a function from a prompt to a conversation (`runners/`):

- **reduck**, **chrome**: one Claude Code session through the Agent SDK (the `claude_code` system prompt), with exactly one browser tool: the [Reduck](https://reduck.ai) MCP server, which runs saved browser scripts, or Claude in Chrome (`--chrome`). The two differ in that tool and in one sentence of the prompt ("Use Reduck MCP." or "Use Claude for Chrome MCP."); `--strict-mcp-config` and `ENABLE_CLAUDEAI_MCP_SERVERS=false` keep any other MCP server out of both.
- **shopduck**: [ShopDuck](https://shopduck.ai), over its own HTTP API. `SHOPDUCK_URL` names another deployment.
- **muse**: Muse (muse.ai), through the Reduck scripts of muse.ai, run on the paired Chrome where its account is signed in. Muse recalls its past chats, so a `pnpm bench` call resets the account (`muse.ai/reset_muse`: every chat and its memory are deleted) before its first Muse run. Its steps and its browser's screenshots come from Muse's own activity record (`muse.ai/get_activity`).

Every run keeps its conversation, so any result can be checked against what the agent did.

## Words

- **Task**: a prompt, plus optional code: `requires` (what must hold before a run means anything) and `check` (the verdict).
- **Run**: one task on one arm. Its id is `<time>/<task>.<arm>`, `<time>` the `pnpm bench` call that ran it.
- **Trial**: the newest run of each arm on one prompt of a task, whichever call ran it: what the page compares.
- **Verdict**: `{ pass, detail, by }`, given by the task's `check`, a model it asks, or a person (`set_verdict`).

## Your first eval

1. Copy `tasks/example.ts` to `tasks/<id>.ts`: a prompt and, when the answer can be checked by code, a `check`.
2. If it needs a signed-in site, add a `requires` with `signedInAs`, the account read from an environment variable of yours.
3. `pnpm bench --task <id> --arm shopduck,muse`: a run per arm.
4. `pnpm replay`: read the runs, step by step. Review them over the MCP (below) if the task has no `check`.
5. To share the results, publish them (below).

Everything else is the tool: nothing to register, no runner flag.

## Tasks

A task is a file in `tasks/` that default-exports a `Task` (or a list of them):

```ts
{
  id: "hn-dropbox",
  name: "The Dropbox launch post on Hacker News",
  prompt: "Find the Hacker News post where Dropbox's founder first showed it…",
  requires?: () => Verdict,   // checked before every run; the run is skipped if it fails
  check?: (run) => Verdict,   // from the answer and the session
}
```

See `tasks/example.ts`. `task.ts` has the helpers: `signedInAs` (assert the exact account a site is signed in as), `all`, `reduck` (run a Reduck script from a check).

A task in `tasks/` is public: its file is committed and its runs can go on the site. It names no account: the ones it needs come from the environment (`ARENA_X_HANDLE`, say, for a task that must be signed in to X). A task that carries personal data goes in `tasks/private/`, git-ignored, so each person keeps their own; its runs are never published. So does `tasks/private/deny.txt`, the strings of yours that must never be published, one per line: publishing does not run without it.

## Run

Requirements: Node 22.18+, pnpm, and Chrome with the Reduck extension paired, which the `muse` and `reduck` arms and the `requires` checks drive: its sign-ins are the test fixture. The `reduck` and `chrome` arms also need [Claude Code](https://claude.com/claude-code), and `chrome` Claude in Chrome.

```sh
pnpm install
npx @reduck-ai/cli@latest login                              # or set REDUCK_API_KEY
pnpm bench                                                   # every task, every arm
pnpm bench --task hn-dropbox --arm shopduck,muse --timeout 10   # minutes per run, default 15
pnpm check                                                   # svelte-check: the .ts files and the app
```

- `REDUCK_MCP_URL` points the `reduck` and `muse` arms and the `requires` checks at another Reduck MCP (default `https://mcp.reduck.ai`). `REDUCK_API_KEY`, when set, is used instead of the CLI's OAuth login, which lives one hour and is refreshed before each Claude Code run.
- Runs are sequential: several arms drive the same Chrome.
- A run leaves its conversation in `runs/<time>/<task>.<arm>/session.json`, the same shape whatever the runner (`Session` in `session.ts`), and one row in `runs/<time>/results.jsonl`: the prompt, verdict, outcome, time, cost, the conversation's path and the answer, or `skipped` with the reason.
- A run that did not go end to end (a crash, a timeout, a browser that stopped answering: `faults.ts`) is kept under `runs/_faulty/`, out of the page: run it again.
- Importing `run.ts` starts the benchmark. To try a task's `requires` or `check`, import the task file and call them.

## What a run is scored on

- **Verdict**: see above.
- **Time**: the conversation's own, from the ask to the last message, so what a runner spends to reach its agent is not counted.
- **Cost**: what the agent reports it billed: for Claude Code, side models included. `–` for an agent that shows none (Muse, and ShopDuck's deployment).
- **Final context**: the tokens in the model's context when the task ends: the last API call's prompt (input + cache read + cache write) plus its output. For Claude Code it can be too high by the last reply's thinking, never too low. Not shown by Muse.

## Read, grade and replay

- `pnpm replay` serves a page with one card per task: who did better in its latest trial, and by how much. Opening a trial replays its runs side by side on one timeline: the chat, the browser screenshots, and a result card when each run ends. Live, it shows every run on your machine at any stage: a switch at the top right moves the page between raw, draft and published in place, and `?run=<id>@raw&run=<id>@draft` puts one run's transcript next to its draft on one timeline. Built, it shows the published runs alone.
- `mcp.ts` is an MCP server over the runs, so an agent can review a run step by step, screenshots included, and record its verdict:

  ```sh
  pnpm mcp        # http://127.0.0.1:7802/mcp, starts again when its code changes
  claude mcp add --transport http shopping-arena http://127.0.0.1:7802/mcp
  ```

  `list_runs`, `read_session` and `read_step` (a run at any stage: as recorded, draft, published), `set_verdict` (a reviewer's verdict, for a task no code can grade or to overrule a check), `export_run`, `redact_export`, and `list_sessions` for any other Claude Code session.

## Publish

A trace can hold private data no rule foresees, so a run goes public by name, in three steps:

```
transcript (never edited)
   │  pnpm export <run id> …               scrubbed, screenshots dropped → exports/<id>.json (git-ignored)
   ▼
draft      read whole (read_session stage: "draft"), redacted (redact_export) until clean
   │  pnpm export --approve <run id> …     a person's yes; moved → replay/public/data/<id>.json
   ▼
published  never edited; commit and push to main: GitHub Pages builds the site from it
```

- Only a run of a public task can be drafted.
- The scrub rewrites what a machine puts in every trace: the home directory, the temp directory, Google's CAPTCHA IP, every email address.
- Every line of `tasks/private/deny.txt` (your emails, handles, names) is reported in a draft and refused at approval, for every published file, not only the new ones.
- `pnpm export --approve` alone rebuilds `tasks.json`, the site's index, from the folder: delete a published file and run it to unpublish.

## License

MIT
