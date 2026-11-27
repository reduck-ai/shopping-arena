/**
 * A store the shopper names for a reason of theirs (an account, a store nearby, a brand): the
 * stores ShopDuck covers, and stores whose anti-bot blocks cloud browsers, in the shopper's
 * language.
 *
 * The check asks that the store was reached: at least one product link of that store, by the URL
 * shape the store gives its product pages. An agent blocked by the store, or one that answers from
 * another store, has none. Whether the products fit the ask is read in the session.
 */
import type { Task } from "../task.ts";

const STORES: { host: string; name: string; prompt: string; product: RegExp }[] = [
	{ host: "amazon.com", name: "A USB-C cable on Amazon", prompt: "I have Prime in the US, find me a good USB-C cable for my MacBook charger.", product: /amazon\.com\/(?:[^\s)"\\]*\/)?(?:dp|gp\/product)\/[A-Z0-9]{10}/ },
	{ host: "walmart.com", name: "Headphones at Walmart", prompt: "Wireless over-ear headphones under $50 at Walmart, I'll pick them up in store in Austin, TX 78701.", product: /walmart\.com\/ip\/[^\s)"\\]*\d+/ },
	{ host: "bestbuy.com", name: "Headphones at Best Buy", prompt: "Noise cancelling headphones at Best Buy, I have rewards points to use.", product: /bestbuy\.com\/(?:site\/[^\s)"\\]+\.p|product\/[^\s)"\\]+)/ },
	{ host: "target.com", name: "A coffee maker at Target", prompt: "A simple coffee maker at Target, under $60.", product: /target\.com\/p\/[^\s)"\\]+/ },
	{ host: "lowes.com", name: "A drill at Lowe's", prompt: "Cordless drill for small jobs around the house, my Lowe's is in Austin, TX 78701.", product: /lowes\.com\/pd\/[^\s)"\\]+/ },
	{ host: "etsy.com", name: "A mug on Etsy", prompt: "A handmade ceramic mug on Etsy as a gift, under $35, shipped in the US.", product: /etsy\.com\/listing\/\d+/ },
	{ host: "nike.com", name: "Running shoes on Nike", prompt: "Running shoes on Nike US, men's 10, anything on sale?", product: /nike\.com\/(?:[a-z]{2}\/)?t\/[^\s)"\\]+/ },
	{ host: "ebay.com", name: "A used Switch on eBay", prompt: "A used Nintendo Switch on eBay US under $200, Buy It Now only.", product: /ebay\.com\/itm\/(?:[^\s)"\\]*\/)?\d{9,}/ },
	{ host: "homedepot.com", name: "A leaf blower at Home Depot", prompt: "A cordless leaf blower at Home Depot, I already have their 20V batteries.", product: /homedepot\.com\/p\/[^\s)"\\]+/ },
	{ host: "qvc.com", name: "A vacuum on QVC", prompt: "A cordless vacuum on QVC, I like paying with Easy Pay.", product: /qvc\.com\/[^\s)"\\]+\.product\.[^\s)"\\]+/ },
	{ host: "hm.com", name: "A sweater at H&M", prompt: "A wool sweater for women at H&M US, size M.", product: /hm\.com\/[^\s)"\\]*productpage\.\d+/ },
	{ host: "fnac.com", name: "Un casque à la Fnac", prompt: "Un casque Bluetooth à moins de 100 € à la Fnac, j'ai la carte adhérent.", product: /fnac\.com\/(?:[^\s)"\\]*\/)?a\d+/ },
	{ host: "leroymerlin.fr", name: "Des rideaux chez Leroy Merlin", prompt: "Des rideaux occultants pour le salon chez Leroy Merlin, mon magasin est à Lyon.", product: /leroymerlin\.fr\/produits\/[^\s)"\\]+/ }
];

export default STORES.map(
	({ host, name, prompt, product }): Task => ({
		id: `store-${host.split(".")[0]}`,
		name,
		prompt,
		check: ({ answer }) => {
			const links = new Set([...answer.matchAll(new RegExp(product, "g"))].map((m) => m[0]));
			return { pass: links.size >= 1, detail: `${links.size} ${host} product links` };
		}
	})
);
