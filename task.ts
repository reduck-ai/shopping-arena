/**
 * What a benchmark task is: a prompt, and optionally code around it. And what runs it: a runner.
 * - `requires` states what must hold before the task can mean anything (signed in to the
 *   right accounts, say). The runner calls it before every run and skips the run when it fails,
 *   so a broken setup is reported as such rather than as a failure of the tool under test. It
 *   may first undo what an earlier run left in the world (an item in a cart), then verify.
 * - `check` decides whether a run succeeded, from its conversation (the final answer, and the
 *   session with every step). Without one, the run is recorded and judged by reading the session
 *   (`set_verdict` in mcp.ts).
 *
 * Task files live in `tasks/` (`tasks/private/` is git-ignored, for tasks that carry personal
 * data) and default-export one Task or a list of them.
 */
import { execFile } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { Session } from "./session.ts";

export type Run = { answer: string; session: Session | null };
/** What a task runs on: given the prompt, it returns the conversation, and throws when the run
 *  did not come to an end. How it reaches its agent (a CLI, an HTTP API, a Reduck script) is its
 *  own. A file of `runners/` default-exports its runners by name, and the name is the run's arm. */
export type Runner = (prompt: string, signal: AbortSignal) => Promise<Session>;
/** Whether a run succeeded, why, and who decided: the task's `check` (the default), a model it
 *  asked as a judge, or a person (`set_verdict`) for a task no code can grade. */
export type Verdict = { pass: boolean; detail?: string; by?: "check" | "model" | "person" };
export type Task = {
	id: string;
	/** A short title for the people reading the results; `prompt`, what the agent gets, says
	 *  the rest. */
	name: string;
	prompt: string;
	/** Shown first on the page, whatever its trials' dates. */
	pinned?: boolean;
	requires?: () => Verdict | Promise<Verdict>;
	check?: (run: Run) => Verdict | Promise<Verdict>;
};

/** Every task in `tasks/`. A private one is under `tasks/private/`: git-ignored, and never
 *  published with its runs. A file is imported again when it changes, so a long-lived process
 *  (the `pnpm replay` server) serves what is on disk. */
export async function tasks(): Promise<(Task & { private: boolean })[]> {
	const dir = join(import.meta.dirname, "tasks");
	const found = [];
	for (const f of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
		if (!f.endsWith(".ts")) continue;
		const url = `${pathToFileURL(join(dir, f)).href}?v=${statSync(join(dir, f)).mtimeMs}`;
		const { default: exported } = (await import(url)) as { default: Task | Task[] };
		const isPrivate = f.startsWith(`private${sep}`);
		found.push(...[exported].flat().map((t) => ({ ...t, private: isPrivate })));
	}
	return found;
}

/** Run a saved Reduck script on the paired browser, through the Reduck CLI, and return its
 *  result. The CLI and both arms drive the same Chrome profile, so what a script sees here is
 *  what either arm will see. */
export async function reduck(script: string, args: Record<string, string> = {}): Promise<any> {
	const kv = Object.entries(args).map(([k, v]) => `${k}=${v}`);
	const { stdout } = await promisify(execFile)(
		"npx",
		["-y", "@reduck-ai/cli@latest", "run", "--script", script, ...kv],
		{ maxBuffer: 16 * 1024 * 1024 }
	);
	return JSON.parse(stdout);
}

/** A precondition that the browser is signed in to one site as one given account: runs the
 *  site's whoami script, reads the identity from its result, and returns null when it matches,
 *  else what is wrong. A script that throws (some whoami scripts throw when signed out) is a
 *  mismatch too. */
export async function signedInAs(
	site: string,
	script: string,
	read: (result: any) => unknown,
	expected: string
): Promise<string | null> {
	const got = await reduck(script).then(read, () => null);
	return got === expected ? null : `${site} is ${got ?? "signed out"}, needs ${expected}`;
}

/** Merge several precondition checks into one verdict that names every one that failed. */
export async function all(checks: Promise<string | null>[]): Promise<Verdict> {
	const problems = (await Promise.all(checks)).filter((p): p is string => p !== null);
	return { pass: problems.length === 0, detail: problems.join("; ") || undefined };
}
