import type {
	CandidateSource,
	EvidenceContribution,
	LabelDirection,
	LatentFeatureConfig,
	LatentScoringConfig,
	OutputLabel,
} from "../types";
import type { ParseContext, SpanRange } from "../candidate/context";

export const DEFAULT_LATENT_FEATURE_CONFIG: LatentFeatureConfig = {
	version: "char-ngram-v2",
	minCharacterNgram: 1,
	maxCharacterNgram: 4,
};

export const DEFAULT_CANDIDATE_FEATURE_CONFIG: LatentFeatureConfig = {
	version: "candidate-hash-v3",
	minCharacterNgram: 1,
	maxCharacterNgram: 4,
	contextWindow: 12,
};

export const DEFAULT_LATENT_SCORING_CONFIG = {
	version: "label-mix-v1",
	latentWeightByLabel: {
		NAME: 0.55,
		PHONE: 0.55,
		ADDRESS_DETAIL: 0.55,
		SUBDISTRICT: 0.55,
		DISTRICT: 0.55,
		PROVINCE: 0.55,
		POSTCODE: 0.55,
	},
} as const;

export const DEFAULT_RESIDUAL_SCORING_CONFIG = {
	version: "residual-rank-v2",
	residualScaleByLabel: {
		NAME: 1,
		PHONE: 0,
		ADDRESS_DETAIL: 1,
		SUBDISTRICT: 0,
		DISTRICT: 0,
		PROVINCE: 0,
		POSTCODE: 0,
	},
	maxAbsoluteResidualLogit: 2.5,
} as const;

export function validateScoringConfig(config: LatentScoringConfig): void {
	const version: string = config.version;
	if (
		version !== "label-mix-v1" &&
		version !== "residual-rank-v2"
	) {
		throw new Error(`Unsupported latent scoring version: ${version}`);
	}
	const weights = config.version === "label-mix-v1"
		? config.latentWeightByLabel
		: config.residualScaleByLabel;
	for (const [label, weight] of Object.entries(weights)) {
		if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
			throw new Error(`scoringConfig weight for ${label} must be between zero and one`);
		}
	}
	if (
		config.version === "residual-rank-v2" &&
		(!Number.isFinite(config.maxAbsoluteResidualLogit) ||
			config.maxAbsoluteResidualLogit <= 0)
	) {
		throw new Error("maxAbsoluteResidualLogit must be positive");
	}
}

export function validateFeatureConfig(config: LatentFeatureConfig): void {
	if (
		config.version !== DEFAULT_LATENT_FEATURE_CONFIG.version &&
		config.version !== DEFAULT_CANDIDATE_FEATURE_CONFIG.version
	) {
		throw new Error(`Unsupported latent feature version: ${config.version}`);
	}
	if (
		!Number.isInteger(config.minCharacterNgram) ||
		config.minCharacterNgram < 1
	) {
		throw new Error(
			"featureConfig.minCharacterNgram must be a positive integer",
		);
	}
	if (
		!Number.isInteger(config.maxCharacterNgram) ||
		config.maxCharacterNgram < config.minCharacterNgram
	) {
		throw new Error(
			"featureConfig.maxCharacterNgram must be at least minCharacterNgram",
		);
	}
	if (
		config.version === "candidate-hash-v3" &&
		(!Number.isInteger(config.contextWindow) || (config.contextWindow ?? 0) < 1)
	) {
		throw new Error("featureConfig.contextWindow must be a positive integer");
	}
}

function hash(value: string): number {
	let result = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		result ^= value.charCodeAt(index);
		result = Math.imul(result, 0x01000193);
	}
	return result >>> 0;
}

function addFeature(vector: Float32Array, feature: string, weight = 1): void {
	const value = hash(feature);
	const index = value % vector.length;
	const sign = (value & 0x80000000) === 0 ? 1 : -1;
	vector[index]! += sign * weight;
}

