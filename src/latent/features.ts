import type {
	LabelDirection,
	LatentFeatureConfig,
	LatentScoringConfig,
	OutputLabel,
} from "../types";

export const DEFAULT_LATENT_FEATURE_CONFIG: LatentFeatureConfig = {
	version: "char-ngram-v2",
	minCharacterNgram: 1,
	maxCharacterNgram: 4,
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

export function validateScoringConfig(config: LatentScoringConfig): void {
	if (config.version !== DEFAULT_LATENT_SCORING_CONFIG.version) {
		throw new Error(`Unsupported latent scoring version: ${config.version}`);
	}
	for (const [label, weight] of Object.entries(config.latentWeightByLabel)) {
		if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
			throw new Error(`scoringConfig.latentWeightByLabel.${label} must be between zero and one`);
		}
	}
}

export function validateFeatureConfig(config: LatentFeatureConfig): void {
	if (config.version !== DEFAULT_LATENT_FEATURE_CONFIG.version) {
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

export function scoreDirection(
	features: Float32Array,
	label: OutputLabel,
	directions: readonly LabelDirection[],
): number {
	const direction = directions.find((item) => item.label === label);
	if (!direction) return 0.5;
	return sigmoid(4 * (dot(features, direction.vector) + (direction.bias ?? 0)));
}
