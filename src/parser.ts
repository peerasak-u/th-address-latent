import { createCandidateEngine } from "./candidates";
import { validateFeatureConfig, validateScoringConfig } from "./latent/features";
import { pruneCandidates } from "./decode/pruner";
import { labelToField } from "./labels";
import type {
	AddressParser,
	Candidate,
	CandidateTrace,
	ParseResult,
	ParserOptions,
	ParserResources,
} from "./types";
import { validateDecodeResult } from "./validate/result";

const DEFAULT_OPTIONS: Required<ParserOptions> = {
	beamWidth: 64,
	candidatesPerLabel: 24,
	minFieldConfidence: 0.5,
	diagnostics: "summary",
};

function overlaps(left: Candidate, right: Candidate): boolean {
	return left.start < right.end && right.start < left.end;
}

function traceCandidates(
	candidates: readonly Candidate[],
	selected: readonly Candidate[],
	result: ParseResult,
): readonly CandidateTrace[] {
	const selectedSet = new Set(selected);
	return candidates.map((candidate): CandidateTrace => {
		const accepted = result.spans.some((span) =>
			span.label === candidate.label &&
			span.start === candidate.start &&
			span.end === candidate.end &&
			span.canonical === candidate.canonical
		);
		if (accepted) return { ...candidate, outcome: "accepted" };
		if (selectedSet.has(candidate)) {
			const abstention = result.abstentions.find(
				(item) => item.field === labelToField(candidate.label),
			);
			return {
				...candidate,
				outcome: "abstained",
				...(abstention ? { reason: abstention.reason } : {}),
			};
		}
		const reason = candidate.score < 0.48
			? "below-threshold"
			: selected.some((item) => overlaps(item, candidate))
				? "overlap"
				: selected.some((item) => item.label === candidate.label)
					? "lower-ranked"
					: "beam-pruned";
		return { ...candidate, outcome: "pruned", reason };
	});
}

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
	const candidateEngine = createCandidateEngine(resources);
	return {
		parse(raw: string): ParseResult {
			const generation = candidateEngine.generate(raw);
			const candidates = generation.candidates;
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
				scoreSemantics: "uncalibrated-selection-score" as const,
			};
			const result = validateDecodeResult(
				raw,
				decoded,
				resolved.minFieldConfidence,
				diagnostics,
			);
			if (resolved.diagnostics !== "full") return result;
			return {
				...result,
				diagnostics: {
					...result.diagnostics,
					candidateTrace: traceCandidates(candidates, decoded.selected, result),
					candidateRejections: generation.rejections,
				},
			};
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
