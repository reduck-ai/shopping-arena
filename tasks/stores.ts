/**
 * Which US stores an agent can shop on: one search per store, signed out, the same prompt for
 * every store. The stores are the US stores ShopDuck covers (its README), so Muse and ShopDuck are
 * compared where both could answer; the queries are stealth-bench's where it has one.
 *
 * The check asks one thing: does the answer link at least 3 products of that store, by the URL
 * shape the store gives its product pages. An agent blocked by the store, or one that answers from
 * another store, has none. Whether it was blocked, and how, is read in the session (the
 * screenshots).
 */
import type { Task } from "../task.ts";

const STORES: { host: string; name: string; query: string; product: RegExp }[] = [
	{ host: "amazon.com", name: "Amazon", query: "usb c cable", product: /amazon\.com\/(?:[^\s)"\\]*\/)?(?:dp|gp\/product)\/[A-Z0-9]{10}/ },
	{ host: "walmart.com", name: "Walmart", query: "headphones", product: /walmart\.com\/ip\/[^\s)"\\]*\d+/ },
	{ host: "bestbuy.com", name: "Best Buy", query: "headphones", product: /bestbuy\.com\/(?:site\/[^\s)"\\]+\.p|product\/[^\s)"\\]+)/ },
	{ host: "target.com", name: "Target", query: "coffee maker", product: /target\.com\/p\/[^\s)"\\]+/ },
	{ host: "lowes.com", name: "Lowe's", query: "cordless drill", product: /lowes\.com\/pd\/[^\s)"\\]+/ },
	{ host: "etsy.com", name: "Etsy", query: "ceramic mug", product: /etsy\.com\/listing\/\d+/ }
];

export default STORES.map(
	({ host, name, query, product }): Task => ({
		id: `store-${host.split(".")[0]}`,
		name: `Search ${name}`,
		prompt: `On ${host}, search for "${query}" and give me the first 5 results in the order ${name} lists them: name, price and link for each.`,
		check: ({ answer }) => {
			const links = new Set([...answer.matchAll(new RegExp(product, "g"))].map((m) => m[0]));
			return {
				pass: links.size >= 3,
				detail: `${links.size} ${name} product links`
			};
		}
	})
);
