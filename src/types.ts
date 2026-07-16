export const LABELS = [
	"NAME",
	"PHONE",
	"ADDRESS_DETAIL",
	"SUBDISTRICT",
	"DISTRICT",
	"PROVINCE",
	"POSTCODE",
	"OTHER",
] as const;

export type Label = (typeof LABELS)[number];
export type OutputLabel = Exclude<Label, "OTHER">;
export type FieldName =
	| "name"
	| "phone"
	| "address"
	| "subdistrict"
	| "district"
	| "province"
	| "zipcode";

export interface LocationTuple {
	readonly subdistrict: string;
	readonly district: string;
	readonly province: string;
	readonly zipcode: string;
}

export interface LabelDirection {
	readonly label: OutputLabel;
	readonly vector: readonly number[];
	readonly bias?: number;
}

export interface LatentFeatureConfig {
	readonly version: "char-ngram-v2";
	readonly minCharacterNgram: number;
	readonly maxCharacterNgram: number;
}

export interface LatentScoringConfig {
	readonly version: "label-mix-v1";
	readonly latentWeightByLabel: Readonly<Record<OutputLabel, number>>;
}

export interface ParserResources {
	readonly version: string;
	readonly featureDimension: number;
	readonly featureConfig: LatentFeatureConfig;
	readonly scoringConfig: LatentScoringConfig;
	readonly labelDirections: readonly LabelDirection[];
	readonly locations: readonly LocationTuple[];
	readonly checksum?: string;
}

export interface ParserOptions {
	readonly beamWidth?: number;
	readonly candidatesPerLabel?: number;
	readonly minFieldConfidence?: number;
	readonly diagnostics?: "summary" | "full";
}

export interface ParsedFields {
	readonly name: string | null;
	readonly phone: string | null;
	readonly address: string | null;
	readonly subdistrict: string | null;
	readonly district: string | null;
	readonly province: string | null;
	readonly zipcode: string | null;
}

export interface ParsedSpan {
	readonly label: OutputLabel;
	readonly text: string;
	readonly canonical: string;
	readonly start: number;
	readonly end: number;
	readonly confidence: number;
}

export interface Abstention {
	readonly field: FieldName;
	readonly reason:
		| "invalid-offset"
		| "low-confidence"
		| "invalid-format"
		| "inconsistent-location";
}

export interface ParseDiagnostics {
	readonly resourceVersion: string;
	readonly resourceChecksum?: string;
	readonly candidatesEvaluated: number;
	readonly hypothesesEvaluated: number;
	readonly latentScoring: "frozen-direction";
	readonly scoreSemantics: "uncalibrated-selection-score";
	readonly candidateTrace?: readonly CandidateTrace[];
	readonly candidateRejections?: readonly CandidateRejection[];
}

export interface CandidateRejection {
	readonly label: OutputLabel;
	readonly text: string;
	readonly start: number;
	readonly end: number;
	readonly ruleId: string;
}

export interface EvidenceContribution {
	readonly ruleId: string;
	readonly effect: "base" | "add" | "floor" | "reject" | "resolve";
	readonly value: number;
}

export interface CandidateTrace {
	readonly label: OutputLabel;
	readonly text: string;
	readonly canonical: string;
	readonly start: number;
	readonly end: number;
	readonly evidenceScore: number;
	readonly latentScore: number;
	readonly score: number;
	readonly evidence: readonly EvidenceContribution[];
	readonly outcome: "accepted" | "pruned" | "abstained";
	readonly reason?:
		| Abstention["reason"]
		| "below-threshold"
		| "overlap"
		| "lower-ranked"
		| "beam-pruned";
}

export interface ParseResult {
	readonly raw: string;
	readonly fields: ParsedFields;
	readonly spans: readonly ParsedSpan[];
	readonly confidence: number;
	readonly abstentions: readonly Abstention[];
	readonly diagnostics: ParseDiagnostics;
}

export interface AddressParser {
	parse(raw: string): ParseResult;
}

export interface Candidate {
	readonly label: OutputLabel;
	readonly text: string;
	readonly canonical: string;
	readonly start: number;
	readonly end: number;
	readonly latentScore: number;
	readonly evidenceScore: number;
	readonly score: number;
	readonly locationIds: readonly number[];
	readonly evidence: readonly EvidenceContribution[];
}

export interface DecodeResult {
	readonly selected: readonly Candidate[];
	readonly score: number;
	readonly hypothesesEvaluated: number;
}
