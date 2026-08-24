import { describe, expect, it } from "vitest";
import { TargetRegistry } from "../src/target_registry";

describe("target registry", () => {
	it("moves an item between target indexes without duplicates", () => {
		const registry = new TargetRegistry<object>();
		const item = {};

		registry.track(item, "a.ts");
		registry.track(item, "a.ts");
		expect(registry.get("a.ts")).toEqual([item]);

		registry.track(item, "b.ts");
		expect(registry.get("a.ts")).toEqual([]);
		expect(registry.get("b.ts")).toEqual([item]);
	});

	it("removes and clears tracked items", () => {
		const registry = new TargetRegistry<object>();
		const first = {};
		const second = {};
		registry.track(first, "a.ts");
		registry.track(second, "a.ts");

		registry.untrack(first);
		expect(registry.get("a.ts")).toEqual([second]);
		registry.clear();
		expect(registry.get("a.ts")).toEqual([]);

		registry.track(second, "a.ts");
		expect(registry.get("a.ts")).toEqual([second]);
	});
});
