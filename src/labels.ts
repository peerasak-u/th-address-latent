import type { FieldName, OutputLabel } from "./types";

export const OUTPUT_LABELS: readonly OutputLabel[] = [
  "PROVINCE",
  "DISTRICT",
  "SUBDISTRICT",
  "POSTCODE",
  "PHONE",
  "NAME",
  "ADDRESS_DETAIL",
];

export function labelToField(label: OutputLabel): FieldName {
  switch (label) {
    case "NAME": return "name";
    case "PHONE": return "phone";
    case "ADDRESS_DETAIL": return "address";
    case "SUBDISTRICT": return "subdistrict";
    case "DISTRICT": return "district";
    case "PROVINCE": return "province";
    case "POSTCODE": return "zipcode";
  }
}
