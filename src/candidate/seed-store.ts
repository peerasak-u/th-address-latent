import type { EvidenceContribution, OutputLabel } from "../types";

export interface CandidateSeed {
	readonly label: OutputLabel;
	readonly start: number;
	readonly end: number;
	readonly canonical?: string;
	readonly evidence: number;
	readonly evidenceTrace?: readonly EvidenceContribution[];
	readonly locationId?: number;
	readonly scopeLocationId?: boolean;
}

function seedKey(seed: CandidateSeed): string {
	const locationScope = seed.scopeLocationId ? `\u0000${seed.locationId ?? "none"}` : "";
	return `${seed.label}\u0000${seed.start}\u0000${seed.end}\u0000${seed.canonical ?? ""}${locationScope}`;
}

export class CandidateSeedStore {
	readonly #seeds = new Map<string, CandidateSeed>();
	readonly #locationIds = new Map<string, Set<number>>();

	add(seed: CandidateSeed): void {
		const key = seedKey(seed);
		const previous = this.#seeds.get(key);
		if (!previous) {
			this.#seeds.set(key, seed);
		} else {
			this.#seeds.set(key, {
				...previous,
				evidence: Math.max(previous.evidence, seed.evidence),
				...(seed.evidence > previous.evidence
					? { evidenceTrace: seed.evidenceTrace }
					: {}),
				...(previous.locationId === undefined && seed.locationId !== undefined
					? { locationId: seed.locationId }
					: {}),
			});
		}
		if (seed.locationId !== undefined) {
			const ids = this.#locationIds.get(key) ?? new Set<number>();
			ids.add(seed.locationId);
			this.#locationIds.set(key, ids);
		}
	}

	values(): readonly CandidateSeed[] {
		return [...this.#seeds.values()];
	}

	locationIds(seed: CandidateSeed): readonly number[] {
		return [...(this.#locationIds.get(seedKey(seed)) ?? [])];
	}
}
