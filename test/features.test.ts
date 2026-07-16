import { expect, test } from "bun:test";
import {
	candidateFeatures,
	DEFAULT_CANDIDATE_FEATURE_CONFIG,
	DEFAULT_LATENT_FEATURE_CONFIG,
	DEFAULT_RESIDUAL_SCORING_CONFIG,
	spanFeatures,
	validateFeatureConfig,
} from "../src/latent/features";
import {
	fitCandidateDirections,
	fitLabelDirections,
	fitPairwiseResidualDirections,
} from "../src/latent/fit";
import type { ParserResources } from "../src/types";
import { buildParseContext } from "../src/candidate/context";
import { createAddressParser } from "../src/parser";

test("character n-gram configuration changes the frozen feature representation", () => {
	const threeGram = {
		...DEFAULT_LATENT_FEATURE_CONFIG,
		maxCharacterNgram: 3,
	};
	const fourGram = {
		...DEFAULT_LATENT_FEATURE_CONFIG,
		maxCharacterNgram: 4,
	};

	const withThreeGrams = spanFeatures("ทดสอบ", 0, 5, 4096, threeGram);
	const withFourGrams = spanFeatures("ทดสอบ", 0, 5, 4096, fourGram);

	expect([...withFourGrams]).not.toEqual([...withThreeGrams]);
});

test("feature configuration rejects an invalid n-gram range", () => {
	expect(() =>
		validateFeatureConfig({
			...DEFAULT_LATENT_FEATURE_CONFIG,
			minCharacterNgram: 5,
			maxCharacterNgram: 4,
		}),
	).toThrow("maxCharacterNgram");
});

test("OTHER spans can provide hard negatives for frozen directions", () => {
	const records = [
		{
			raw: "สมชาย บ้านเลขที่",
			spans: [
				{ label: "NAME", start: 0, end: 5 },
				{ label: "OTHER", start: 6, end: 16 },
			],
		},
	];

	const withoutOther = fitLabelDirections(
		records,
		64,
		DEFAULT_LATENT_FEATURE_CONFIG,
	);
	const withOther = fitLabelDirections(
		records,
		64,
		DEFAULT_LATENT_FEATURE_CONFIG,
		{ includeOtherAsNegative: true },
	);

	expect(withoutOther).toEqual([]);
	expect(withOther.map((direction) => direction.label)).toEqual(["NAME"]);
});

test("candidate-contrastive fitting learns from generated wrong candidates", () => {
	const resources: ParserResources = {
		version: "training-test",
		featureDimension: 64,
		featureConfig: DEFAULT_LATENT_FEATURE_CONFIG,
		scoringConfig: {
			version: "label-mix-v1",
			latentWeightByLabel: {
				NAME: 0.55,
				PHONE: 0.55,
				ADDRESS_DETAIL: 0.55,
				SUBDISTRICT: 0.55,
				DISTRICT: 0.55,
				PROVINCE: 0.55,
				POSTCODE: 0.55,
			},
		},
		labelDirections: [],
		locations: [],
	};

	const directions = fitCandidateDirections(
		[
			{
				id: "one",
				raw: "สมชาย บ้านเลขที่ 12",
				spans: [],
				expected: {
					name: "สมชาย",
					phone: null,
					address: "บ้านเลขที่ 12",
					subdistrict: null,
					district: null,
					province: null,
					zipcode: null,
				},
			},
		],
		resources,
	);

	expect(directions.map((direction) => direction.label)).toContain("NAME");
});

test("candidate features encode context, source, and evidence without dense allocation", () => {
	const left = candidateFeatures(
		{
			context: buildParseContext("ชื่อผู้รับ: สมชาย", []),
			label: "NAME",
			start: 12,
			end: 17,
			source: "recipient",
			evidenceScore: 0.95,
			evidence: [
				{ ruleId: "name.labeled-value", effect: "base", value: 0.95 },
			],
			locationIds: [],
		},
		4096,
		DEFAULT_CANDIDATE_FEATURE_CONFIG,
	);
	const right = candidateFeatures(
		{
			context: buildParseContext("ถนนสมชาย", []),
			label: "NAME",
			start: 4,
			end: 9,
			source: "segment",
			evidenceScore: 0.2,
			evidence: [],
			locationIds: [],
		},
		4096,
		DEFAULT_CANDIDATE_FEATURE_CONFIG,
	);

	expect(left.indices.length).toBeLessThan(4096);
	expect(left).not.toEqual(right);
});

test("pairwise residual fitting learns offset-matched candidates and preserves evidence-only identity", () => {
	const resources: ParserResources = {
		version: "residual-training-test",
		featureDimension: 256,
		featureConfig: DEFAULT_CANDIDATE_FEATURE_CONFIG,
		scoringConfig: {
			...DEFAULT_RESIDUAL_SCORING_CONFIG,
			residualScaleByLabel: {
				...DEFAULT_RESIDUAL_SCORING_CONFIG.residualScaleByLabel,
				ADDRESS_DETAIL: 1,
			},
		},
		labelDirections: [],
		locations: [],
	};
	const record = {
		id: "pairwise-one",
		raw: "ชื่อผู้รับ: สมชาย\nที่อยู่: บ้านเลขที่ 12",
		spans: [
			{ label: "NAME", start: 12, end: 17 },
			{ label: "ADDRESS_DETAIL", start: 27, end: 40 },
		],
		expected: {
			name: "สมชาย",
			phone: null,
			address: "บ้านเลขที่ 12",
			subdistrict: null,
			district: null,
			province: null,
			zipcode: null,
		},
	};
	const directions = fitPairwiseResidualDirections([record], resources, {
		epochs: 2,
		maxNegativesPerLabelPerRecord: 2,
	});

	expect(directions.map((direction) => direction.label)).toEqual([
		"NAME",
		"ADDRESS_DETAIL",
	]);
	expect(directions.every((direction) => direction.vector.some((value) => value !== 0))).toBe(true);
	const evidenceOnly = createAddressParser(resources, { diagnostics: "full" }).parse(
		record.raw,
	);
	expect(evidenceOnly.diagnostics.latentScoring).toBe("evidence-only");
	expect(
		evidenceOnly.diagnostics.candidateTrace?.every(
			(candidate) => candidate.score === candidate.evidenceScore,
		),
	).toBe(true);
});
