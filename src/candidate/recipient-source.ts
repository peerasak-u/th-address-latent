import type { ParseContext } from "./context";
import { trimRange } from "./context";
import type { CandidateSeedStore } from "./seed-store";

function valueEnd(context: ParseContext, start: number): number {
	return [
		...context.separators,
		...context.recipientLabels,
		...context.phoneLabels,
		...context.addressLabels,
	]
		.filter((range) => range.start >= start)
		.reduce(
			(end, range) => Math.min(end, range.start),
			context.raw.length,
		);
}

function addLabeledValues(
	context: ParseContext,
	store: CandidateSeedStore,
): void {
	for (const label of context.recipientLabels) {
		const range = trimRange(
			context.raw,
			label.end,
			valueEnd(context, label.end),
		);
		if (!range) continue;
		store.add({
			label: "NAME",
			...range,
			source: "recipient",
			evidence: 0.995,
			evidenceTrace: [
				{ ruleId: "name.labeled-value", effect: "base", value: 0.995 },
			],
		});
	}

	for (const label of context.addressLabels) {
		const end = valueEnd(context, label.end);
		const administrativeStart = context.administrativeRanges
			.filter((range) => range.start >= label.end && range.start < end)
			.reduce((start, range) => Math.min(start, range.start), end);
		const range = trimRange(
			context.raw,
			label.end,
			administrativeStart,
		);
		if (!range) continue;
		store.add({
			label: "ADDRESS_DETAIL",
			...range,
			source: "recipient",
			evidence: 0.995,
			evidenceTrace: [
				{ ruleId: "address.labeled-value", effect: "base", value: 0.995 },
			],
		});
	}
}

function addFirstLineRecipient(
	context: ParseContext,
	store: CandidateSeedStore,
): void {
	const firstSeparator = context.separators.find(
		(separator) => separator.start > 0,
	);
	if (!firstSeparator) return;
	const range = trimRange(context.raw, 0, firstSeparator.start);
	if (
		!range ||
		!context.phoneRanges.some((phone) => phone.start > range.end) ||
		/[0-9๐-๙]/u.test(context.raw.slice(range.start, range.end))
	) {
		return;
	}
	store.add({
		label: "NAME",
		...range,
		source: "recipient",
		evidence: 0.97,
		evidenceTrace: [
			{ ruleId: "name.titleless-first-line", effect: "base", value: 0.97 },
		],
	});
}

export function addRecipientCandidates(
	context: ParseContext,
	store: CandidateSeedStore,
): void {
	addLabeledValues(context, store);
	addFirstLineRecipient(context, store);
}
