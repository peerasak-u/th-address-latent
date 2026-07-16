import { generateCandidates } from "./candidates";
import { validateFeatureConfig, validateScoringConfig } from "./latent/features";
import { pruneCandidates } from "./decode/pruner";
import type {
	AddressParser,
	ParseResult,
	ParserOptions,
	ParserResources,
} from "./types";
import { validateDecodeResult } from "./validate/result";

const DEFAULT_OPTIONS: Required<ParserOptions> = {
	beamWidth: 64,
	candidatesPerLabel: 24,
	minFieldConfidence: 0.5,
};

function validateOptions(options: Required<ParserOptions>): void {
	if (!Number.isInteger(options.beamWidth) || options.beamWidth <= 0) {
		throw new Error("options.beamWidth must be a positive integer");
	}
	if (
		!Number.isInteger(options.candidatesPerLabel) ||
		options.candidatesPerLabel <= 0
	) {
		throw new Error("options.candidatesPerLabel must be a positive integer");
	}
	if (
		!Number.isFinite(options.minFieldConfidence) ||
		options.minFieldConfidence < 0 ||
		options.minFieldConfidence > 1
	) {
		throw new Error("options.minFieldConfidence must be between zero and one");
	}
}

function validateResources(resources: ParserResources): void {
	if (!resources.version) throw new Error("resources.version is required");
	if (
		!Number.isInteger(resources.featureDimension) ||
		resources.featureDimension <= 0
	) {
		throw new Error("resources.featureDimension must be a positive integer");
	}
	validateFeatureConfig(resources.featureConfig);
	validateScoringConfig(resources.scoringConfig);
	for (const direction of resources.labelDirections) {
		if (direction.vector.length !== resources.featureDimension) {
			throw new Error(`Direction ${direction.label} has the wrong dimension`);
		}
	}
}

export function createAddressParser(
	resources: ParserResources,
	options: ParserOptions = {},
): AddressParser {
	validateResources(resources);
	const resolved = { ...DEFAULT_OPTIONS, ...options };
	validateOptions(resolved);
	return {
		parse(raw: string): ParseResult {
			const candidates = generateCandidates(raw, resources);
			const decoded = pruneCandidates(
				candidates,
				resolved.beamWidth,
				resolved.candidatesPerLabel,
			);
			const diagnostics = {
				resourceVersion: resources.version,
				...(resources.checksum === undefined
					? {}
					: { resourceChecksum: resources.checksum }),
				candidatesEvaluated: candidates.length,
				hypothesesEvaluated: decoded.hypothesesEvaluated,
				latentScoring: "frozen-direction" as const,
			};
			return validateDecodeResult(
				raw,
				decoded,
				resolved.minFieldConfidence,
				diagnostics,
			);
		},
	};
}

export function parseAddress(
	raw: string,
	resources: ParserResources,
	options?: ParserOptions,
): ParseResult {
	return createAddressParser(resources, options).parse(raw);
}
