import { EditorState } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";
import { describe, expect, it } from "vitest";
import {
	collectSearchMatches,
	findNextSearchMatch,
	findPreviousSearchMatch,
	selectionMatchesQuery,
} from "../src/search_utils";

describe("search utilities", () => {
	it("handles zero-length regular expressions without looping", () => {
		const doc = EditorState.create({ doc: "aba" }).doc;
		const query = new SearchQuery({ search: "(?=a)", regexp: true });

		expect(collectSearchMatches(query, doc)).toEqual([
			{ from: 0, to: 0 },
			{ from: 2, to: 2 },
		]);
	});

	it("returns no matches for an invalid regular expression", () => {
		const doc = EditorState.create({ doc: "abc" }).doc;
		const query = new SearchQuery({ search: "[", regexp: true });

		expect(query.valid).toBe(false);
		expect(collectSearchMatches(query, doc)).toEqual([]);
	});

	it("finds next and previous matches with wrapping", () => {
		const doc = EditorState.create({ doc: "one two one" }).doc;
		const query = new SearchQuery({ search: "one" });

		expect(findNextSearchMatch(query, doc, 4)).toEqual({ from: 8, to: 11 });
		expect(findNextSearchMatch(query, doc, 11)).toEqual({ from: 0, to: 3 });
		expect(findPreviousSearchMatch(query, doc, 8)).toEqual({ from: 0, to: 3 });
		expect(findPreviousSearchMatch(query, doc, 0)).toEqual({ from: 8, to: 11 });
	});

	it("uses the query rules when validating a selected match", () => {
		const doc = EditorState.create({ doc: "Cat scatter cat" }).doc;
		const query = new SearchQuery({ search: "cat", wholeWord: true });

		expect(selectionMatchesQuery(query, doc, 0, 3)).toBe(true);
		expect(selectionMatchesQuery(query, doc, 5, 8)).toBe(false);
	});
});
