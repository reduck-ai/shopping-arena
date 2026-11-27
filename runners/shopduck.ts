/**
 * ShopDuck (https://shopduck.ai), an eve agent, over the HTTP API eve serves on every deployment:
 * a session is created with its first message, and its stream is the conversation, as stored
 * lines of facts (eve's docs, "Sessions, runs & streaming").
 *
 * SHOPDUCK_URL names another deployment (a local `pnpm dev:web`, http://localhost:3000): the
 * same agent with other tools is the same runner.
 *
 * Every run is the visitor `arena` (ShopDuck's `shopduck_vid` cookie), so the chats of the
 * benchmark are told apart from a person's wherever ShopDuck's chats are listed.
 */
import type { ToolStep } from "../replay/chat/chat.ts";
import type { Session, Step } from "../session.ts";
import type { Runner } from "../task.ts";

const URL = (process.env.SHOPDUCK_URL ?? "https://shopduck.ai").replace(/\/$/, "");

type Fact = { type: string; data: any; at: string };

const shopduck: Runner = async (prompt, signal) => {
	const created = await fetch(`${URL}/eve/v1/session`, {
		method: "POST",
		headers: { "content-type": "application/json", cookie: "shopduck_vid=arena" },
		body: JSON.stringify({ message: prompt }),
		signal
	});
	if (!created.ok) throw new Error(`${created.status} ${await created.text()}`);
	const { sessionId } = (await created.json()) as { sessionId: string };

	// A read of what is recorded so far, again until the turn has ended: a followed stream would
	// have a lease to renew.
	let facts: Fact[] = [];
	while (!facts.some((f) => f.type === "turn.settled")) {
		await new Promise((done) => setTimeout(done, 3000));
		const res = await fetch(`${URL}/eve/v1/session/${sessionId}/stream?follow=false`, { signal });
		if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
		facts = (await res.text())
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line))
			.flatMap((line) => (line.facts ?? []).map((f: Fact) => ({ ...f, at: line.at })));
	}

	const steps: Step[] = [];
	const calls = new Map<string, ToolStep>();
	const parts = new Map<string, string>();
	/** What ShopDuck showed with its `show` tool: cards whose links its reply only points to. */
	const shown: string[] = [];
	const models = new Set<string>();
	const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	const prompts: number[] = [];
	let lastOutput = 0;
	let usd = 0;
	for (const { type, data, at } of facts) {
		if (type === "model.started") models.add(data.modelId);
		if (type === "content.completed" && data.kind === "text" && data.value?.trim()) {
			parts.set(data.partId, data.value);
			steps.push({ kind: "text", at, text: data.value });
		}
		if (type === "call.requested") {
			const step: ToolStep = {
				kind: "tool",
				at,
				end: null,
				tool: data.capability.name,
				input: data.input,
				error: false,
				result: "",
				images: []
			};
			steps.push(step);
			calls.set(data.callId, step);
			if (data.capability.name === "show") shown.push(JSON.stringify(data.input));
		}
		if (type === "call.settled") {
			const step = calls.get(data.callId);
			if (!step) continue;
			step.end = at;
			step.error = data.outcome !== "completed";
			step.result = data.error?.message ?? JSON.stringify(data.output ?? data.outputRef ?? "");
		}
		if (type === "usage.recorded") {
			// eve's inputTokens count the tokens read from cache too.
			const u = data.usage;
			tokens.input += u.inputTokens - u.cacheReadTokens;
			tokens.output += u.outputTokens;
			tokens.cacheRead += u.cacheReadTokens;
			tokens.cacheWrite += u.cacheWriteTokens;
			prompts.push(u.inputTokens);
			lastOutput = u.outputTokens;
			usd += u.costUsd ?? 0;
		}
	}

	const settled = facts.find((f) => f.type === "turn.settled")!;
	if (settled.data.outcome !== "completed")
		throw new Error(settled.data.error?.message ?? `the turn was ${settled.data.outcome}`);
	const start = facts[0].at;
	return {
		id: sessionId,
		path: `${URL}/s/${sessionId}`,
		title: null,
		ask: prompt,
		answer: [...(settled.data.reply ?? []).map((id: string) => parts.get(id) ?? ""), ...shown].join("\n\n"),
		start,
		end: settled.at,
		durationMs: Date.parse(settled.at) - Date.parse(start),
		models: [...models],
		turns: prompts.length,
		steps,
		tokens,
		context: { start: prompts[0] ?? 0, peak: Math.max(0, ...prompts), end: (prompts.at(-1) ?? 0) + lastOutput },
		// The deployment's gateway reports a cost of 0: unknown, not free.
		cost: usd ? { usd, byModel: {}, since: start } : null
	};
};

export default { shopduck };
