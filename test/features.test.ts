import { expect, test } from "bun:test";
import {
	DEFAULT_LATENT_FEATURE_CONFIG,
	spanFeatures,
	validateFeatureConfig,
} from "../src/latent/features";
import {
	fitCandidateDirections,
	fitLabelDirections,
} from "../src/latent/fit";
import type { ParserResources } from "../src/types";

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
