import type { TFile } from "obsidian";
import { describe, expect, it } from "vitest";
import { DashboardFileIndex } from "../src/dashboard_file_index";

function file(path: string, mtime: number): TFile {
	const name = path.split("/").pop() ?? path;
	const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";
	const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "/";
	return { path, name, extension, parent: { path: parentPath }, stat: { mtime } } as TFile;
}

describe("DashboardFileIndex", () => {
	it("indexes managed files and applies cached filters", () => {
		const index = new DashboardFileIndex({
			extensions: ["ts", "py"],
			ignoredPaths: ["ignored"],
			externalMountPaths: ["External/research"],
		});
		index.rebuild([
			file("src/main.ts", 10),
			file("src/tool.py", 20),
			file("ignored/skip.ts", 30),
			file("External/research/run.py", 40),
			file("notes/readme.md", 50),
		]);

		expect(index.size).toBe(3);
		const result = index.derive({ searchQuery: "run", filterExt: [], filterFolder: [], sortBy: "name", sortDesc: false });
		expect(result.map((record) => record.path)).toEqual(["External/research/run.py"]);
		expect(result[0]?.isExternal).toBe(true);
	});

	it("repositions one modified record in date order", () => {
		const index = new DashboardFileIndex({ extensions: ["ts"], ignoredPaths: [], externalMountPaths: [] });
		const first = file("a.ts", 10);
		const second = file("b.ts", 20);
		index.rebuild([first, second]);
		const state = { searchQuery: "", filterExt: [], filterFolder: [], sortBy: "date" as const, sortDesc: true };
		const visible = index.derive(state);
		first.stat.mtime = 30;
		const updated = index.upsert(first);

		expect(updated).not.toBeNull();
		expect(index.reposition(visible, updated!, state).map((record) => record.path)).toEqual(["a.ts", "b.ts"]);
	});

	it("filters a ten-thousand-file index without rebuilding source records", () => {
		const index = new DashboardFileIndex({ extensions: ["ts"], ignoredPaths: [], externalMountPaths: [] });
		index.rebuild(Array.from({ length: 10_000 }, (_, itemIndex) => file(`src/file-${itemIndex}.ts`, itemIndex)));

		const result = index.derive({
			searchQuery: "file-9999",
			filterExt: ["ts"],
			filterFolder: ["src"],
			sortBy: "name",
			sortDesc: false,
		});
		expect(result.map((record) => record.path)).toEqual(["src/file-9999.ts"]);
		expect(index.size).toBe(10_000);
	});
});
