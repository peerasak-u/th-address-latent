import { expect, test } from "bun:test";
import {
	DEFAULT_LATENT_FEATURE_CONFIG,
	spanFeatures,
	validateFeatureConfig,
} from "../src/latent/features";

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
