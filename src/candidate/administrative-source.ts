import type { LocationTuple, OutputLabel } from "../types";
import type { ParseContext } from "./context";
import type { CandidateSeed, CandidateSeedStore } from "./seed-store";

interface StructuredValues {
	readonly subdistrict: string | undefined;
	readonly district: string | undefined;
	readonly province: string | undefined;
	readonly postcode: string | undefined;
}

const STRUCTURED_SUFFIXES = [
	/แขวง(?<subdistrict>.+?)\s+เขต(?<district>.+?)\s+(?<province>กรุงเทพมหานคร)\s+(?<postcode>\d{5})(?=$|\n|\|)/gu,
	/ตำบล(?<subdistrict>.+?)\s+อำเภอ(?<district>.+?)\s+จังหวัด(?<province>.+?)\s+(?<postcode>\d{5})(?=$|\n|\|)/gu,
] as const;

const STRUCTURED_FIELDS = [
	["subdistrict", "subdistrict", "SUBDISTRICT"],
	["district", "district", "DISTRICT"],
	["province", "province", "PROVINCE"],
	["postcode", "zipcode", "POSTCODE"],
] as const satisfies readonly [
	keyof StructuredValues,
	keyof LocationTuple,
	OutputLabel,
][];

function resolveTupleIds(
	values: StructuredValues,
	locations: readonly LocationTuple[],
): readonly number[] {
	const exact = locations.flatMap((location, locationId) =>
		STRUCTURED_FIELDS.every(
			([group, field]) => location[field] === values[group],
		)
			? [locationId]
			: [],
	);
	if (exact.length > 0) return exact;
	const withoutSubdistrict = locations.flatMap((location, locationId) =>
		location.district === values.district &&
			location.province === values.province &&
			location.zipcode === values.postcode
			? [locationId]
			: [],
	);
	if (withoutSubdistrict.length > 0) return withoutSubdistrict;
	return locations.flatMap((location, locationId) =>
		location.province === values.province &&
			location.zipcode === values.postcode
			? [locationId]
			: [],
	);
}

function addStructuredSuffixes(
	context: ParseContext,
	locations: readonly LocationTuple[],
	store: CandidateSeedStore,
): void {
	for (const pattern of STRUCTURED_SUFFIXES) {
		for (const match of context.raw.matchAll(pattern)) {
			if (match.index === undefined || !match.groups) continue;
			const values: StructuredValues = {
				subdistrict: match.groups.subdistrict?.trim(),
				district: match.groups.district?.trim(),
				province: match.groups.province?.trim(),
				postcode: match.groups.postcode?.trim(),
			};
			if (Object.values(values).some((value) => !value)) continue;
			const tupleIds = resolveTupleIds(values, locations);
			let cursor = match.index;
			for (const [group, , label] of STRUCTURED_FIELDS) {
				const canonical = values[group];
				if (!canonical) continue;
				const start = context.raw.indexOf(canonical, cursor);
				if (start < 0 || start >= match.index + match[0].length) continue;
				const end = start + canonical.length;
				cursor = end;
				const base = {
					label,
					start,
					end,
					canonical,
					evidence: 0.995,
					evidenceTrace: [
						{
							ruleId: "location.structured-tuple",
							effect: "resolve" as const,
							value: 0.995,
						},
					],
				};
				if (tupleIds.length === 0) {
					store.add(base);
					continue;
				}
				for (const locationId of tupleIds) {
					store.add({
						...base,
						locationId,
						scopeLocationId: true,
					});
				}
			}
		}
	}
}

function prefixedLabel(prefix: string): Extract<
	OutputLabel,
	"SUBDISTRICT" | "DISTRICT" | "PROVINCE"
> | null {
	const compact = prefix.replace(/\s/gu, "");
	if (/^(?:แขวง|ตำบล|ต\.?)$/u.test(compact)) return "SUBDISTRICT";
	if (/^(?:เขต|อำเภอ|อ\.?)$/u.test(compact)) return "DISTRICT";
	if (/^(?:จังหวัด|จ\.?)$/u.test(compact)) return "PROVINCE";
	return null;
}

function locationField(
	label: Extract<OutputLabel, "SUBDISTRICT" | "DISTRICT" | "PROVINCE">,
): "subdistrict" | "district" | "province" {
	if (label === "SUBDISTRICT") return "subdistrict";
	if (label === "DISTRICT") return "district";
	return "province";
}

function addPrefixedValues(
	context: ParseContext,
	locations: readonly LocationTuple[],
	store: CandidateSeedStore,
): void {
	for (const prefix of context.administrativeRanges) {
		const label = prefixedLabel(
			context.raw.slice(prefix.start, prefix.end).trim(),
		);
		if (!label) continue;
		const match = /^[ก-๙]+/u.exec(context.raw.slice(prefix.end));
		if (!match || (label === "DISTRICT" && match[0] === "เมือง")) continue;
		const start = prefix.end;
		const end = start + match[0].length;
		const canonical = match[0];
		const base = {
			label,
			start,
			end,
			canonical,
			evidence: 0.98,
			evidenceTrace: [
				{
					ruleId: "location.prefixed-value",
					effect: "base" as const,
					value: 0.98,
				},
			],
		} satisfies CandidateSeed;
		const field = locationField(label);
		const locationIds = locations.flatMap((location, locationId) =>
			location[field] === canonical ? [locationId] : [],
		);
		if (locationIds.length === 0) store.add(base);
		for (const locationId of locationIds) store.add({ ...base, locationId });
	}
}

export function addAdministrativeValueCandidates(
	context: ParseContext,
	locations: readonly LocationTuple[],
	store: CandidateSeedStore,
): void {
	addStructuredSuffixes(context, locations, store);
	addPrefixedValues(context, locations, store);
}
