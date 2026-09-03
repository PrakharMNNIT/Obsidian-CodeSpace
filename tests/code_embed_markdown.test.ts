import { describe, expect, it } from "vitest";
import { sliceFileContent } from "../src/code_embed_markdown";

describe("code embed line ranges", () => {
	it("keeps an inclusive range when the source ends with a newline", () => {
		const content = Array.from({ length: 13 }, (_, index) => `line-${index + 1}`).join("\n") + "\n";

		expect(sliceFileContent(content, 2, 12)).toBe(
			Array.from({ length: 11 }, (_, index) => `line-${index + 2}`).join("\n"),
		);
	});

	it("normalizes Windows line endings in a selected range", () => {
		expect(sliceFileContent("line-1\r\nline-2\r\nline-3\r\n", 2, 3)).toBe("line-2\nline-3");
	});
});
