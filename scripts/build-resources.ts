import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { loadDatasets } from "../bench/dataset";
import { loadGazetteer } from "../bench/gazetteer";
import { recordsChecksum } from "../bench/integrity";
import { splitByLocation } from "../bench/split";
import {
	DEFAULT_LATENT_FEATURE_CONFIG,
	DEFAULT_LATENT_SCORING_CONFIG,
} from "../src/latent/features";
import { fitLabelDirections } from "../src/latent/fit";
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

const datasetChecksumHasher = new Bun.CryptoHasher("sha256");
for (const datasetPath of datasetPaths) {
	datasetChecksumHasher.update(datasetPath);
	datasetChecksumHasher.update("\u0000");
	datasetChecksumHasher.update(await Bun.file(datasetPath).arrayBuffer());
	datasetChecksumHasher.update("\u0000");
}
const datasetChecksum = datasetChecksumHasher.digest("hex");
const records = await loadDatasets(datasetPaths);
const split = splitByLocation(records, splitSeed);
const locations = await loadGazetteer(gazetteerPath);
const resourceVersion = argument(
	"--resource-version",
	`construction-v2-${datasetChecksum.slice(0, 12)}`,
);
const labelDirections = fitLabelDirections(
	split.train,
	dimension,
	featureConfig,
);
const resources: ParserResources = {
	version: resourceVersion,
	featureDimension: dimension,
	featureConfig,
	scoringConfig,
	labelDirections,
	locations,
	checksum: datasetChecksum,
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
	datasetPaths,
		gazetteerPath,
		datasetChecksum,
		evaluationChecksum: recordsChecksum(split.evaluation),
		recordCount: records.length,
	},
};
await mkdir(dirname(outputPath), { recursive: true });
await Bun.write(outputPath, `${JSON.stringify(artifact)}\n`);
console.log(
	`Wrote ${outputPath}: ${split.train.length} train, ${split.evaluation.length} evaluation`,
);
