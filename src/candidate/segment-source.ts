import type { ParseContext, SpanRange } from "./context";
import { overlaps, trimRange } from "./context";
import { evaluateSegmentEvidence } from "./evidence-rules";
import type { CandidateSeedStore } from "./seed-store";

function trimSegmentRange(
	raw: string,
	start: number,
	end: number,
): SpanRange | null {
	const range = trimRange(raw, start, end);
	if (!range) return null;
	end = range.end;
	while (end > range.start && /[,;]/u.test(raw[end - 1] ?? "")) end -= 1;
	return trimRange(raw, range.start, end);
}

export function addSegmentCandidates(
	context: ParseContext,
	store: CandidateSeedStore,
): void {
	const anchors = store.values().filter((seed) => seed.evidence >= 0.9);
	const boundaries = new Set<number>([0, context.raw.length]);
	for (const anchor of anchors) {
		boundaries.add(anchor.start);
		boundaries.add(anchor.end);
	}
	for (const range of [
		...context.addressHintRanges,
		...context.titleHintRanges,
	]) {
		boundaries.add(range.start);
	}
	for (const range of context.administrativeRanges) {
		boundaries.add(range.start);
		boundaries.add(range.end);
	}
	for (const range of context.excludedRanges) {
		boundaries.add(range.start);
		boundaries.add(range.end);
	}

	const ordered = [...boundaries].sort((left, right) => left - right);
	for (let startIndex = 0; startIndex < ordered.length; startIndex += 1) {
		for (
			let endIndex = startIndex + 1;
			endIndex < ordered.length;
			endIndex += 1
		) {
			const rawStart = ordered[startIndex];
			const rawEnd = ordered[endIndex];
			if (
				rawStart === undefined ||
				rawEnd === undefined ||
				rawEnd - rawStart > 140
			) {
				continue;
			}
			const range = trimSegmentRange(context.raw, rawStart, rawEnd);
			if (!range) continue;
			const text = context.raw.slice(range.start, range.end);
			if (text.length < 2) continue;
			addSegmentPair(context, range, anchors, store);
		}
	}
}

function addSegmentPair(
	context: ParseContext,
	range: SpanRange,
	anchors: readonly SpanRange[],
	store: CandidateSeedStore,
): void {
	const evidence = evaluateSegmentEvidence(context, range);
	if (
		!anchors.some((anchor) => overlaps(anchor, range)) &&
		!context.excludedRanges.some((item) => overlaps(item, range))
	) {
		store.add({
			label: "NAME",
			...range,
			evidence: evidence.name.value,
			evidenceTrace: evidence.name.contributions,
		});
	}
	const addressProtectedRanges = [
		...context.phoneRanges,
		...context.postcodeRanges,
		...context.recipientLabels,
		...context.phoneLabels,
		...context.addressLabels,
		...context.separators,
	];
	if (!addressProtectedRanges.some((item) => overlaps(item, range))) {
		store.add({
			label: "ADDRESS_DETAIL",
			...range,
			evidence: evidence.address.value,
			evidenceTrace: evidence.address.contributions,
		});
	}
}
