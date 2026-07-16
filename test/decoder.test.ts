import { describe, expect, test } from "bun:test";
import type { Candidate, ParseDiagnostics } from "../src/types";
import { pruneCandidates } from "../src/decode/pruner";
import { validateDecodeResult } from "../src/validate/result";

const diagnostics: ParseDiagnostics = {
	resourceVersion: "test",
	candidatesEvaluated: 1,
	hypothesesEvaluated: 1,
	latentScoring: "frozen-direction",
	scoreSemantics: "uncalibrated-selection-score",
};

function candidate(overrides: Partial<Candidate> = {}): Candidate {
	return {
		label: "PHONE",
		text: "0812345678",
		canonical: "0812345678",
		start: 0,
		end: 10,
		latentScore: 0.5,
		evidenceScore: 0.99,
		score: 0.9,
		locationIds: [],
		evidence: [],
		...overrides,
	};
}

describe("decode validation", () => {
	test("reports a selected candidate whose offsets do not reproduce its text", () => {
		const invalid = candidate({ start: 1, end: 11 });

		const result = validateDecodeResult(
			"0812345678",
			{ selected: [invalid], score: 0.9, hypothesesEvaluated: 1 },
			0.5,
			diagnostics,
		);

		expect(result.abstentions).toContainEqual({
			field: "phone",
			reason: "invalid-offset",
		});
	});
});

describe("candidate pruning", () => {
	test("prefers a coherent administrative tuple over a higher isolated score", () => {
		const province = candidate({
			label: "PROVINCE",
			text: "สกลนคร",
			canonical: "สกลนคร",
			start: 30,
			end: 36,
			score: 0.85,
			locationIds: [1],
		});
		const coherent = candidate({
			label: "DISTRICT",
			text: "เมืองสกลนคร",
			canonical: "เมืองสกลนคร",
			start: 20,
			end: 29,
			score: 0.75,
			locationIds: [1],
		});
		const incoherent = candidate({
			label: "DISTRICT",
			text: "เมืองขอนแก่น",
			canonical: "เมืองขอนแก่น",
			start: 5,
			end: 15,
			score: 0.95,
			locationIds: [2],
		});

		const decoded = pruneCandidates([province, coherent, incoherent]);

		expect(decoded.selected).toContain(coherent);
		expect(decoded.selected).not.toContain(incoherent);
	});

	test("never selects overlapping output fields", () => {
		const name = candidate({ label: "NAME", text: "สมชาย", canonical: "สมชาย" });
		const address = candidate({
			label: "ADDRESS_DETAIL",
			text: "สมชาย",
			canonical: "สมชาย",
		});

		const decoded = pruneCandidates([name, address]);

		expect(decoded.selected).toHaveLength(1);
	});
});
