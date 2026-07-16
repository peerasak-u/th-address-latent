import { normalizeCandidate } from "../normalize";
import type { ParseContext } from "./context";
import { overlaps } from "./context";
import type { CandidateSeedStore } from "./seed-store";

export function addStructuredCandidates(
	context: ParseContext,
	store: CandidateSeedStore,
): void {
	for (const range of context.phoneRanges) {
		const canonical = normalizeCandidate(
			"PHONE",
			context.raw.slice(range.start, range.end),
		);
		if (!canonical) continue;
		store.add({
			label: "PHONE",
			...range,
			canonical,
			evidence: 0.99,
			evidenceTrace: [
				{ ruleId: "phone.pattern", effect: "base", value: 0.99 },
			],
		});
	}

	for (const range of context.postcodeRanges) {
		if (context.phoneRanges.some((phone) => overlaps(phone, range))) continue;
		store.add({
			label: "POSTCODE",
			...range,
			canonical: context.raw.slice(range.start, range.end),
			evidence: 0.94,
			evidenceTrace: [
				{ ruleId: "postcode.pattern", effect: "base", value: 0.94 },
			],
		});
	}
}