export function spanFeatures(
	raw: string,
	start: number,
	end: number,
	dimension: number,
	config: LatentFeatureConfig,
): Float32Array {
	if (!Number.isInteger(dimension) || dimension <= 0) {
		throw new Error("featureDimension must be a positive integer");
	}
	validateFeatureConfig(config);

	const vector = new Float32Array(dimension);
	const chars = Array.from(raw.slice(start, end).normalize("NFC"));
	for (
		let size = config.minCharacterNgram;
		size <= config.maxCharacterNgram;
		size += 1
	) {
		for (let index = 0; index + size <= chars.length; index += 1) {
			addFeature(
				vector,
				`g${size}:${chars.slice(index, index + size).join("")}`,
			);
		}
	}

	addFeature(vector, `len:${Math.min(32, Math.floor(chars.length / 2))}`, 0.5);
	if (/\d/u.test(chars.join(""))) addFeature(vector, "shape:digit", 1.5);
	if (/[ก-๙]/u.test(chars.join(""))) addFeature(vector, "shape:thai", 1.5);
	if (/^[+\d\s-]+$/u.test(chars.join("")))
		addFeature(vector, "shape:numeric", 2);

	const left = Array.from(raw.slice(0, start)).slice(-3).join("");
	const right = Array.from(raw.slice(end)).slice(0, 3).join("");
	addFeature(vector, `left:${left || "<BOS>"}`, 0.75);
	addFeature(vector, `right:${right || "<EOS>"}`, 0.75);

	let normSquared = 0;
	for (const value of vector) normSquared += value * value;
	const norm = Math.sqrt(normSquared);
	if (norm > 0) {
		for (let index = 0; index < vector.length; index += 1) {
			vector[index]! /= norm;
		}
	}
	return vector;
}

export function dot(left: ArrayLike<number>, right: readonly number[]): number {
	const length = Math.min(left.length, right.length);
	let result = 0;
	for (let index = 0; index < length; index += 1) {
		result += (left[index] ?? 0) * (right[index] ?? 0);
	}
	return result;
}

export function sigmoid(value: number): number {
	if (value >= 0) return 1 / (1 + Math.exp(-value));
	const exp = Math.exp(value);
	return exp / (1 + exp);
}

export function logit(value: number): number {
	const bounded = Math.max(1e-4, Math.min(1 - 1e-4, value));
	return Math.log(bounded / (1 - bounded));
}

export interface SparseFeatureVector {
	readonly indices: readonly number[];
	readonly values: readonly number[];
}

export interface CandidateFeatureInput {
	readonly context: ParseContext;
	readonly label: OutputLabel;
	readonly start: number;
	readonly end: number;
	readonly source: CandidateSource;
	readonly evidenceScore: number;
	readonly evidence: readonly EvidenceContribution[];
	readonly locationIds: readonly number[];
}

function grams(value: string, minimum: number, maximum: number): readonly string[] {
	const chars = Array.from(value);
	const result: string[] = [];
	for (let size = minimum; size <= maximum; size += 1) {
		for (let index = 0; index + size <= chars.length; index += 1) {
			result.push(chars.slice(index, index + size).join(""));
		}
	}
	return result;
}

function distanceBucket(distance: number | null): string {
	if (distance === null) return "none";
	if (distance <= 0) return "0";
	if (distance === 1) return "1";
	if (distance <= 3) return "2-3";
	if (distance <= 7) return "4-7";
	if (distance <= 15) return "8-15";
	if (distance <= 31) return "16-31";
	return "32+";
}

function nearestDistance(start: number, end: number, ranges: readonly SpanRange[]): number | null {
	let nearest: number | null = null;
	for (const range of ranges) {
		const distance = range.end <= start
			? start - range.end
			: range.start >= end
				? range.start - end
				: 0;
		nearest = nearest === null ? distance : Math.min(nearest, distance);
	}
	return nearest;
}

