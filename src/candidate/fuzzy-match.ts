export function levenshteinDistance(a: string, b: string): number {
	if (a === b) return 0;
	const m = a.length;
	const n = b.length;
	if (m === 0) return n;
	if (n === 0) return m;
	let previous = new Int32Array(n + 1);
	let current = new Int32Array(n + 1);
	for (let j = 0; j <= n; j += 1) previous[j] = j;
	for (let i = 1; i <= m; i += 1) {
		current[0] = i;
		const codeA = a.charCodeAt(i - 1);
		for (let j = 1; j <= n; j += 1) {
			const cost = codeA === b.charCodeAt(j - 1) ? 0 : 1;
			current[j] = Math.min(
				(previous[j] ?? 0) + 1,
				(current[j - 1] ?? 0) + 1,
				(previous[j - 1] ?? 0) + cost,
			);
		}
		[previous, current] = [current, previous];
	}
	return previous[n] ?? 0;
}

export function similarityRatio(a: string, b: string): number {
	const total = a.length + b.length;
	if (total === 0) return 100;
	return ((total - levenshteinDistance(a, b)) / total) * 100;
}

export interface FuzzyOption {
	readonly text: string;
}

export interface FuzzyMatch<T extends FuzzyOption> {
	readonly option: T;
	readonly similarity: number;
}

/**
 * Best-scoring option by normalized Levenshtein ratio, with a cheap
 * length-difference prefilter so scanning large gazetteer term lists stays
 * fast. Ties keep the earliest option, matching Array#find-style determinism.
 */
export function bestFuzzyMatch<T extends FuzzyOption>(
	text: string,
	options: readonly T[],
	minSimilarity: number,
): FuzzyMatch<T> | null {
	let best: FuzzyMatch<T> | null = null;
	for (const option of options) {
		const candidate = option.text;
		if (candidate.length === 0) continue;
		const maxLength = Math.max(text.length, candidate.length);
		if (Math.abs(text.length - candidate.length) / maxLength > 0.5) continue;
		const similarity = similarityRatio(text, candidate);
		if (similarity < minSimilarity) continue;
		if (!best || similarity > best.similarity) best = { option, similarity };
	}
	return best;
}
