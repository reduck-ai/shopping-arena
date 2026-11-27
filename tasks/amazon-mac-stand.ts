import { reduck, type Task } from "../task.ts";

// What the shopper asked, in the numbers a product page shows.
const MAX_PRICE = 60;
const MIN_RATING = 4;
const ASIN = /amazon\.com\/(?:[^\s)"\\]*\/)?(?:dp|gp\/product)\/([A-Z0-9]{10})/g;

export default {
	id: "amazon-mac-stand",
	name: "A MacBook stand on Amazon",
	prompt: 'Laptop stand for my 14" MacBook Pro, aluminum and adjustable, well rated, under $60. I order everything on Amazon.',
	// Each product the answer links is read from Amazon now: its price and its rating must fit the
	// ask. Whether it is a stand for a 14" MacBook Pro is a person's call (`set_verdict`).
	check: async ({ answer }) => {
		const asins = [...new Set([...answer.matchAll(ASIN)].map((m) => m[1]))];
		if (!asins.length) return { pass: false, detail: "no Amazon product link" };
		const pages = await Promise.all(asins.map((asin) => reduck("reduck/amazon.com/get-product", { asin })));
		const off = pages.filter((p) => !(p.price?.value <= MAX_PRICE && p.rating >= MIN_RATING));
		return {
			pass: off.length === 0,
			detail: `${asins.length} products, ${off.length} over $${MAX_PRICE} or under ${MIN_RATING} stars`
		};
	}
} satisfies Task;
