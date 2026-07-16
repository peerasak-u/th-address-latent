import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createAddressParser, type ParserResources } from "../src";
import { loadDatasets, type ExpectedAddress } from "./dataset";
import { recordsChecksum } from "./integrity";
import { loadLegacyParser } from "./legacy";
import { addResult, createMetrics, summarize } from "./metrics";

interface Artifact {
	readonly resources: ParserResources;
	readonly split: {
		readonly seed: string;
		readonly method: string;
		readonly trainIds: readonly string[];
		readonly evaluationIds: readonly string[];
	};
	readonly source: {
		readonly datasetChecksum: string;
		readonly evaluationChecksum: string;
		readonly recordCount: number;
	};
}

function argument(name: string, fallback?: string): string {
	const index = Bun.argv.indexOf(name);
	const value = index >= 0 ? Bun.argv[index + 1] : fallback;
	if (!value) throw new Error(`missing ${name}`);
	return value;
}

function argumentsFor(name: string): string[] {
	const values: string[] = [];
	for (let index = 0; index < Bun.argv.length; index += 1) {
		if (Bun.argv[index] === name && Bun.argv[index + 1]) values.push(Bun.argv[index + 1]!);
	}
	return values;
}

function percentile(values: readonly number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	return (
		sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ??
		0
	);
}

const datasetPaths = argumentsFor("--dataset");
if (datasetPaths.length === 0) throw new Error("missing --dataset");
const artifactPath = argument(
	"--resources",
	"resources/generated/construction-v2-ngram4-d512.json",
);
const legacyPath = argument(
	"--legacy",
	`${process.env.HOME}/Workspace/indie/thai-address-splitter`,
);
const outputPath = argument(
	"--output",
	".bench-results/construction-v2-ngram4-d512.json",
);

const records = await loadDatasets(datasetPaths);
const artifact = (await Bun.file(artifactPath).json()) as Artifact;
const evalIds = new Set(artifact.split.evaluationIds);
const evaluation = records.filter((record) => evalIds.has(record.id));
if (evaluation.length !== evalIds.size) {
	throw new Error(
		`dataset changed: found ${evaluation.length}/${evalIds.size} evaluation IDs`,
	);
}
const currentEvaluationChecksum = recordsChecksum(evaluation);
if (currentEvaluationChecksum !== artifact.source.evaluationChecksum) {
	throw new Error("evaluation records differ from the resource artifact");
}

const latent = createAddressParser(artifact.resources);
const noDirections = createAddressParser({
	...artifact.resources,
	labelDirections: [],
});
const legacy = loadLegacyParser(legacyPath);
const latentMetrics = createMetrics();
const noDirectionsMetrics = createMetrics();
const legacyMetrics = createMetrics();
const latentTimes: number[] = [];
const noDirectionsTimes: number[] = [];
const legacyTimes: number[] = [];
const byCase = new Map<
	string,
	{
		latent: ReturnType<typeof createMetrics>;
		noDirections: ReturnType<typeof createMetrics>;
		legacy: ReturnType<typeof createMetrics>;
	}
>();

function fields(record: ReturnType<typeof latent.parse>): ExpectedAddress {
	return { ...record.fields };
}

for (const record of evaluation) {
	let latentOutput: ExpectedAddress | null = null;
	let noDirectionsOutput: ExpectedAddress | null = null;
	let legacyOutput: ExpectedAddress | null = null;
	const latentStart = Bun.nanoseconds();
	try {
		latentOutput = fields(latent.parse(record.raw));
	} catch {
		latentOutput = null;
	} finally {
		latentTimes.push((Bun.nanoseconds() - latentStart) / 1_000_000);
	}
	const noDirectionsStart = Bun.nanoseconds();
	try {
		noDirectionsOutput = fields(noDirections.parse(record.raw));
	} catch {
		noDirectionsOutput = null;
	} finally {
		noDirectionsTimes.push((Bun.nanoseconds() - noDirectionsStart) / 1_000_000);
	}
	const legacyStart = Bun.nanoseconds();
	try {
		legacyOutput = legacy(record.raw);
	} catch {
		legacyOutput = null;
	} finally {
		legacyTimes.push((Bun.nanoseconds() - legacyStart) / 1_000_000);
	}
	addResult(latentMetrics, record.expected, latentOutput);
	addResult(noDirectionsMetrics, record.expected, noDirectionsOutput);
	addResult(legacyMetrics, record.expected, legacyOutput);
	const slice = byCase.get(record.caseType) ?? {
		latent: createMetrics(),
		noDirections: createMetrics(),
		legacy: createMetrics(),
	};
	addResult(slice.latent, record.expected, latentOutput);
	addResult(slice.noDirections, record.expected, noDirectionsOutput);
	addResult(slice.legacy, record.expected, legacyOutput);
	byCase.set(record.caseType, slice);
}

function timing(values: readonly number[]): object {
	return {
		medianMs: percentile(values, 0.5),
		p95Ms: percentile(values, 0.95),
		p99Ms: percentile(values, 0.99),
	};
}

const report = {
	status: "exploratory-synthetic-only",
	generatedAt: new Date().toISOString(),
	runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
	split: artifact.split,
	source: artifact.source,
	evaluatedRecords: evaluation.length,
	latent: { metrics: summarize(latentMetrics), timing: timing(latentTimes) },
	noDirections: {
		description:
			"same retrieval, pruning, and validation with frozen directions removed",
		metrics: summarize(noDirectionsMetrics),
		timing: timing(noDirectionsTimes),
	},
	legacy: { metrics: summarize(legacyMetrics), timing: timing(legacyTimes) },
	byCaseType: Object.fromEntries(
		[...byCase.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, value]) => [
				key,
				{
					latent: summarize(value.latent),
					noDirections: summarize(value.noDirections),
					legacy: summarize(value.legacy),
				},
			]),
	),
	limitations: [
		"Construction records are synthetic and are not a human-reviewed gold set.",
		"The split holds out complete location tuples but not generator template families.",
		"No production-quality superiority claim is supported by this report.",
	],
};
await mkdir(dirname(outputPath), { recursive: true });
await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
	JSON.stringify(
		{
			outputPath,
			evaluatedRecords: evaluation.length,
			latent: report.latent,
			noDirections: report.noDirections,
			legacy: report.legacy,
		},
		null,
		2,
	),
);
