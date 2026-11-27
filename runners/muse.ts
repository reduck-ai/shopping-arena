/**
 * Muse (https://muse.ai), Meta's agent, through the Reduck scripts of muse.ai run on the paired
 * Chrome, where the account is signed in. `ask` sends the prompt in a new chat, `get_chat` reads
 * the chat until Muse marks it completed (Muse can go on working in its own browser after its first
 * reply), and `get_activity` reads what Muse did for it.
 *
 * The conversation is Muse's own, step for step: each message and card it posted is a text step,
 * and each step of its activity (its tool calls, and those of the browser agent it launched) is a
 * tool step, with Muse's report as its result and the screenshots its browser kept as its images.
 * A report is written by Muse's model: it can claim more than the step did. Muse shows no token
 * count and no cost.
 */
import type { Step } from "../replay/chat/chat.ts";
import { reduck, type Runner } from "../task.ts";

type Posted = { role: string | null; type: string; kind: string | null; text: string | null; createdAt: string };
type Action = {
	agent_depth: number;
	created_at: string | null;
	id: string;
	kind: string | null;
	status: string | null;
	title: string | null;
	report: string | null;
	screenshots: { mediaType: string; data: string }[];
};

/** Muse recalls its past chats and memory, so a trial starts from a reset account: once per
 *  `pnpm bench` call, before its first Muse run. The runs of one trial then share what Muse
 *  learns along the way. */
let reset: Promise<unknown> | undefined;

const muse: Runner = async (prompt, signal) => {
	await (reset ??= reduck("reduck/muse.ai/reset_muse", { confirm: "true" }));
	const asked = await reduck("reduck/muse.ai/ask", { question: prompt });
	const chat_id: string = asked.threadId;
	let chat = await reduck("reduck/muse.ai/get_chat", { chat_id });
	while (chat.chat.status !== "completed") {
		// A run past its time stops reading: the next run's Muse scripts would run beside it.
		signal.throwIfAborted();
		await new Promise((done) => setTimeout(done, 15_000));
		chat = await reduck("reduck/muse.ai/get_chat", { chat_id });
	}
	const activity = await reduck("reduck/muse.ai/get_activity", { chat_id });

	// The answer is what Muse showed, its cards included: it can put the link asked for in a card
	// and not in its text. The card of a browser task is the task's title, not an answer.
	const shown = (chat.messages as Posted[]).filter(
		(m) => m.role === "assistant" && m.type !== "event" && m.text && m.kind !== "browser_task"
	);
	const actions: Action[] = activity.tasks.flatMap((t: { steps: Action[] }) => t.steps);
	const steps: Step[] = [
		...shown.map((m): Step => ({ kind: "text", at: m.createdAt, text: m.text! })),
		...actions.map(
			(a): Step => ({
				kind: "tool",
				at: a.created_at ?? asked.askedAt,
				end: a.created_at,
				tool: a.agent_depth ? "muse-browser" : "muse",
				input: { description: a.title, kind: a.kind, id: a.id },
				error: !/^success$/i.test(a.status ?? ""),
				result: a.report ?? "",
				images: a.screenshots
			})
		)
	].sort((x, y) => Date.parse(x.at) - Date.parse(y.at));

	// Muse's own times, not the script runs': a run starts before the question is sent, and the
	// chat is read some time after Muse's last message.
	const start = asked.askedAt ?? steps[0]?.at;
	const end = shown.at(-1)?.createdAt ?? start;
	const answer = shown.map((m) => m.text).join("\n\n");
	return {
		id: chat_id,
		path: asked.url,
		title: null,
		ask: prompt,
		answer,
		start,
		end,
		durationMs: Date.parse(end) - Date.parse(start),
		models: [],
		turns: 0,
		steps,
		tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		context: { start: 0, peak: 0, end: 0 },
		cost: null
	};
};

export default { muse };
