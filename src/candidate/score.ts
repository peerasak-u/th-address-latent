import { spanFeatures, scoreDirection } from "../latent/features";
import { normalizeCandidate } from "../normalize";
import type { Candidate, ParserResources } from "../types";
import type { CandidateSeedStore } from "./seed-store";

export function scoreCandidates(
	raw: string,
	resources: ParserResources,
	store: CandidateSeedStore,
): readonly Candidate[] {
	return store.values().map((seed) => {
		const text = raw.slice(seed.start, seed.end);
		const features = spanFeatures(
			raw,
			seed.start,
			seed.end,
			resources.featureDimension,
			resources.featureConfig,
		);
		const latentScore = scoreDirection(
			features,
			seed.label,
			resources.labelDirections,
		);
		const latentWeight =
			resources.scoringConfig.latentWeightByLabel[seed.label] ?? 0.55;
		const score = Math.max(
			0,
			Math.min(
				1,
				latentWeight * latentScore + (1 - latentWeight) * seed.evidence,
			),
		);
		return {
			label: seed.label,
			text,
			canonical:
				seed.canonical ?? normalizeCandidate(seed.label, text) ?? text,
			start: seed.start,
			end: seed.end,
			latentScore,
			evidenceScore: seed.evidence,
			score,
			locationIds: store.locationIds(seed),
			evidence: seed.evidenceTrace ?? [],
		};
	});
}
