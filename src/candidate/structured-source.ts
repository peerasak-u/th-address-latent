import { normalizeCandidate } from "../normalize";
import type { LocationTuple } from "../types";
import { addAdministrativeValueCandidates } from "./administrative-source";
import type { ParseContext } from "./context";
import { overlaps } from "./context";
import { addRecipientCandidates } from "./recipient-source";
import type { CandidateSeed, CandidateSeedStore } from "./seed-store";

export function addStructuredCandidates(
	context: ParseContext,
	locations: readonly LocationTuple[],
	store: CandidateSeedStore,
): void {
	addRecipientCandidates(context, store);
	addAdministrativeValueCandidates(context, locations, store);

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
		const canonical = normalizeCandidate(
			"POSTCODE",
			context.raw.slice(range.start, range.end),
		);
		if (!canonical) continue;
		const base = {
			label: "POSTCODE",
			...range,
			canonical,
			evidence: 0.94,
			evidenceTrace: [
				{ ruleId: "postcode.pattern", effect: "base", value: 0.94 },
			],
		} satisfies CandidateSeed;
		const locationIds = locations.flatMap((location, locationId) =>
			location.zipcode === canonical ? [locationId] : [],
		);
		if (locationIds.length === 0) store.add(base);
		for (const locationId of locationIds) store.add({ ...base, locationId });
	}
}
