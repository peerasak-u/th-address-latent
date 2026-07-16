import type { ParseResult, OutputLabel } from "../src/types";
import type { ExpectedAddress } from "./dataset";
import { FIELD_NAMES } from "./metrics";

const LABEL_BY_FIELD: Readonly<Record<keyof ExpectedAddress, OutputLabel>> = {
	name: "NAME",
	phone: "PHONE",
	address: "ADDRESS_DETAIL",
	subdistrict: "SUBDISTRICT",
	district: "DISTRICT",
	province: "PROVINCE",
	zipcode: "POSTCODE",
};

interface FunnelField {
	expected: number;
	reachable: number;
	selected: number;
	accepted: number;
}

export interface CandidateFunnel {
	readonly fields: Record<keyof ExpectedAddress, FunnelField>;
	readonly pruneReasons: Record<string, number>;
	readonly rejectionRules: Record<string, number>;
	readonly acceptedEvidenceRules: Record<string, number>;
}

export interface CandidateFunnelSummary {
	readonly fields: Record<
		keyof ExpectedAddress,
		FunnelField & {
			readonly reachability: number;
			readonly selectionRate: number;
			readonly acceptanceRate: number;
		}
	>;
	readonly pruneReasons: Record<string, number>;
	readonly rejectionRules: Record<string, number>;
	readonly acceptedEvidenceRules: Record<string, number>;
}

export function createCandidateFunnel(): CandidateFunnel {
	return {
		fields: Object.fromEntries(
			FIELD_NAMES.map((field) => [
				field,
				{ expected: 0, reachable: 0, selected: 0, accepted: 0 },
			]),
		) as CandidateFunnel["fields"],
		pruneReasons: {},
		rejectionRules: {},
		acceptedEvidenceRules: {},
	};
}

function increment(target: Record<string, number>, key: string): void {
	target[key] = (target[key] ?? 0) + 1;
}

export function addCandidateFunnel(
	funnel: CandidateFunnel,
	expected: ExpectedAddress,
	result: ParseResult,
): void {
	const trace = result.diagnostics.candidateTrace;
	if (!trace) throw new Error("candidate funnel requires full diagnostics");
	for (const field of FIELD_NAMES) {
		const canonical = expected[field];
		if (canonical === null) continue;
		const metric = funnel.fields[field];
		const label = LABEL_BY_FIELD[field];
		const matching = trace.filter(
			(candidate) =>
				candidate.label === label && candidate.canonical === canonical,
		);
		metric.expected += 1;
		if (matching.length > 0) metric.reachable += 1;
		if (
			matching.some(
				(candidate) =>
					candidate.outcome === "accepted" || candidate.outcome === "abstained",
			)
		) {
			metric.selected += 1;
		}
		if (matching.some((candidate) => candidate.outcome === "accepted")) {
			metric.accepted += 1;
		}
	}
	for (const candidate of trace) {
		if (candidate.outcome === "pruned" && candidate.reason) {
			increment(funnel.pruneReasons, candidate.reason);
		}
		if (candidate.outcome === "accepted") {
			for (const evidence of candidate.evidence) {
				increment(funnel.acceptedEvidenceRules, evidence.ruleId);
			}
		}
	}
	for (const rejection of result.diagnostics.candidateRejections ?? []) {
		increment(funnel.rejectionRules, rejection.ruleId);
	}
}

export function summarizeCandidateFunnel(
	funnel: CandidateFunnel,
): CandidateFunnelSummary {
	return {
		fields: Object.fromEntries(
			FIELD_NAMES.map((field) => {
				const value = funnel.fields[field];
				return [
					field,
					{
						...value,
						reachability:
							value.expected === 0 ? 0 : value.reachable / value.expected,
						selectionRate:
							value.expected === 0 ? 0 : value.selected / value.expected,
						acceptanceRate:
							value.expected === 0 ? 0 : value.accepted / value.expected,
					},
				];
			}),
		) as CandidateFunnelSummary["fields"],
		pruneReasons: funnel.pruneReasons,
		rejectionRules: funnel.rejectionRules,
		acceptedEvidenceRules: funnel.acceptedEvidenceRules,
	};
}
