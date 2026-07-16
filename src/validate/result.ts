import { labelToField } from "../labels";
import { normalizeCandidate } from "../normalize";
import type {
  Abstention,
  Candidate,
  DecodeResult,
  ParseDiagnostics,
  ParseResult,
  ParsedFields,
  ParsedSpan,
} from "../types";

const EMPTY_FIELDS: ParsedFields = {
  name: null,
  phone: null,
  address: null,
  subdistrict: null,
  district: null,
  province: null,
  zipcode: null,
};

function locationIntersection(candidates: readonly Candidate[]): readonly number[] | null {
  let current: readonly number[] | null = null;
  for (const candidate of candidates) {
    if (!["SUBDISTRICT", "DISTRICT", "PROVINCE", "POSTCODE"].includes(candidate.label)) continue;
    if (candidate.locationIds.length === 0) continue;
    if (current === null) current = candidate.locationIds;
    else {
      const allowed = new Set(candidate.locationIds);
      current = current.filter((id) => allowed.has(id));
    }
  }
  return current;
}

export function validateDecodeResult(
  raw: string,
  decoded: DecodeResult,
  minFieldConfidence: number,
  diagnostics: ParseDiagnostics,
): ParseResult {
  const fields: Record<keyof ParsedFields, string | null> = { ...EMPTY_FIELDS };
  const spans: ParsedSpan[] = [];
  const abstentions: Abstention[] = [];
  const selectedAdmin = decoded.selected.filter((candidate) =>
    ["SUBDISTRICT", "DISTRICT", "PROVINCE", "POSTCODE"].includes(candidate.label),
  );
  const evidencedAdmin = selectedAdmin.filter((candidate) => candidate.locationIds.length > 0);
  const intersection = locationIntersection(selectedAdmin);
  const postcodeWithoutTuple = selectedAdmin.some((candidate) =>
    candidate.label === "POSTCODE" &&
    candidate.locationIds.length === 0 &&
    evidencedAdmin.some((other) => other.label !== "POSTCODE"),
  );
  const locationConsistent =
    !postcodeWithoutTuple &&
    (evidencedAdmin.length <= 1 || (intersection !== null && intersection.length > 0));

	for (const candidate of decoded.selected) {
		const field = labelToField(candidate.label);
		if (
			candidate.start < 0 ||
			candidate.end > raw.length ||
			candidate.start >= candidate.end ||
			raw.slice(candidate.start, candidate.end) !== candidate.text
		) {
			abstentions.push({ field, reason: "invalid-offset" });
			continue;
		}

    if (
      !locationConsistent &&
      ["SUBDISTRICT", "DISTRICT", "PROVINCE", "POSTCODE"].includes(candidate.label)
    ) {
      abstentions.push({ field, reason: "inconsistent-location" });
      continue;
    }

    const canonical = normalizeCandidate(candidate.label, candidate.canonical);
    if (!canonical) {
      abstentions.push({ field, reason: "invalid-format" });
      continue;
    }
    const confidence = Math.max(0, Math.min(1, candidate.score));
    if (confidence < minFieldConfidence) {
      abstentions.push({ field, reason: "low-confidence" });
      continue;
    }

    fields[field] = canonical;
    spans.push({
      label: candidate.label,
      text: candidate.text,
      canonical,
      start: candidate.start,
      end: candidate.end,
      confidence,
    });
  }

  const confidence = spans.length === 0
    ? 0
    : spans.reduce((sum, span) => sum + span.confidence, 0) / spans.length;
  return {
    raw,
    fields,
    spans: spans.sort((left, right) => left.start - right.start),
    confidence,
    abstentions,
    diagnostics,
  };
}
