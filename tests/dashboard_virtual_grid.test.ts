import { describe, expect, it } from "vitest";
import { calculateVirtualGridWindow } from "../src/dashboard_virtual_grid";

describe("calculateVirtualGridWindow", () => {
	it("keeps rendered indexes bounded for ten thousand items", () => {
		const result = calculateVirtualGridWindow({
			itemCount: 10_000,
			containerWidth: 1400,
			scrollTop: 50_000,
			viewportHeight: 900,
			minCardWidth: 320,
			rowHeight: 88,
			gap: 14,
			overscanRows: 4,
		});

		expect(result.columns).toBe(4);
		expect(result.endIndex - result.startIndex).toBeLessThan(100);
		expect(result.totalRows).toBe(2500);
	});

	it("handles empty and narrow single-column layouts", () => {
		const input = {
			itemCount: 0,
			containerWidth: 300,
			scrollTop: 0,
			viewportHeight: 600,
			minCardWidth: 320,
			rowHeight: 88,
			gap: 14,
			overscanRows: 4,
		};
		const empty = calculateVirtualGridWindow(input);
		expect(empty).toMatchObject({ columns: 1, totalRows: 0, startIndex: 0, endIndex: 0, totalHeight: 0 });

		const narrow = calculateVirtualGridWindow({ ...input, itemCount: 100 });
		expect(narrow.columns).toBe(1);
		expect(narrow.endIndex).toBeLessThan(20);
	});
});
