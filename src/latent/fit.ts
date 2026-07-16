import { createCandidateEngine } from "../candidates";
import { labelToField } from "../labels";
import { spanFeatures } from "./features";
import type {
	LabelDirection,
	LatentFeatureConfig,
	OutputLabel,
	ParsedFields,
	ParserResources,
} from "../types";

export interface LabeledSpanRecord {
	readonly id?: string;
	readonly raw: string;
	readonly spans: readonly {
		readonly label: string;
		readonly start: number;
		readonly end: number;
	}[];
}

export interface FitLabelDirectionOptions {
	readonly includeOtherAsNegative?: boolean;
	readonly recordWeight?: (
		record: LabeledSpanRecord,
		index: number,
	) => number;
}

export interface CandidateTrainingRecord extends LabeledSpanRecord {
	readonly expected: Readonly<Record<keyof ParsedFields, string | null>>;
}

export interface FitCandidateDirectionOptions {
	readonly maxNegativesPerLabelPerRecord?: number;
	readonly recordWeight?: (
		record: CandidateTrainingRecord,
		index: number,
	) => number;
}

const OUTPUT_LABELS: readonly OutputLabel[] = [
	"NAME",
	"PHONE",
	"ADDRESS_DETAIL",
	"SUBDISTRICT",
	"DISTRICT",
	"PROVINCE",
	"POSTCODE",
];

export function fitLabelDirections(
	records: readonly LabeledSpanRecord[],
	dimension: number,
	featureConfig: LatentFeatureConfig,
	options: FitLabelDirectionOptions = {},
): readonly LabelDirection[] {
	const sums = new Map<OutputLabel, Float64Array>();
	const counts = new Map<OutputLabel, number>();
	const global = new Float64Array(dimension);
	let globalWeight = 0;
	for (const label of OUTPUT_LABELS)
		sums.set(label, new Float64Array(dimension));

	for (const [recordIndex, record] of records.entries()) {
		const weight = options.recordWeight?.(record, recordIndex) ?? 1;
		if (!Number.isFinite(weight) || weight < 0) {
			throw new Error("record weights must be finite and non-negative");
		}
		if (weight === 0) continue;
		for (const span of record.spans) {
			const isOutput = OUTPUT_LABELS.includes(span.label as OutputLabel);
			const isOtherNegative =
				options.includeOtherAsNegative === true && span.label === "OTHER";
			if (!isOutput && !isOtherNegative) continue;
			const label = span.label as OutputLabel;
			const features = spanFeatures(
				record.raw,
				span.start,
				span.end,
				dimension,
				featureConfig,
			);
			for (let index = 0; index < dimension; index += 1) {
				const value = (features[index] ?? 0) * weight;
				if (isOutput) sums.get(label)![index]! += value;
				global[index]! += value;
			}
			if (isOutput) counts.set(label, (counts.get(label) ?? 0) + weight);
			globalWeight += weight;
		}
	}

	return OUTPUT_LABELS.flatMap((label): LabelDirection[] => {
		const count = counts.get(label) ?? 0;
		if (count === 0 || globalWeight === count) return [];
		const positive = sums.get(label)!;
		const vector = new Array<number>(dimension);
		let normSquared = 0;
		for (let index = 0; index < dimension; index += 1) {
			const posMean = positive[index]! / count;
			const negMean =
				(global[index]! - positive[index]!) / (globalWeight - count);
			const value = posMean - negMean;
			vector[index] = value;
			normSquared += value * value;
		}
		const norm = Math.sqrt(normSquared) || 1;
		for (let index = 0; index < vector.length; index += 1)
			vector[index]! /= norm;
		return [{ label, vector }];
	});
}

export function fitCandidateDirections(
	records: readonly CandidateTrainingRecord[],
	resources: ParserResources,
	options: FitCandidateDirectionOptions = {},
): readonly LabelDirection[] {
	const dimension = resources.featureDimension;
	const positiveSums = new Map<OutputLabel, Float64Array>();
	const negativeSums = new Map<OutputLabel, Float64Array>();
	const positiveWeights = new Map<OutputLabel, number>();
	const negativeWeights = new Map<OutputLabel, number>();
	for (const label of OUTPUT_LABELS) {
		positiveSums.set(label, new Float64Array(dimension));
		negativeSums.set(label, new Float64Array(dimension));
	}
	const engine = createCandidateEngine({ ...resources, labelDirections: [] });
	const maxNegatives = options.maxNegativesPerLabelPerRecord ?? 32;
	if (!Number.isInteger(maxNegatives) || maxNegatives <= 0) {
		throw new Error("maxNegativesPerLabelPerRecord must be a positive integer");
	}

	function add(
		target: Float64Array,
		raw: string,
		start: number,
		end: number,
		weight: number,
	): void {
		const features = spanFeatures(
			raw,
			start,
			end,
			dimension,
			resources.featureConfig,
		);
		for (let index = 0; index < dimension; index += 1) {
			target[index]! += (features[index] ?? 0) * weight;
		}
	}

	for (const [recordIndex, record] of records.entries()) {
		const recordWeight = options.recordWeight?.(record, recordIndex) ?? 1;
		if (!Number.isFinite(recordWeight) || recordWeight < 0) {
			throw new Error("record weights must be finite and non-negative");
		}
		if (recordWeight === 0) continue;
		const candidates = engine.generate(record.raw).candidates;
		for (const label of OUTPUT_LABELS) {
			const expected = record.expected[labelToField(label)];
			const choices = candidates.filter((candidate) => candidate.label === label);
			const positives = expected === null
				? []
				: choices.filter((candidate) => candidate.canonical === expected);
			const negatives = choices
				.filter((candidate) => expected === null || candidate.canonical !== expected)
				.sort(
					(left, right) =>
						right.evidenceScore - left.evidenceScore ||
						right.score - left.score,
				)
				.slice(0, maxNegatives);
			if (positives.length > 0) {
				const weight = recordWeight / positives.length;
				for (const candidate of positives) {
					add(
						positiveSums.get(label)!,
						record.raw,
						candidate.start,
						candidate.end,
						weight,
					);
				}
				positiveWeights.set(
					label,
					(positiveWeights.get(label) ?? 0) + recordWeight,
				);
			}
			if (negatives.length > 0) {
				const weight = recordWeight / negatives.length;
				for (const candidate of negatives) {
					add(
						negativeSums.get(label)!,
						record.raw,
						candidate.start,
						candidate.end,
						weight,
					);
				}
				negativeWeights.set(
					label,
					(negativeWeights.get(label) ?? 0) + recordWeight,
				);
			}
		}
	}

	return OUTPUT_LABELS.flatMap((label): LabelDirection[] => {
		const positiveWeight = positiveWeights.get(label) ?? 0;
		const negativeWeight = negativeWeights.get(label) ?? 0;
		if (positiveWeight === 0 || negativeWeight === 0) return [];
		const positive = positiveSums.get(label)!;
		const negative = negativeSums.get(label)!;
		const vector = new Array<number>(dimension);
		let normSquared = 0;
		for (let index = 0; index < dimension; index += 1) {
			const value =
				positive[index]! / positiveWeight -
				negative[index]! / negativeWeight;
			vector[index] = value;
			normSquared += value * value;
		}
		const norm = Math.sqrt(normSquared) || 1;
		for (let index = 0; index < vector.length; index += 1) {
			vector[index]! /= norm;
		}
		return [{ label, vector }];
	});
}
