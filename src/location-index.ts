import type { LocationTuple, OutputLabel } from "./types";

export interface LocationTerm {
  readonly label: Extract<OutputLabel, "SUBDISTRICT" | "DISTRICT" | "PROVINCE" | "POSTCODE">;
  readonly surface: string;
  readonly canonical: string;
  readonly locationId: number;
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
