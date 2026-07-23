import type { LocationTuple, OutputLabel } from "./types";

export interface LocationTerm {
  readonly label: Extract<OutputLabel, "SUBDISTRICT" | "DISTRICT" | "PROVINCE" | "POSTCODE">;
  readonly surface: string;
  readonly canonical: string;
  readonly locationId: number;
}

export type AdministrativeLabel = Extract<
	OutputLabel,
	"SUBDISTRICT" | "DISTRICT" | "PROVINCE"
>;

export interface FuzzyLocationIndex {
	readonly byLabel: ReadonlyMap<AdministrativeLabel, readonly LocationTerm[]>;
	readonly byLabelAndProvince: ReadonlyMap<string, readonly LocationTerm[]>;
}

/** Compiled once per parser: groups gazetteer terms by label, and by label+province for province-scoped fuzzy lookup. */
export function buildFuzzyLocationIndex(
	terms: readonly LocationTerm[],
	locations: readonly LocationTuple[],
): FuzzyLocationIndex {
	const byLabel = new Map<AdministrativeLabel, LocationTerm[]>();
	const byLabelAndProvince = new Map<string, LocationTerm[]>();
	for (const term of terms) {
		if (term.label === "POSTCODE") continue;
		const list = byLabel.get(term.label) ?? [];
		list.push(term);
		byLabel.set(term.label, list);
		const province = locations[term.locationId]?.province;
		if (province) {
			const key = `${term.label} ${province}`;
			const scoped = byLabelAndProvince.get(key) ?? [];
			scoped.push(term);
			byLabelAndProvince.set(key, scoped);
		}
	}
	return { byLabel, byLabelAndProvince };
}

export function buildLocationTerms(locations: readonly LocationTuple[]): readonly LocationTerm[] {
  const terms: LocationTerm[] = [];
  locations.forEach((location, locationId) => {
    terms.push(
      { label: "SUBDISTRICT", surface: location.subdistrict, canonical: location.subdistrict, locationId },
      { label: "DISTRICT", surface: location.district, canonical: location.district, locationId },
      { label: "PROVINCE", surface: location.province, canonical: location.province, locationId },
      { label: "POSTCODE", surface: location.zipcode, canonical: location.zipcode, locationId },
    );
    if (location.district.startsWith("เมือง") && location.district !== "เมือง") {
      terms.push({
        label: "DISTRICT",
        surface: "เมือง",
        canonical: location.district,
        locationId,
      });
    }
    if (location.province === "กรุงเทพมหานคร") {
      terms.push(
        { label: "PROVINCE", surface: "กรุงเทพ", canonical: location.province, locationId },
        { label: "PROVINCE", surface: "กทม.", canonical: location.province, locationId },
        { label: "PROVINCE", surface: "กทม", canonical: location.province, locationId },
      );
    }
  });
  return terms;
}
