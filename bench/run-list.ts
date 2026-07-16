import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createAddressParser, type ParserResources } from "../src";
import {
	addCalibration,
	createCalibration,
	summarizeCalibration,
} from "./calibration";
import {
	addCandidateFunnel,
	createCandidateFunnel,
	summarizeCandidateFunnel,
} from "./funnel";
import { contentChecksum } from "./integrity";
import { loadDataset } from "./dataset";
import {
	parseRecipientList,
	recipientListBlocks,
} from "./list-dataset";
import {
	addResult,
	createMetrics,
	exactAcceptance,
	summarize,
} from "./metrics";

interface ResourceArtifact {
	readonly resources: ParserResources;
}

function argument(name: string, fallback?: string): string {
	const index = Bun.argv.indexOf(name);
	const value = index >= 0 ? Bun.argv[index + 1] : fallback;
	if (!value) throw new Error(`missing ${name}`);
	return value;
}

function percentile(values: readonly number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[
		Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))
	] ?? 0;
}

const inputPath = argument("--input");
const resourcePath = argument(
	"--resources",
	"resources/generated/construction-v2-ngram4-d512.json",
);
const outputPath = argument(
	"--output",
	".bench-results/recipient-list.json",
);
const supplementPath = argument(
	"--supplement",
	"bench/fixtures/sakon-messy-v1.jsonl",
);
const minimumExactAccuracy = Number(
	argument("--min-exact-accuracy", "0.95"),
);
const input = await Bun.file(inputPath).text();
const blocks = recipientListBlocks(input);
const structuredRecords = parseRecipientList(input);
const structuredRaw = new Set(structuredRecords.map((record) => record.raw));
const unstructuredBlocks = blocks.filter((block) => !structuredRaw.has(block));
const supplement = await loadDataset(supplementPath);
const supplementByRaw = new Map(supplement.map((record) => [record.raw, record]));
const unmatchedBlocks = unstructuredBlocks.filter(
	(block) => !supplementByRaw.has(block),
);
if (unmatchedBlocks.length > 0) {
	throw new Error(
		`${unmatchedBlocks.length} unstructured recipient-list blocks have no reviewed supplement record`,
	);
}
const records = [
	...structuredRecords,
	...unstructuredBlocks.map((raw, index) => ({
		id: `recipient-list-supplement-${String(index + 1).padStart(4, "0")}`,
		raw,
		style: "messy-reviewed",
		expected: supplementByRaw.get(raw)!.expected,
	})),
];
if (records.length === 0) throw new Error("recipient list is empty");
const artifact = (await Bun.file(resourcePath).json()) as ResourceArtifact;
const latent = createAddressParser(artifact.resources);
const noDirections = createAddressParser({
	...artifact.resources,
	labelDirections: [],
});
const diagnostics = createAddressParser(artifact.resources, {
	diagnostics: "full",
});
const latentMetrics = createMetrics();
const noDirectionsMetrics = createMetrics();
const funnel = createCandidateFunnel();
const latentCalibration = createCalibration();
const noDirectionsCalibration = createCalibration();
const latentTimes: number[] = [];
const noDirectionsTimes: number[] = [];
const byStyle = new Map<
	string,
	{
		latent: ReturnType<typeof createMetrics>;
		noDirections: ReturnType<typeof createMetrics>;
	}
>();

for (const record of records) {
	const latentStart = Bun.nanoseconds();
	const latentResult = latent.parse(record.raw);
	latentTimes.push((Bun.nanoseconds() - latentStart) / 1_000_000);
	const noDirectionsStart = Bun.nanoseconds();
	const noDirectionsResult = noDirections.parse(record.raw);
	noDirectionsTimes.push((Bun.nanoseconds() - noDirectionsStart) / 1_000_000);
	addResult(latentMetrics, record.expected, latentResult.fields);
	addResult(noDirectionsMetrics, record.expected, noDirectionsResult.fields);
	addCalibration(latentCalibration, record.expected, latentResult);
	addCalibration(noDirectionsCalibration, record.expected, noDirectionsResult);
	addCandidateFunnel(funnel, record.expected, diagnostics.parse(record.raw));
	const style = byStyle.get(record.style) ?? {
		latent: createMetrics(),
		noDirections: createMetrics(),
	};
	addResult(style.latent, record.expected, latentResult.fields);
	addResult(style.noDirections, record.expected, noDirectionsResult.fields);
	byStyle.set(record.style, style);
}

function timing(values: readonly number[]): object {
	return {
		medianMs: percentile(values, 0.5),
		p95Ms: percentile(values, 0.95),
		p99Ms: percentile(values, 0.99),
	};
}

const report = {
	status: "private-recipient-list-aggregate-only",
	generatedAt: new Date().toISOString(),
	resourceVersion: artifact.resources.version,
	source: {
		inputChecksum: contentChecksum(input),
		recordCount: records.length,
		structuredRecords: structuredRecords.length,
		reviewedSupplementRecords: unstructuredBlocks.length,
		unmatchedRecords: unmatchedBlocks.length,
	},
	latent: {
		metrics: summarize(latentMetrics),
		timing: timing(latentTimes),
		calibration: summarizeCalibration(latentCalibration),
	},
	noDirections: {
		description: "same parser with frozen directions removed",
		metrics: summarize(noDirectionsMetrics),
		timing: timing(noDirectionsTimes),
		calibration: summarizeCalibration(noDirectionsCalibration),
	},
	acceptance: exactAcceptance(latentMetrics, minimumExactAccuracy),
	byAddressStyle: Object.fromEntries(
		[...byStyle.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([style, value]) => [
				style,
				{
					latent: summarize(value.latent),
					noDirections: summarize(value.noDirections),
				},
			]),
	),
	candidateFunnel: summarizeCandidateFunnel(funnel),
	privacy: {
		containsRawRecords: false,
		containsExpectedValues: false,
		containsParsedValues: false,
	},
	limitations: [
		"The structured field labels are used only to derive expected fields; the parser receives each complete raw block.",
		"This report contains aggregate metrics only and does not establish production accuracy.",
	],
};
await mkdir(dirname(outputPath), { recursive: true });
await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
	JSON.stringify(
		{
			outputPath,
			records: records.length,
			latent: report.latent,
			noDirections: report.noDirections,
		},
		null,
		2,
	),
);
if (!report.acceptance.passed) {
	throw new Error(
		`recipient-list benchmark failed: ${report.acceptance.actualExactRecords}/${records.length} exact records; requires ${report.acceptance.requiredExactRecords}`,
	);
}
