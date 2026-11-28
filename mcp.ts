/**
 * HTTP MCP server over the bench runs, so an agent can review them: list them, read one whole at
 * each stage (as recorded, its draft export, its published file) or several to a file, set its
 * verdict, draft it and redact the draft (export.ts says why). It also reads any Claude Code session (`session.ts`).
 * Approving a draft is a person's yes, so it stays `pnpm export --approve`.
 *
 *   pnpm mcp        # serves http://127.0.0.1:7802/mcp, and starts again when a file it imports changes
 *   claude mcp add --transport http shopping-arena http://127.0.0.1:7802/mcp
 *
 * A request gets a server of its own and no session is kept, so a client's connection outlives
 * a restart.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";
import { load, readSession, runs, stageFile } from "./data.ts";
import { listSessions, parseSession, projectDir, type Step } from "./session.ts";
import { tasks } from "./task.ts";

const PORT = Number(process.env.ARENA_MCP_PORT ?? 7802);
const json = (value: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
});
const cwd = z
	.string()
	.describe(
		"Working directory the sessions ran in. Default: the directory this server was started in."
	)
	.optional();
const id = z
	.string()
	.describe(
		"Session id (the .jsonl file name), an absolute path to a .jsonl transcript, or a bench run id `<folder>/<task>.<arm>` from list_runs."
	);
const stage = z
	.enum(["raw", "draft", "published"])
	.default("raw")
	.describe(
		"For a bench run id. raw: its transcript, never edited. draft: its export under review (export_run, redact_export). published: the approved file the site shows, never edited."
	);
const RESULT_CHARS = 500;
/** What one full read may hold, in tokens, under the 25,000 a client accepts from a tool: about 4
 *  characters of text per token, and about 2,500 tokens per screenshot (a full read of 10 at
 *  1920×1000 went over). */
const BUDGET = 20_000;
const IMAGE_TOKENS = 2_500;

/** A session to read: parsed from its transcript, or a run's export, whose session and run
 *  fields are laid flat so both read the same. */
function open(id: string, dir: string, at: z.infer<typeof stage>): { id: string; steps: Step[] } {
	if (at !== "raw") {
		const found = load(id, at);
		if (!found) throw new Error(`no ${at} for ${id}`);
		const { session, ...run } = found;
		return { ...run, ...session };
	}
	const run = runs().find((r) => r.id === id);
	if (run) return readSession(run.transcript);
	return parseSession(id.startsWith("/") ? id : join(projectDir(dir), `${id}.jsonl`));
}

