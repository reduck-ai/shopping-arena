/**
 * What a shopper asks without naming a store: finding where to buy is the job. A category, an exact
 * product, a deal.
 *
 * No check: the right answer moves with every store's prices and stock, so a person reads the
 * session and gives the verdict (`set_verdict`).
 *
 * Tasks that touch your own accounts belong in `tasks/private/` (git-ignored). Give them a
 * `requires` that pins the exact account each site must be signed in as, so a run on the wrong
 * session is skipped instead of scored:
 *
 *   requires: () => all([signedInAs("X", "reduck/x.com/whoami", (r) => r.handle, process.env.ARENA_X_HANDLE!)])
 */
import type { Task } from "../task.ts";

export default [
	{ id: "laptop-college", name: "A laptop for college", prompt: "A laptop for my son starting college, under $700." },
	{ id: "airpods-pro-3", name: "AirPods Pro 3 at the best price", prompt: "Where are AirPods Pro 3 cheapest right now?" },
	{ id: "yeti-deals", name: "YETI tumbler deals", prompt: "Any good deals on a YETI tumbler?" }
] satisfies Task[];