export function candidateFeatures(
	input: CandidateFeatureInput,
	dimension: number,
	config: LatentFeatureConfig,
): SparseFeatureVector {
	validateFeatureConfig(config);
	if (config.version !== "candidate-hash-v3") {
		throw new Error("candidateFeatures requires candidate-hash-v3");
	}
	if (!Number.isInteger(dimension) || dimension <= 0) {
		throw new Error("featureDimension must be a positive integer");
	}
	const { context, start, end } = input;
	const rawSpan = context.raw.slice(start, end).normalize("NFC");
	const normalizedSpan = rawSpan.replace(/\s+/gu, " ").trim().toLocaleLowerCase("th");
	const compactSpan = normalizedSpan.replace(/\s/gu, "");
	const window = config.contextWindow ?? 12;
	const left = Array.from(context.raw.slice(0, start)).slice(-window).join("");
	const right = Array.from(context.raw.slice(end)).slice(0, window).join("");
	const featureNames = new Set<string>();
	for (const gram of grams(rawSpan, config.minCharacterNgram, config.maxCharacterNgram)) {
		featureNames.add(`span.raw:${gram}`);
	}
	for (const gram of grams(compactSpan, config.minCharacterNgram, config.maxCharacterNgram)) {
		featureNames.add(`span.compact:${gram}`);
	}
	for (const gram of grams(left, 1, Math.min(3, config.maxCharacterNgram))) {
		featureNames.add(`context.left:${gram}`);
	}
	for (const gram of grams(right, 1, Math.min(3, config.maxCharacterNgram))) {
		featureNames.add(`context.right:${gram}`);
	}
	const spanChars = Array.from(normalizedSpan);
	for (let size = 1; size <= Math.min(4, spanChars.length); size += 1) {
		featureNames.add(`boundary.start:${spanChars.slice(0, size).join("")}`);
		featureNames.add(`boundary.end:${spanChars.slice(-size).join("")}`);
	}
	featureNames.add(`label:${input.label}`);
	featureNames.add(`source:${input.source}`);
	featureNames.add(`length:${Math.min(32, Math.floor(spanChars.length / 4))}`);
	featureNames.add(`position:${Math.min(9, Math.floor((10 * start) / Math.max(1, context.raw.length)))}`);
	featureNames.add(`evidence:${Math.min(10, Math.floor(input.evidenceScore * 10))}`);
	featureNames.add(`locations:${Math.min(4, input.locationIds.length)}`);
	if (/^[0-9๐-๙\s+().-]+$/u.test(rawSpan)) featureNames.add("shape:numeric");
	if (/[ก-๙]/u.test(rawSpan)) featureNames.add("shape:thai");
	if (/[A-Za-z]/u.test(rawSpan)) featureNames.add("shape:latin");
	if (/\r?\n/u.test(rawSpan)) featureNames.add("shape:multiline");
	const before = context.raw.slice(0, start);
	featureNames.add(`line:${Math.min(5, (before.match(/\n/gu)?.length ?? 0))}`);
	if (start === 0 || /\n\s*$/u.test(before)) featureNames.add("boundary:line-start");
	if (end === context.raw.length || /^\s*\n/u.test(context.raw.slice(end))) {
		featureNames.add("boundary:line-end");
	}
	for (const contribution of input.evidence) {
		featureNames.add(`evidence-rule:${contribution.ruleId}`);
	}
	for (const [name, ranges] of [
		["recipient-label", context.recipientLabels],
		["phone", context.phoneRanges],
		["address-label", context.addressLabels],
		["administrative", context.administrativeRanges],
		["postcode", context.postcodeRanges],
		["separator", context.separators],
	] as const) {
		featureNames.add(
			`distance.${name}:${distanceBucket(nearestDistance(start, end, ranges))}`,
		);
	}

	const valuesByIndex = new Map<number, number>();
	for (const feature of featureNames) {
		const value = hash(feature);
		const index = value % dimension;
		const sign = (value & 0x80000000) === 0 ? 1 : -1;
		valuesByIndex.set(index, (valuesByIndex.get(index) ?? 0) + sign);
	}
	const entries = [...valuesByIndex.entries()]
		.filter(([, value]) => value !== 0)
		.sort(([left], [right]) => left - right);
	return {
		indices: entries.map(([index]) => index),
		values: entries.map(([, value]) => value),
	};
}

export function sparseDot(
	features: SparseFeatureVector,
	weights: ArrayLike<number>,
): number {
	let result = 0;
	for (let offset = 0; offset < features.indices.length; offset += 1) {
		result +=
			(weights[features.indices[offset] ?? -1] ?? 0) *
			(features.values[offset] ?? 0);
	}
	return result;
}

export function scoreDirection(
	features: Float32Array,
	label: OutputLabel,
	directions: readonly LabelDirection[],
): number {
	const direction = directions.find((item) => item.label === label);
	if (!direction) return 0.5;
	return sigmoid(4 * (dot(features, direction.vector) + (direction.bias ?? 0)));
}