function build() {
	const server = new McpServer({ name: "shopping-arena", version: "0.3.0" });
	server.registerTool(
		"list_sessions",
		{
			description:
				"List the Claude Code sessions of a working directory, newest first: id, time, first ask, step count, what it cost in USD (null when the transcript records none). Bench runs each ran in a temp directory of their own: list them with list_runs.",
			inputSchema: { cwd, limit: z.number().int().positive().default(20) }
		},
		async ({ cwd: dir = process.cwd(), limit }) =>
			json(
				listSessions(dir)
					.slice(0, limit)
					.map(({ path, modified }) => {
						const s = parseSession(path);
						return {
							id: s.id,
							modified,
							title: s.title,
							ask: s.ask.slice(0, 200),
							steps: s.steps.length,
							durationMs: s.durationMs,
							costUsd: s.cost?.usd ?? null
						};
					})
			)
	);

	server.registerTool(
		"list_runs",
		{
			description:
				"Every bench run that has its transcript, newest first: its id (`<folder>/<task>.<arm>`), task, arm, verdict, its task's visibility (public: can be exported; private: under tasks/private/, never exported; gone: no task file has that id any more), and its stage: raw, draft (exported, under review) or published.",
			inputSchema: {}
		},
		async () => {
			const known = new Map((await tasks()).map((t) => [t.id, t.private ? "private" : "public"]));
			return json(
				runs()
					.sort((a, b) => (a.id < b.id ? 1 : -1))
					.map((r) => ({
						id: r.id,
						task: r.task,
						arm: r.arm,
						verdict: r.verdict,
						visibility: known.get(r.task) ?? "gone",
						stage: existsSync(stageFile(r.id, "published"))
							? "published"
							: existsSync(stageFile(r.id, "draft"))
								? "draft"
								: "raw"
					}))
			);
		}
	);

	server.registerTool(
		"read_session",
		{
			description:
				"Parse one Claude Code session: ask, final answer, duration, models, turns, tokens, the cost Claude Code recorded (total and per model, side models included; null when the transcript records none, as for a subagent's), then every step in order — what the assistant said, and each tool call whole (input, error, its full result, when it started and ended) followed by the images it returned (screenshots). For a bench run, `stage` reads its draft or published export instead: exactly what goes public. A full read returns the steps from `from` that fit in one answer, and ends with the index to pass as `from` to read the rest: call it again until it says the session is read. full: false gives an outline instead: each result cut to its first 500 characters and images counted, not shown.",
			inputSchema: {
				id,
				cwd,
				stage,
				full: z
					.boolean()
					.default(true)
					.describe("false: an outline, results cut to 500 characters and images counted."),
				from: z.number().int().min(0).default(0).describe("For a full read: the first step to return.")
			}
		},
		async ({ id, cwd: dir = process.cwd(), stage: at, full, from }) => {
			const s = open(id, dir, at);
			if (full) {
				const { steps, ...rest } = s;
				const head = JSON.stringify(rest, null, 2);
				const content: ReturnType<typeof inFull> = from ? [] : [{ type: "text" as const, text: head }];
				let spent = from ? 0 : head.length / 4;
				let i = from;
				for (; i < steps.length; i++) {
					const step = inFull(s, i);
					const cost = step.reduce((n, c) => n + (c.type === "image" ? IMAGE_TOKENS : c.text.length / 4), 0);
					// A step is never split: the first one is returned whatever its size.
					if (i > from && spent + cost > BUDGET) break;
					content.push(...step);
					spent += cost;
				}
				content.push({
					type: "text" as const,
					text:
						i < steps.length
							? `Steps ${from} to ${i - 1} of ${steps.length}: read the rest with from: ${i}.`
							: `Session read to its last step (${steps.length}).`
				});
				return { content };
			}
			return json({
				...s,
				steps: s.steps.map((step, index) =>
					step.kind === "text"
						? { index, ...step }
						: {
								index,
								...step,
								result: step.result.slice(0, RESULT_CHARS),
								images: step.images.length
							}
				)
			});
		}
	);

	server.registerTool(
		"read_step",
		{
			description:
				"Steps of a session in full, in the order asked: the text each said, or a tool call with its input, its whole result text, and the images it returned (screenshots), shown as images right after it. Pass several indices to read them in one call.",
			inputSchema: {
				id,
				index: z
					.union([z.number().int().min(0), z.array(z.number().int().min(0)).min(1)])
					.describe("A step's index, or a list of them, from read_session."),
				cwd,
				stage
			}
		},
		async ({ id, index, cwd: dir = process.cwd(), stage: at }) => {
			const s = open(id, dir, at);
			return { content: [index].flat().flatMap((i) => inFull(s, i)) };
		}
	);

	server.registerTool(
		"dump_sessions",
		{
			description:
				"Write several sessions whole to one file, as recorded, each step as read_step gives it and an image as a line in its place: to read more than one answer holds. Each session starts with a line `# <id>`.",
			inputSchema: {
				ids: z.array(id).min(1),
				path: z.string().describe("Absolute path of the file to write."),
				cwd
			}
		},
		async ({ ids, path, cwd: dir = process.cwd() }) => {
			const text = ids.map((i) => {
				const s = open(i, dir, "raw");
				const { steps, ...rest } = s;
				const lines = steps.map((_, n) =>
					inFull(s, n).map((c) => (c.type === "text" ? c.text : `[${c.mimeType} omitted]`)).join("\n")
				);
				return [`# ${i}`, JSON.stringify(rest, null, 2), ...lines].join("\n\n");
			});
			writeFileSync(path, text.join("\n\n"));
			return json({ path, sessions: ids.length, chars: text.join("").length });
		}
	);

	server.registerTool(
		"export_run",
		{
			description:
				"Draft bench runs for the public site (`pnpm export`): scrubbed, screenshots dropped, written to exports/ for review. Reports what deny.txt still finds in each, by line number. Read a draft with read_session stage: \"draft\".",
			inputSchema: { ids: z.array(z.string()).min(1).describe("Run ids from list_runs.") }
		},
		async ({ ids }) => {
			const { stdout, stderr } = await promisify(execFile)(
				"node",
				[join(import.meta.dirname, "export.ts"), ...ids],
				{ cwd: import.meta.dirname }
			);
			return { content: [{ type: "text" as const, text: `${stdout}${stderr}` }] };
		}
	);

	server.registerTool(
		"redact_export",
		{
			description:
				"Replace every occurrence of a string in a run's draft, in every text it holds (answer, steps, results), and return how many were replaced. Only a draft: a transcript and a published file are never edited. Read the draft again to confirm.",
			inputSchema: {
				id: z.string().describe("A run id whose stage is draft."),
				find: z.string().min(1).describe("The exact text, as read_session shows it."),
				replace: z.string().default("…")
			}
		},
		async ({ id, find, replace }) => {
			const path = stageFile(id, "draft");
			if (!existsSync(path)) throw new Error(`no draft for ${id}: export_run it first`);
			let count = 0;
			const walk = (v: unknown): unknown => {
				if (typeof v === "string") {
					count += v.split(find).length - 1;
					return v.replaceAll(find, replace);
				}
				if (Array.isArray(v)) return v.map(walk);
				if (v && typeof v === "object")
					return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
				return v;
			};
			writeFileSync(path, JSON.stringify(walk(JSON.parse(readFileSync(path, "utf8")))));
			return json({ id, replaced: count });
		}
	);

	server.registerTool(
		"set_verdict",
		{
			description:
				"Record a reviewer's verdict on a bench run, in its row of results.jsonl: whether it passed and why. It replaces the verdict the run had. Read the whole run first (read_session).",
			inputSchema: {
				id: z.string().describe("A run id from list_runs."),
				pass: z.boolean(),
				detail: z.string().min(1).describe("Why, in one or two sentences a reader of the results can check.")
			}
		},
		async ({ id, pass, detail }) => {
			const [folder] = id.split("/");
			const file = join(import.meta.dirname, "runs", folder, "results.jsonl");
			if (!existsSync(file)) throw new Error(`no run ${id}`);
			const rows = readFileSync(file, "utf8")
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line));
			const row = rows.find((r) => `${folder}/${r.task}.${r.arm}` === id && !r.skipped);
			if (!row) throw new Error(`no run ${id}`);
			row.verdict = { pass, detail, by: "person" };
			writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
			return json({ id, verdict: row.verdict });
		}
	);
	return server;
}

/** One step whole, as MCP content: its JSON, then each image it returned. */
function inFull(session: { id: string; steps: Step[] }, i: number) {
	const step = session.steps[i];
	if (!step) throw new Error(`no step ${i} in session ${session.id}`);
	const { images, ...rest } = step.kind === "tool" ? step : { ...step, images: [] };
	return [
		{ type: "text" as const, text: JSON.stringify({ index: i, ...rest }, null, 2) },
		...images.map((img) => ({
			type: "image" as const,
			data: img.data,
			mimeType: img.mediaType
		}))
	];
}

createServer(async (req, res) => {
	const server = build();
	const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
	res.on("close", () => void transport.close().then(() => server.close()));
	await server.connect(transport);
	await transport.handleRequest(req, res);
}).listen(PORT, "127.0.0.1", () => console.error(`shopping-arena MCP: http://127.0.0.1:${PORT}/mcp`));
