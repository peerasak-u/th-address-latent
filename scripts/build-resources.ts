import { mkdir } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { loadDataset, type DatasetRecord } from "../bench/dataset";
import { loadGazetteer } from "../bench/gazetteer";
import {
	contentChecksum,
	contentSetChecksum,
	recordsChecksum,
} from "../bench/integrity";
import { splitByLocation } from "../bench/split";
import {
	DEFAULT_LATENT_FEATURE_CONFIG,
	DEFAULT_LATENT_SCORING_CONFIG,
} from "../src/latent/features";
import {
	fitCandidateDirections,
	fitLabelDirections,
} from "../src/latent/fit";
import type { ParserResources } from "../src/types";

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
if (!["gold-centroid", "candidate-contrastive"].includes(fitMode)) {
	throw new Error("--fit-mode must be gold-centroid or candidate-contrastive");
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
const labelDirections = fitMode === "candidate-contrastive"
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
};
await mkdir(dirname(outputPath), { recursive: true });
await Bun.write(outputPath, `${JSON.stringify(artifact)}\n`);
console.log(
	`Wrote ${outputPath}: ${split.train.length} train, ${split.evaluation.length} evaluation`,
);
