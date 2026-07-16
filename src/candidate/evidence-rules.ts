import type { EvidenceContribution, OutputLabel } from "../types";
import {
	containsAddressWord,
	startsWithTitle,
	type ParseContext,
	type SpanRange,
} from "./context";

interface SegmentFacts {
	readonly text: string;
	readonly hasAddressWord: boolean;
	readonly hasDigit: boolean;
	readonly hasTitle: boolean;
	readonly followsRecipientLabel: boolean;
	readonly firstRecipientLine: boolean;
	readonly followsAddressLabel: boolean;
	readonly endsBeforeAdministrative: boolean;
	readonly administrativePrefixCount: number;
	readonly startsLine: boolean;
	readonly hasComma: boolean;
	readonly thaiRatio: number;
}

interface EvidenceRule {
	readonly id: string;
	readonly target: Extract<OutputLabel, "NAME" | "ADDRESS_DETAIL">;
	readonly priority: number;
	readonly effect: "base" | "add";
	readonly value: number;
	readonly when: (facts: SegmentFacts) => boolean;
}

export interface EvidenceResult {
	readonly value: number;
	readonly contributions: readonly EvidenceContribution[];
}

const RULES: readonly EvidenceRule[] = [
	{
		id: "name.after-recipient-label",
		target: "NAME",
		priority: 500,
		effect: "base",
		value: 0.96,
		when: (facts) => facts.followsRecipientLabel,
	},
	{
		id: "name.titleless-first-line",
		target: "NAME",
		priority: 490,
		effect: "base",
		value: 0.96,
		when: (facts) => facts.firstRecipientLine,
	},
	{
		id: "name.title",
		target: "NAME",
		priority: 400,
		effect: "base",
		value: 0.94,
		when: (facts) => facts.hasTitle,
	},
	{
		id: "name.script-shape",
		target: "NAME",
		priority: 300,
		effect: "base",
		value: 0.62,
		when: (facts) => facts.thaiRatio > 0.7 && !facts.hasDigit,
	},
	{
		id: "name.fallback",
		target: "NAME",
		priority: 0,
		effect: "base",
		value: 0.2,
		when: () => true,
	},
	{
		id: "name.address-signal",
		target: "NAME",
		priority: 0,
		effect: "add",
		value: -0.5,
		when: (facts) => facts.hasAddressWord || facts.hasDigit,
	},
	{
		id: "address.after-label",
		target: "ADDRESS_DETAIL",
		priority: 500,
		effect: "base",
		value: 0.94,
		when: (facts) => facts.followsAddressLabel,
	},
	{
		id: "address.keyword",
		target: "ADDRESS_DETAIL",
		priority: 400,
		effect: "base",
		value: 0.94,
		when: (facts) => facts.hasAddressWord,
	},
	{
		id: "address.numeric-prefix",
		target: "ADDRESS_DETAIL",
		priority: 300,
		effect: "base",
		value: 0.94,
		when: (facts) => /^\d+(?:\/\d+)?/u.test(facts.text),
	},
	{
		id: "address.fallback",
		target: "ADDRESS_DETAIL",
		priority: 0,
		effect: "base",
		value: 0.45,
		when: () => true,
	},
	{
		id: "address.title-signal",
		target: "ADDRESS_DETAIL",
		priority: 0,
		effect: "add",
		value: -0.4,
		when: (facts) => facts.hasTitle,
	},
	{
		id: "address.before-administrative",
		target: "ADDRESS_DETAIL",
		priority: 0,
		effect: "add",
		value: 0.04,
		when: (facts) => facts.endsBeforeAdministrative,
	},
	{
		id: "address.contains-multiple-administrative-prefixes",
		target: "ADDRESS_DETAIL",
		priority: 0,
		effect: "add",
		value: -0.08,
		when: (facts) => facts.administrativePrefixCount > 1,
	},
	{
		id: "address.line-start",
		target: "ADDRESS_DETAIL",
		priority: 0,
		effect: "add",
		value: 0.04,
		when: (facts) => facts.startsLine,
	},
	{
		id: "address.comma-before-administrative",
		target: "ADDRESS_DETAIL",
		priority: 0,
		effect: "add",
		value: -0.02,
		when: (facts) => facts.hasComma && facts.administrativePrefixCount > 0,
	},
];

function segmentFacts(
	context: ParseContext,
	range: SpanRange,
): SegmentFacts {
	const text = context.raw.slice(range.start, range.end);
	return {
		text,
		hasAddressWord: containsAddressWord(text),
		hasDigit: /\d/u.test(text),
		hasTitle: startsWithTitle(text),
		followsRecipientLabel: context.recipientLabels.some(
			(label) => context.raw.slice(label.end, range.start).trim().length === 0,
		),
		firstRecipientLine:
			context.raw.slice(0, range.start).trim().length === 0 &&
			context.phoneRanges.some((phone) => phone.start > range.end) &&
			!text.includes("\n"),
		followsAddressLabel: context.addressLabels.some(
			(label) => context.raw.slice(label.end, range.start).trim().length === 0,
		),
		endsBeforeAdministrative: context.coherentAdministrativeRanges.some(
			(administrative) =>
				administrative.start >= range.end &&
				context.raw.slice(range.end, administrative.start).trim().length === 0,
		),
		administrativePrefixCount: context.administrativeRanges.filter(
			(administrative) =>
				range.start < administrative.end && administrative.start < range.end,
		).length,
		startsLine:
			range.start === 0 ||
			context.separators.some(
				(separator) =>
					separator.end <= range.start &&
					context.raw.slice(separator.end, range.start).trim().length === 0,
			),
		hasComma: text.includes(","),
		thaiRatio:
			(text.match(/[ก-๙]/gu)?.length ?? 0) /
			Math.max(1, Array.from(text).length),
	};
}

function evaluate(
	target: EvidenceRule["target"],
	facts: SegmentFacts,
): EvidenceResult {
	const matching = RULES.filter(
		(rule) => rule.target === target && rule.when(facts),
	);
	const base = matching
		.filter((rule) => rule.effect === "base")
		.sort((left, right) => right.priority - left.priority)[0];
	const adjustments = matching.filter((rule) => rule.effect === "add");
	const value = Math.max(
		0,
		(base?.value ?? 0) +
			adjustments.reduce((sum, rule) => sum + rule.value, 0),
	);
	const contributions: EvidenceContribution[] = [];
	if (base) {
		contributions.push({ ruleId: base.id, effect: "base", value: base.value });
	}
	for (const rule of adjustments) {
		contributions.push({ ruleId: rule.id, effect: "add", value: rule.value });
	}
	return { value, contributions };
}

export function evaluateSegmentEvidence(
	context: ParseContext,
	range: SpanRange,
): Readonly<Record<"name" | "address", EvidenceResult>> {
	const facts = segmentFacts(context, range);
	return {
		name: evaluate("NAME", facts),
		address: evaluate("ADDRESS_DETAIL", facts),
	};
}
