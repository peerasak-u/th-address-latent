import { createCandidateEngine } from "../candidates";
import { buildParseContext } from "../candidate/context";
import { labelToField } from "../labels";
import { buildLocationTerms } from "../location-index";
import {
	candidateFeatures,
	logit,
	sigmoid,
	sparseDot,
	spanFeatures,
	type SparseFeatureVector,
} from "./features";
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

export interface FitPairwiseResidualOptions {
	readonly epochs?: number;
	readonly learningRate?: number;
	readonly l2?: number;
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

interface RankingExample {
	readonly features: SparseFeatureVector;
	readonly baseLogit: number;
	readonly present: 0 | 1;
}

const NULL_EXAMPLE: RankingExample = {
	features: { indices: [], values: [] },
	baseLogit: 0,
	present: 0,
};

function trimmedGoldRange(record: CandidateTrainingRecord, label: OutputLabel): {
	readonly start: number;
	readonly end: number;
} | null {
	const span = record.spans.find((candidate) => candidate.label === label);
	if (!span) return null;
	let start = span.start;
	let end = span.end;
	while (start < end && /\s/u.test(record.raw[start] ?? "")) start += 1;
	while (end > start && /\s/u.test(record.raw[end - 1] ?? "")) end -= 1;
	return start < end ? { start, end } : null;
}

/**
 * Fits a small discriminative ranker while preserving deterministic evidence
 * as the base logit. Positives are matched by source offsets, not canonical
 * equality, so normalization and span selection remain separate concerns.
 */
export function fitPairwiseResidualDirections(
	records: readonly CandidateTrainingRecord[],
	resources: ParserResources,
	options: FitPairwiseResidualOptions = {},
): readonly LabelDirection[] {
	if (resources.featureConfig.version !== "candidate-hash-v3") {
		throw new Error("pairwise residual fitting requires candidate-hash-v3");
	}
	if (resources.scoringConfig.version !== "residual-rank-v2") {
		throw new Error("pairwise residual fitting requires residual-rank-v2");
	}
	const residualScaleByLabel = resources.scoringConfig.residualScaleByLabel;
	const epochs = options.epochs ?? 6;
	const learningRate = options.learningRate ?? 0.04;
	const l2 = options.l2 ?? 1e-5;
	const maxNegatives = options.maxNegativesPerLabelPerRecord ?? 8;
	if (!Number.isInteger(epochs) || epochs <= 0) throw new Error("epochs must be positive");
	if (!(learningRate > 0)) throw new Error("learningRate must be positive");
	if (!(l2 >= 0)) throw new Error("l2 must be non-negative");
	if (!Number.isInteger(maxNegatives) || maxNegatives <= 0) {
		throw new Error("maxNegativesPerLabelPerRecord must be positive");
	}

	const dimension = resources.featureDimension;
	const activeLabels = OUTPUT_LABELS.filter(
		(label) => (residualScaleByLabel[label] ?? 0) > 0,
	);
	const weights = new Map(
		activeLabels.map((label) => [label, new Float64Array(dimension)]),
	);
	const biases = new Map(activeLabels.map((label) => [label, 0]));
	const engine = createCandidateEngine({ ...resources, labelDirections: [] });
	const locationTerms = buildLocationTerms(resources.locations);

	function update(
		label: OutputLabel,
		positive: RankingExample,
		negative: RankingExample,
		rate: number,
	): void {
		const vector = weights.get(label);
		if (!vector) return;
		const bias = biases.get(label) ?? 0;
		const presenceDelta = positive.present - negative.present;
		const margin =
			positive.baseLogit -
			negative.baseLogit +
			sparseDot(positive.features, vector) -
			sparseDot(negative.features, vector) +
			bias * presenceDelta;
		const gradient = sigmoid(-margin);
		const deltas = new Map<number, number>();
		for (let offset = 0; offset < positive.features.indices.length; offset += 1) {
			const index = positive.features.indices[offset];
			if (index === undefined) continue;
			deltas.set(index, (deltas.get(index) ?? 0) + (positive.features.values[offset] ?? 0));
		}
		for (let offset = 0; offset < negative.features.indices.length; offset += 1) {
			const index = negative.features.indices[offset];
			if (index === undefined) continue;
			deltas.set(index, (deltas.get(index) ?? 0) - (negative.features.values[offset] ?? 0));
		}
		for (const [index, delta] of deltas) {
			vector[index] =
				(vector[index] ?? 0) +
				rate * (gradient * delta - l2 * (vector[index] ?? 0));
		}
		biases.set(label, bias + rate * gradient * presenceDelta);
	}

	for (let epoch = 0; epoch < epochs; epoch += 1) {
		const epochRate = learningRate / Math.sqrt(epoch + 1);
		for (const [recordIndex, record] of records.entries()) {
			const recordWeight = options.recordWeight?.(record, recordIndex) ?? 1;
			if (!Number.isFinite(recordWeight) || recordWeight < 0) {
				throw new Error("record weights must be finite and non-negative");
			}
			if (recordWeight === 0) continue;
			const context = buildParseContext(record.raw, locationTerms);
			const generated = engine.generate(record.raw).candidates;
			for (const label of activeLabels) {
				const gold = trimmedGoldRange(record, label);
				const choices = generated.filter((candidate) => candidate.label === label);
				const positives = gold
					? choices.filter(
						(candidate) => candidate.start === gold.start && candidate.end === gold.end,
					)
					: [];
				const positiveKeys = new Set(
					positives.map((candidate) => `${candidate.start}\u0000${candidate.end}`),
				);
				const negatives = choices
					.filter(
						(candidate) => !positiveKeys.has(`${candidate.start}\u0000${candidate.end}`),
					)
					.sort((left, right) => right.evidenceScore - left.evidenceScore)
					.slice(0, maxNegatives);
				const example = (candidate: (typeof choices)[number]): RankingExample => ({
					features: candidateFeatures(
						{
							context,
							label,
							start: candidate.start,
							end: candidate.end,
							source: candidate.source ?? "segment",
							evidenceScore: candidate.evidenceScore,
							evidence: candidate.evidence,
							locationIds: candidate.locationIds,
						},
						resources.featureDimension,
						resources.featureConfig,
					),
					baseLogit: logit(candidate.evidenceScore),
					present: 1,
				});
				const rate = epochRate * recordWeight;
				if (gold && positives.length > 0) {
					for (const positive of positives) {
						const positiveExample = example(positive);
						update(label, positiveExample, NULL_EXAMPLE, rate);
						for (const negative of negatives) {
							update(label, positiveExample, example(negative), rate);
						}
					}
				} else if (!gold) {
					for (const negative of negatives) {
						update(label, NULL_EXAMPLE, example(negative), rate);
					}
				}
			}
		}
	}

	return activeLabels.map((label) => ({
		label,
		vector: Array.from(weights.get(label) ?? []),
		bias: biases.get(label) ?? 0,
	}));
}
