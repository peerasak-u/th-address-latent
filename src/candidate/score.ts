import {
	candidateFeatures,
	dot,
	logit,
	sigmoid,
	sparseDot,
	spanFeatures,
} from "../latent/features";
import { normalizeCandidate } from "../normalize";
import type { Candidate, ParserResources } from "../types";
import type { CandidateSeedStore } from "./seed-store";
import type { ParseContext } from "./context";

export function scoreCandidates(
	context: ParseContext,
	resources: ParserResources,
	store: CandidateSeedStore,
): readonly Candidate[] {
	const raw = context.raw;
	return store.values().map((seed) => {
		const text = raw.slice(seed.start, seed.end);
		const direction = resources.labelDirections.find(
			(item) => item.label === seed.label,
		);
		const locationIds = store.locationIds(seed);
		let rawLatentScore = 0;
		if (direction) {
			if (resources.featureConfig.version === "candidate-hash-v3") {
				rawLatentScore = sparseDot(
					candidateFeatures(
						{
							context,
							label: seed.label,
							start: seed.start,
							end: seed.end,
							source: seed.source,
							evidenceScore: seed.evidence,
							evidence: seed.evidenceTrace ?? [],
							locationIds,
						},
						resources.featureDimension,
						resources.featureConfig,
					),
					direction.vector,
				) + (direction.bias ?? 0);
			} else {
				rawLatentScore =
					dot(
						spanFeatures(
							raw,
							seed.start,
							seed.end,
							resources.featureDimension,
							resources.featureConfig,
						),
						direction.vector,
					) + (direction.bias ?? 0);
			}
		}
		const latentScore = direction
			? sigmoid(
				resources.scoringConfig.version === "label-mix-v1"
					? 4 * rawLatentScore
					: rawLatentScore,
			)
			: 0.5;
		const score = resources.scoringConfig.version === "residual-rank-v2"
			? direction &&
				(resources.scoringConfig.residualScaleByLabel[seed.label] ?? 0) > 0
				? sigmoid(
						logit(seed.evidence) +
							Math.max(
								-resources.scoringConfig.maxAbsoluteResidualLogit,
								Math.min(
									resources.scoringConfig.maxAbsoluteResidualLogit,
									rawLatentScore *
										(resources.scoringConfig.residualScaleByLabel[seed.label] ?? 0),
								),
							),
					)
				: seed.evidence
			: (() => {
					const latentWeight =
						resources.scoringConfig.latentWeightByLabel[seed.label] ?? 0.55;
					return Math.max(
						0,
						Math.min(
							1,
							latentWeight * latentScore +
								(1 - latentWeight) * seed.evidence,
						),
					);
				})();
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
			source: seed.source,
			locationIds,
			evidence: seed.evidenceTrace ?? [],
		};
	});
}
