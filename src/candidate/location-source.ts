import type { LocationTerm } from "../location-index";
import type { CandidateRejection, LocationTuple } from "../types";
import type { ParseContext } from "./context";
import type { CandidateSeedStore } from "./seed-store";

export function addLocationCandidates(
	context: ParseContext,
	locationTerms: readonly LocationTerm[],
	locations: readonly LocationTuple[],
	store: CandidateSeedStore,
	reject: (rejection: CandidateRejection) => void,
): void {
	const {
		raw,
		provinceHint,
		phoneRanges,
		administrativeRanges,
		addressHintRanges,
		addressLabels,
	} = context;
	for (const term of locationTerms) {
		let from = 0;
		while (from <= raw.length - term.surface.length) {
			const start = raw.indexOf(term.surface, from);
			if (start < 0) break;
			const end = start + term.surface.length;
			const location = locations[term.locationId];
			const cityStart = raw.indexOf("เมือง", end);
			const provinceStart = location
				? raw.indexOf(
					location.province,
					cityStart < 0 ? end : cityStart + "เมือง".length,
				)
				: -1;
			const hasCityProvinceSequence =
				location !== undefined &&
				provinceHint !== undefined &&
				location.province === provinceHint &&
				((term.label === "SUBDISTRICT" &&
					cityStart >= end &&
					provinceStart > cityStart) ||
					(term.label === "DISTRICT" &&
						term.surface === "เมือง" &&
						raw.slice(0, start).includes(location.subdistrict) &&
						provinceStart > start));
			const isProvinceHint =
				term.label === "PROVINCE" && term.surface === provinceHint;
			if (
				term.label === "DISTRICT" &&
				term.surface === "เมือง" &&
				!(
					provinceHint !== undefined &&
					location?.province === provinceHint &&
					(/อ\.\s*$/u.test(raw.slice(0, start)) || hasCityProvinceSequence)
				)
			) {
				reject({
					label: "DISTRICT",
					text: term.surface,
					start,
					end,
					ruleId: "location.city-unscoped",
				});
				from = start + Math.max(1, term.surface.length);
				continue;
			}
			if (
				phoneRanges.some((phone) => start < phone.start) ||
				(() => {
					const firstAdminAfterPhone = administrativeRanges.find((admin) =>
						phoneRanges.some((phone) => admin.start > phone.end),
					);
					const firstAdminAfterAddress = administrativeRanges.find(
						(admin) => admin.start > start,
					);
					const startsInAddressContext =
						addressHintRanges.some((hint) => start >= hint.start) ||
						addressLabels.some((label) => start >= label.end);
					return (
						(firstAdminAfterPhone !== undefined &&
							phoneRanges.some((phone) => start > phone.end) &&
							start < firstAdminAfterPhone.start &&
							!hasCityProvinceSequence &&
							!isProvinceHint) ||
						(firstAdminAfterAddress !== undefined &&
							startsInAddressContext &&
							!administrativeRanges.some((admin) => admin.start <= start) &&
							!hasCityProvinceSequence &&
							!isProvinceHint)
					);
				})()
			) {
				reject({
					label: term.label,
					text: term.surface,
					start,
					end,
					ruleId: "location.outside-administrative-context",
				});
				from = start + Math.max(1, term.surface.length);
				continue;
			}
			if (
				term.label === "POSTCODE" &&
				(/\d/u.test(raw[start - 1] ?? "") || /\d/u.test(raw[end] ?? ""))
			) {
				reject({
					label: "POSTCODE",
					text: term.surface,
					start,
					end,
					ruleId: "postcode.embedded-number",
				});
				from = start + Math.max(1, term.surface.length);
				continue;
			}
			store.add({
				label: term.label,
				start,
				end,
				canonical: term.canonical,
				evidence: 0.96,
				locationId: term.locationId,
				evidenceTrace: [
					{
						ruleId:
							term.label === "DISTRICT" && term.surface === "เมือง"
								? "location.city-resolved"
								: "location.gazetteer",
						effect:
							term.label === "DISTRICT" && term.surface === "เมือง"
								? "resolve"
								: "base",
						value: 0.96,
					},
				],
			});
			from = start + Math.max(1, term.surface.length);
		}
	}
}
