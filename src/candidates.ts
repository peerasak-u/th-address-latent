import { buildParseContext } from "./candidate/context";
import { addLocationCandidates } from "./candidate/location-source";
import { scoreCandidates } from "./candidate/score";
import { CandidateSeedStore } from "./candidate/seed-store";
import { addSegmentCandidates } from "./candidate/segment-source";
import { addStructuredCandidates } from "./candidate/structured-source";
import { buildFuzzyLocationIndex, buildLocationTerms } from "./location-index";
import type { Candidate, CandidateRejection, ParserResources } from "./types";

export interface CandidateGenerationResult {
	readonly candidates: readonly Candidate[];
	readonly rejections: readonly CandidateRejection[];
}

export interface CandidateEngine {
	generate(raw: string): CandidateGenerationResult;
}

export function createCandidateEngine(
	resources: ParserResources,
): CandidateEngine {
	const locationTerms = buildLocationTerms(resources.locations);
	const fuzzyLocationIndex = buildFuzzyLocationIndex(
		locationTerms,
		resources.locations,
	);
	return {
		generate(raw: string): CandidateGenerationResult {
			const context = buildParseContext(raw, locationTerms);
			const store = new CandidateSeedStore();
			const rejections = new Map<string, CandidateRejection>();
			const reject = (rejection: CandidateRejection): void => {
				const key = `${rejection.label}\u0000${rejection.start}\u0000${rejection.end}\u0000${rejection.ruleId}`;
				rejections.set(key, rejection);
			};
			addStructuredCandidates(
				context,
				resources.locations,
				fuzzyLocationIndex,
				store,
				reject,
			);
			addLocationCandidates(
				context,
				locationTerms,
				resources.locations,
				store,
				reject,
			);
			addSegmentCandidates(context, store);
			return {
				candidates: scoreCandidates(context, resources, store),
				rejections: [...rejections.values()],
			};
		},
	};
}
