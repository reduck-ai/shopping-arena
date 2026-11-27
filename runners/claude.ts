/**
 * Claude Code through the Agent SDK (the `claude_code` system prompt), with one browser tool:
 * Reduck as its only MCP server, or Claude in Chrome (`--chrome`). The two differ in that tool
 * and in one sentence put before the prompt. `--strict-mcp-config` and
 * ENABLE_CLAUDEAI_MCP_SERVERS=false keep the claude.ai connectors (which include Reduck) out of
 * both. The session starts in a fresh empty directory outside the repo, and its conversation is
 * the transcript Claude Code wrote (session.ts).
 *
 * REDUCK_MCP_URL picks the Reduck MCP; REDUCK_API_KEY, when set, is used instead of the Reduck
 * CLI's OAuth login (reduck-auth.ts).
 */
import { query, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reduckHeaders } from "../reduck-auth.ts";
import { parseSession, projectDir } from "../session.ts";
import type { Runner } from "../task.ts";

const REDUCK_MCP = process.env.REDUCK_MCP_URL ?? "https://mcp.reduck.ai";
/** How long the Reduck CLI's token must still live when a run starts: longer than a run. */
const TOKEN_MS = 30 * 60_000;

const claude =
	(arm: "reduck" | "chrome", say: string): Runner =>
	async (prompt, signal) => {
		const cwd = realpathSync(mkdtempSync(join(tmpdir(), `arena-${arm}-`)));
		const abortController = new AbortController();
		signal.addEventListener("abort", () => abortController.abort());
		let sessionId = "";
		let result: SDKResultMessage | undefined;
		for await (const m of query({
			prompt: `${say}\n${prompt}`,
			options: {
				cwd,
				abortController,
				systemPrompt: { type: "preset", preset: "claude_code" },
				settingSources: [],
				permissionMode: "bypassPermissions",
				allowDangerouslySkipPermissions: true,
				// Nobody is there to answer.
				disallowedTools: ["AskUserQuestion"],
				env: { ...process.env, ENABLE_CLAUDEAI_MCP_SERVERS: "false" },
				extraArgs: { "strict-mcp-config": null, [arm === "chrome" ? "chrome" : "no-chrome"]: null },
				mcpServers:
					arm === "reduck"
						? { reduck: { type: "http", url: `${REDUCK_MCP}/mcp`, headers: reduckHeaders(REDUCK_MCP, TOKEN_MS) } }
						: {}
			}
		})) {
			sessionId ||= m.session_id ?? "";
			if (m.type === "result") result = m;
		}
		if (result?.subtype !== "success") throw new Error(result?.subtype ?? "no result");
		return parseSession(join(projectDir(cwd), `${sessionId}.jsonl`));
	};

export default {
	reduck: claude("reduck", "Use Reduck MCP."),
	chrome: claude("chrome", "Use Claude for Chrome MCP.")
};
