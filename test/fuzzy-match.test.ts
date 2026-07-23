import { expect, test } from "bun:test";
import {
	bestFuzzyMatch,
	levenshteinDistance,
	similarityRatio,
} from "../src/candidate/fuzzy-match";

test("levenshteinDistance returns zero for identical strings", () => {
	expect(levenshteinDistance("เชียงใหม่", "เชียงใหม่")).toBe(0);
	expect(levenshteinDistance("", "")).toBe(0);
});

test("levenshteinDistance treats an empty string as the length of the other", () => {
	expect(levenshteinDistance("", "เชียงใหม่")).toBe(9);
	expect(levenshteinDistance("เชียงใหม่", "")).toBe(9);
});

test("levenshteinDistance counts a single dropped vowel as one edit", () => {
	expect(levenshteinDistance("เชียงใหม่", "เชยงใหม่")).toBe(1);
});

test("levenshteinDistance counts a single substituted character as one edit", () => {
	expect(levenshteinDistance("สันทราย", "สันทาย")).toBe(1);
	expect(levenshteinDistance("ศรีภูมิ", "ศรีพูมิ")).toBe(1);
});

test("similarityRatio scores identical strings at 100", () => {
	expect(similarityRatio("เชียงใหม่", "เชียงใหม่")).toBe(100);
});

test("similarityRatio treats two empty strings as a perfect match", () => {
	expect(similarityRatio("", "")).toBe(100);
});

test("similarityRatio scores an empty string against non-empty text at zero", () => {
	expect(similarityRatio("", "เชียงใหม่")).toBe(0);
});

test("similarityRatio scores a single dropped vowel highly", () => {
	const ratio = similarityRatio("เชียงใหม่", "เชยงใหม่");
	expect(ratio).toBeCloseTo((16 / 17) * 100, 5);
	expect(ratio).toBeGreaterThanOrEqual(80);
});

test("similarityRatio scores unrelated strings low", () => {
	const ratio = similarityRatio("เชียงใหม่", "สงขลา");
	expect(ratio).toBeLessThan(50);
});

test("bestFuzzyMatch returns the exact option at 100 similarity", () => {
	const options = [{ text: "ปทุมวัน" }, { text: "เชียงใหม่" }];
	const match = bestFuzzyMatch("เชียงใหม่", options, 80);

	expect(match?.option.text).toBe("เชียงใหม่");
	expect(match?.similarity).toBe(100);
});

test("bestFuzzyMatch picks the highest-scoring option among several typo-close candidates", () => {
	const options = [
		{ text: "สงขลา" },
		{ text: "สันทราย" },
		{ text: "สันป่าตอง" },
	];
	const match = bestFuzzyMatch("สันทาย", options, 80);

	expect(match?.option.text).toBe("สันทราย");
});

test("bestFuzzyMatch returns null when nothing clears the similarity threshold", () => {
	const options = [{ text: "เชียงใหม่" }, { text: "สงขลา" }];
	const match = bestFuzzyMatch("นครราชสีมา", options, 80);

	expect(match).toBeNull();
});

test("bestFuzzyMatch returns null on an empty option list", () => {
	expect(bestFuzzyMatch("เชียงใหม่", [], 80)).toBeNull();
});

test("bestFuzzyMatch skips zero-length option text", () => {
	expect(bestFuzzyMatch("เชียงใหม่", [{ text: "" }], 0)).toBeNull();
});

test("bestFuzzyMatch's length-difference prefilter skips an option more than 50% longer, even at a near-zero threshold", () => {
	const shortText = "วัน";
	const muchLongerOption = { text: "ปทุมวันเหนือเขตดีงาม" };

	expect(bestFuzzyMatch(shortText, [muchLongerOption], 1)).toBeNull();
});

test("bestFuzzyMatch does not fall back to substring search once the prefilter rejects an option", () => {
	const shortText = "ใหม่";
	const optionContainingItAsSubstring = { text: "เชียงใหม่เหนือใต้ออกตก" };

	expect(
		bestFuzzyMatch(shortText, [optionContainingItAsSubstring], 1),
	).toBeNull();
});

test("bestFuzzyMatch keeps an option within the length-difference allowance and scores it by whole-string ratio", () => {
	const options = [{ text: "ศรีภูมิ" }];
	const match = bestFuzzyMatch("ศรีพูมิ", options, 80);

	expect(match?.option.text).toBe("ศรีภูมิ");
	expect(match?.similarity).toBeCloseTo((13 / 14) * 100, 5);
});
