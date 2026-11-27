/**
 * What a shopper asks without naming a store: finding where to buy is the job. A category, an exact
 * product, a deal. Each in the US and in Germany, with the country said, so every agent shops
 * where the shopper lives.
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
	{ id: "laptop-us", name: "A laptop for college, US", prompt: "A light Windows laptop for my son starting college, for essays and Zoom, under $700. We're in the US." },
	{ id: "laptop-de", name: "A laptop for college, Germany", prompt: "Ein leichter Windows-Laptop für meinen Sohn zum Studienbeginn, für Hausarbeiten und Zoom, bis 700 €. Wir wohnen in Deutschland." },
	{ id: "airpods-us", name: "AirPods Pro 3 at the best price, US", prompt: "Where are AirPods Pro 3 cheapest in the US right now?" },
	{ id: "airpods-de", name: "AirPods Pro 3 at the best price, Germany", prompt: "Wo sind AirPods Pro 3 in Deutschland gerade am günstigsten?" },
	{ id: "yeti-us", name: "YETI tumbler deals, US", prompt: "Any good deals on a YETI tumbler in the US?" },
	{ id: "yeti-de", name: "YETI tumbler deals, Germany", prompt: "Gibt es in Deutschland gerade gute Angebote für einen YETI-Becher?" }
] satisfies Task[];
