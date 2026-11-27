/**
 * Run each task in `tasks/` once per arm, one run at a time, and record its conversation and its
 * verdict.
 *
 *   pnpm bench                                        # every task, every arm
 *   pnpm bench --task t1 --arm muse,shopduck --timeout 10   # minutes per run, default 15
 *
 * An arm is a runner under its name (`runners/`): given the prompt, it returns the conversation.
 * One call writes into `runs/<time>/`. The replay page compares the newest run of each arm on the
 * same prompt, whichever call ran it.
 *
 * A run leaves `runs/<time>/<task>.<arm>/session.json`, its conversation, and one row in
 * `runs/<time>/results.jsonl`, with the prompt it got. Its time is the conversation's own, from the
 * ask to the last message, so what a runner spends to reach its agent is not counted. The task's
 * check (see task.ts) judges the run from that conversation. A run that did not go end to end
 * (faults.ts) is kept under `runs/_faulty/`, where the page does not read it.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { fault } from "./faults.ts";
import claude from "./runners/claude.ts";
import muse from "./runners/muse.ts";
import shopduck from "./runners/shopduck.ts";
import type { Session } from "./session.ts";
import { tasks, type Runner, type Task, type Verdict } from "./task.ts";

const runners: Record<string, Runner> = { ...claude, ...muse, ...shopduck };

const { values: flags } = parseArgs({
	options: {
		task: { type: "string" },
		arm: { type: "string" },
		timeout: { type: "string", default: "15" }
	}
});
/** `--task` and `--arm` each take one name or a comma-separated list. */
const only = (flag: string | undefined) => (flag ? new Set(flag.split(",")) : null);
const onlyTasks = only(flags.task);
const arms = flags.arm?.split(",") ?? Object.keys(runners);
for (const arm of arms) if (!runners[arm]) throw new Error(`no arm ${arm}: ${Object.keys(runners).join(", ")}`);
const timeoutMs = Number(flags.timeout) * 60_000;
const RUNS = join(import.meta.dirname, "runs");
const out = join(RUNS, new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(out, { recursive: true });

async function run(task: Task, arm: string) {
	const name = `${task.id}.${arm}`;
	const dir = join(out, name);
	mkdirSync(dir, { recursive: true });
	const start = Date.now();
	const timeout = AbortSignal.timeout(timeoutMs);
	let session: Session | null = null;
	let outcome = "success";
	try {
		// A runner that does not watch the signal is left behind when the time is up.
		session = await Promise.race([
			runners[arm](task.prompt, timeout),
			new Promise<never>((_, stop) => timeout.addEventListener("abort", () => stop(timeout.reason)))
		]);
	} catch (e) {
		outcome = timeout.aborted
			? `timeout after ${flags.timeout} min`
			: `crash: ${e instanceof Error ? e.message : String(e)}`;
	}
	if (session) writeFileSync(join(dir, "session.json"), JSON.stringify(session));
	const answer = session?.answer ?? "";
	let verdict: Verdict | null = null;
	try {
		verdict = (await task.check?.({ answer, session })) ?? null;
	} catch (e) {
		verdict = { pass: false, detail: `check crashed: ${e instanceof Error ? e.message : String(e)}` };
	}
	const row = {
		task: task.id,
		arm,
		prompt: task.prompt,
		verdict,
		outcome,
		wallMs: session?.durationMs ?? Date.now() - start,
		// Null when the agent shows no cost: unknown, not free.
		costUsd: session?.cost?.usd ?? null,
		session: session && join(dir, "session.json"),
		answer
	};
	const faulty = fault(row, session?.steps ?? []);
	if (faulty) {
		const aside = join(RUNS, "_faulty", basename(out));
		mkdirSync(aside, { recursive: true });
		// A run set aside before, under the same name, keeps its folder: this one gets the time.
		const to = existsSync(join(aside, name)) ? `${name}-${Date.now()}` : name;
		renameSync(dir, join(aside, to));
		const moved = { ...row, fault: faulty, session: row.session && join(aside, to, "session.json") };
		appendFileSync(join(aside, "results.jsonl"), JSON.stringify(moved) + "\n");
		console.log(`${name.padEnd(28)} FAULTY ${faulty}: kept in runs/_faulty/${basename(out)}`);
		return;
	}
	appendFileSync(join(out, "results.jsonl"), JSON.stringify(row) + "\n");
	const judged = verdict ? `${verdict.pass ? "pass" : "FAIL"} ${verdict.detail ?? ""}` : "unchecked";
	console.log(
		`${name.padEnd(28)} ${judged}  ${(row.wallMs / 1000).toFixed(0)}s  ` +
			`${row.costUsd === null ? "$–" : `$${row.costUsd.toFixed(2)}`}  ${outcome}`
	);
}

// `requires` before every run, not once per task: a run can change what the next one starts
// from (a cart, a sign-in), and every arm must start from the same state.
for (const task of (await tasks()).filter((t) => !onlyTasks || onlyTasks.has(t.id))) {
	for (const arm of arms) {
		const ready: Verdict = await Promise.resolve(task.requires?.() ?? { pass: true }).catch(
			(e: unknown) => ({ pass: false, detail: e instanceof Error ? e.message : String(e) })
		);
		if (ready.pass) {
			await run(task, arm);
			continue;
		}
		appendFileSync(join(out, "results.jsonl"), JSON.stringify({ task: task.id, arm, skipped: ready.detail }) + "\n");
		console.log(`${`${task.id}.${arm}`.padEnd(28)} SKIP  ${ready.detail ?? ""}`);
	}
}
console.log(`results: ${join(out, "results.jsonl")}`);
