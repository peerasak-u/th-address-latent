import { mkdir } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { loadDataset, type DatasetRecord } from "../bench/dataset";
import { loadGazetteer } from "../bench/gazetteer";
import {
	contentChecksum,
	contentSetChecksum,
	recordsChecksum,
} from "../bench/integrity";
import { addResult, createMetrics, summarize } from "../bench/metrics";
import { splitByLocation } from "../bench/split";
import { createAddressParser } from "../src";
import {
	DEFAULT_LATENT_FEATURE_CONFIG,
	DEFAULT_LATENT_SCORING_CONFIG,
} from "../src/latent/features";
import {
	fitCandidateDirections,
	fitLabelDirections,
} from "../src/latent/fit";
import type { ParserResources } from "../src/types";

const MIN_SLICE_RECORDS = 5;

function evaluatePromotionGate(
	resources: ParserResources,
	evaluation: readonly DatasetRecord[],
	familyByRecordId: ReadonlyMap<string, number>,
	familyIds: readonly string[],
	ablationApplicable: boolean,
) {
	const latentParser = createAddressParser(resources);
	const noDirectionsParser = createAddressParser({
		...resources,
		labelDirections: [],
	});
	const overall = { latent: createMetrics(), noDirections: createMetrics() };
	const byCaseType = new Map<
		string,
		{ latent: ReturnType<typeof createMetrics>; noDirections: ReturnType<typeof createMetrics> }
	>();
	const byDatasetFamily = new Map<
		string,
		{ latent: ReturnType<typeof createMetrics>; noDirections: ReturnType<typeof createMetrics> }
	>();
	for (const record of evaluation) {
		const latentOutput = latentParser.parse(record.raw).fields;
		const noDirectionsOutput = noDirectionsParser.parse(record.raw).fields;
		addResult(overall.latent, record.expected, latentOutput);
		addResult(overall.noDirections, record.expected, noDirectionsOutput);
		const caseSlice = byCaseType.get(record.caseType) ?? {
			latent: createMetrics(),
			noDirections: createMetrics(),
		};
		addResult(caseSlice.latent, record.expected, latentOutput);
		addResult(caseSlice.noDirections, record.expected, noDirectionsOutput);
		byCaseType.set(record.caseType, caseSlice);
		const familyIndex = familyByRecordId.get(record.id);
		const familyId = familyIndex === undefined ? "unknown" : (familyIds[familyIndex] ?? "unknown");
		const familySlice = byDatasetFamily.get(familyId) ?? {
			latent: createMetrics(),
			noDirections: createMetrics(),
		};
		addResult(familySlice.latent, record.expected, latentOutput);
		addResult(familySlice.noDirections, record.expected, noDirectionsOutput);
		byDatasetFamily.set(familyId, familySlice);
	}
	const failures: string[] = [];
	function checkSlice(label: string, slice: { latent: ReturnType<typeof createMetrics>; noDirections: ReturnType<typeof createMetrics> }): void {
		if (slice.latent.records < MIN_SLICE_RECORDS) return;
		const latentAccuracy = slice.latent.records === 0 ? 0 : slice.latent.exactRecords / slice.latent.records;
		const noDirectionsAccuracy = slice.noDirections.records === 0 ? 0 : slice.noDirections.exactRecords / slice.noDirections.records;
		if (latentAccuracy < noDirectionsAccuracy) {
			failures.push(
				`${label}: latent exactRecordAccuracy ${latentAccuracy.toFixed(4)} < noDirections ${noDirectionsAccuracy.toFixed(4)}`,
			);
		}
	}
	if (ablationApplicable) {
		checkSlice("overall", overall);
		for (const [caseType, slice] of byCaseType) checkSlice(`caseType:${caseType}`, slice);
		for (const [familyId, slice] of byDatasetFamily) checkSlice(`datasetFamily:${familyId}`, slice);
	}
	return {
		passed: failures.length === 0,
		ablationApplicable,
		failures,
		report: {
			overall: { latent: summarize(overall.latent), noDirections: summarize(overall.noDirections) },
			byCaseType: Object.fromEntries(
				[...byCaseType.entries()].map(([key, value]) => [
					key,
					{ latent: summarize(value.latent), noDirections: summarize(value.noDirections) },
				]),
			),
			byDatasetFamily: Object.fromEntries(
				[...byDatasetFamily.entries()].map(([key, value]) => [
					key,
					{ latent: summarize(value.latent), noDirections: summarize(value.noDirections) },
				]),
			),
		},
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

const datasetPaths = argumentsFor("--dataset");
if (datasetPaths.length === 0) throw new Error("missing --dataset");
const gazetteerPath = argument("--gazetteer");
const outputPath = argument(
	"--output",
	"resources/generated/construction-v2-ngram4-d512.json",
);
const splitSeed = argument("--seed", "20260720");
const dimension = Number(argument("--dimension", "512"));
const maxCharacterNgram = Number(argument("--max-character-ngram", "4"));
const datasetBalance = argument(
	"--dataset-balance",
	datasetPaths.length > 1 ? "equal-family" : "uniform-records",
);
if (!["uniform-records", "equal-family"].includes(datasetBalance)) {
	throw new Error("--dataset-balance must be uniform-records or equal-family");
}
const negativePolicy = argument("--negative-policy", "other-spans");
if (!["output-only", "other-spans"].includes(negativePolicy)) {
	throw new Error("--negative-policy must be output-only or other-spans");
}
const fitMode = argument("--fit-mode", "gold-centroid");
if (!["none", "gold-centroid", "candidate-contrastive"].includes(fitMode)) {
	throw new Error(
		"--fit-mode must be none, gold-centroid, or candidate-contrastive",
	);
}
if (!Number.isInteger(dimension) || dimension <= 0)
	throw new Error("--dimension must be positive");
if (
	!Number.isInteger(maxCharacterNgram) ||
	maxCharacterNgram < DEFAULT_LATENT_FEATURE_CONFIG.minCharacterNgram
) {
	throw new Error("--max-character-ngram must be at least 1");
}
const featureConfig = {
	...DEFAULT_LATENT_FEATURE_CONFIG,
	maxCharacterNgram,
};
function weightArgument(name: string, fallback: number): number {
	const value = Number(argument(name, String(fallback)));
	if (!Number.isFinite(value) || value < 0 || value > 1) {
		throw new Error(`${name} must be between zero and one`);
	}
	return value;
}
const scoringConfig = {
	...DEFAULT_LATENT_SCORING_CONFIG,
	latentWeightByLabel: {
		...DEFAULT_LATENT_SCORING_CONFIG.latentWeightByLabel,
		NAME: weightArgument("--name-latent-weight", 0.55),
		ADDRESS_DETAIL: weightArgument("--address-latent-weight", 0.55),
	},
};

const familyRecords = await Promise.all(datasetPaths.map(loadDataset));
const records: DatasetRecord[] = [];
const familyByRecordId = new Map<string, number>();
for (const [familyIndex, family] of familyRecords.entries()) {
	for (const record of family) {
		if (familyByRecordId.has(record.id)) {
			throw new Error(`duplicate dataset id across files: ${record.id}`);
		}
		familyByRecordId.set(record.id, familyIndex);
		records.push(record);
	}
}
const datasetSources = await Promise.all(
	datasetPaths.map(async (path, index) => ({
		id: basename(path),
		checksum: contentChecksum(await Bun.file(path).arrayBuffer()),
		recordCount: familyRecords[index]?.length ?? 0,
	})),
);
const datasetChecksum = contentSetChecksum(
	datasetSources.map((source) => source.checksum),
);
const gazetteerChecksum = contentChecksum(
	await Bun.file(gazetteerPath).arrayBuffer(),
);
const split = splitByLocation(records, splitSeed);
const locations = await loadGazetteer(gazetteerPath);
const trainFamilyCounts = familyRecords.map((_, familyIndex) =>
	split.train.filter(
		(record) => familyByRecordId.get(record.id) === familyIndex,
	).length,
);
const trainingConfig = {
	fitMode,
	datasetBalance,
	negativePolicy,
	familyRecordCounts: familyRecords.map((family) => family.length),
	trainFamilyRecordCounts: trainFamilyCounts,
};
const buildChecksum = contentChecksum(
	JSON.stringify({
		datasetChecksum,
		gazetteerChecksum,
		featureConfig,
		scoringConfig,
		trainingConfig,
		splitSeed,
	}),
);
const recordWeight = (record: { readonly id?: string }): number => {
	if (datasetBalance === "uniform-records") return 1;
	if (!record.id) throw new Error("dataset record id is required for family balancing");
	const familyIndex = familyByRecordId.get(record.id);
	const familySize = familyIndex === undefined
		? undefined
		: trainFamilyCounts[familyIndex];
	if (!familySize) throw new Error(`missing dataset family for ${record.id}`);
	return split.train.length / (familyRecords.length * familySize);
};
const labelDirections = fitMode === "none"
	? []
	: fitMode === "candidate-contrastive"
	? fitCandidateDirections(
		split.train,
		{
			version: "candidate-contrastive-training",
			featureDimension: dimension,
			featureConfig,
			scoringConfig,
			labelDirections: [],
			locations,
		},
		{ recordWeight },
	)
	: fitLabelDirections(
		split.train,
		dimension,
		featureConfig,
		{
			includeOtherAsNegative: negativePolicy === "other-spans",
			recordWeight,
		},
	);
const resourceChecksum = contentChecksum(
	JSON.stringify({ buildChecksum, labelDirections, locations }),
);
const resourceVersion = argument(
	"--resource-version",
	`construction-v3-${resourceChecksum.slice(0, 12)}`,
);
const resources: ParserResources = {
	version: resourceVersion,
	featureDimension: dimension,
	featureConfig,
	scoringConfig,
	labelDirections,
	locations,
	checksum: resourceChecksum,
};
const skipGate = Bun.argv.includes("--skip-gate");
const gate = evaluatePromotionGate(
	resources,
	split.evaluation,
	familyByRecordId,
	datasetSources.map((source) => source.id),
	fitMode !== "none",
);
if (!gate.ablationApplicable) {
	console.warn(
		"fit-mode=none: promotionGate.passed reflects the deterministic no-directions baseline, not an ablation win.",
	);
}
if (!gate.passed && !skipGate) {
	console.error("Promotion gate failed: frozen resource lost to noDirections");
	for (const failure of gate.failures) console.error(`  ${failure}`);
	console.error(
		"Re-run with --skip-gate to write an unpromoted experiment artifact instead.",
	);
	process.exit(1);
}
const artifact = {
	resources,
	split: {
		seed: splitSeed,
		method: "location-tuple-held-out",
		trainIds: split.train.map((record) => record.id),
		evaluationIds: split.evaluation.map((record) => record.id),
	},
	source: {
		datasets: datasetSources,
		gazetteer: {
			id: basename(gazetteerPath),
			checksum: gazetteerChecksum,
		},
		datasetChecksum,
		buildChecksum,
		resourceChecksum,
		evaluationChecksum: recordsChecksum(split.evaluation),
		recordCount: records.length,
		training: trainingConfig,
	},
	promotionGate: {
		enforced: !skipGate,
		passed: gate.passed,
		ablationApplicable: gate.ablationApplicable,
		failures: gate.failures,
		report: gate.report,
	},
};
if (!gate.passed) {
	console.warn(
		"Writing unpromoted experiment artifact (--skip-gate): do not deploy this resource.",
	);
}
await mkdir(dirname(outputPath), { recursive: true });
await Bun.write(outputPath, `${JSON.stringify(artifact)}\n`);
console.log(
	`Wrote ${outputPath}: ${split.train.length} train, ${split.evaluation.length} evaluation`,
);
