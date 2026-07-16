import { spanFeatures } from "./features";
import type {
	LabelDirection,
	LatentFeatureConfig,
	OutputLabel,
} from "../types";

export interface LabeledSpanRecord {
	readonly raw: string;
	readonly spans: readonly {
		readonly label: string;
		readonly start: number;
		readonly end: number;
	}[];
}

const OUTPUT_LABELS: readonly OutputLabel[] = [
	"NAME",
	"PHONE",
	"ADDRESS_DETAIL",
	"SUBDISTRICT",
	"DISTRICT",
	"PROVINCE",
	"POSTCODE",
];

export function fitLabelDirections(
	records: readonly LabeledSpanRecord[],
	dimension: number,
	featureConfig: LatentFeatureConfig,
): readonly LabelDirection[] {
	const sums = new Map<OutputLabel, Float64Array>();
	const counts = new Map<OutputLabel, number>();
	const global = new Float64Array(dimension);
	let globalCount = 0;
	for (const label of OUTPUT_LABELS)
		sums.set(label, new Float64Array(dimension));

	for (const record of records) {
		for (const span of record.spans) {
			if (!OUTPUT_LABELS.includes(span.label as OutputLabel)) continue;
			const label = span.label as OutputLabel;
			const features = spanFeatures(
				record.raw,
				span.start,
				span.end,
				dimension,
				featureConfig,
			);
			const sum = sums.get(label)!;
			for (let index = 0; index < dimension; index += 1) {
				const value = features[index] ?? 0;
				sum[index]! += value;
				global[index]! += value;
			}
			counts.set(label, (counts.get(label) ?? 0) + 1);
			globalCount += 1;
		}
	}

	return OUTPUT_LABELS.flatMap((label): LabelDirection[] => {
		const count = counts.get(label) ?? 0;
		if (count === 0 || globalCount === count) return [];
		const positive = sums.get(label)!;
		const vector = new Array<number>(dimension);
		let normSquared = 0;
		for (let index = 0; index < dimension; index += 1) {
			const posMean = positive[index]! / count;
			const negMean =
				(global[index]! - positive[index]!) / (globalCount - count);
			const value = posMean - negMean;
			vector[index] = value;
			normSquared += value * value;
		}
		const norm = Math.sqrt(normSquared) || 1;
		for (let index = 0; index < vector.length; index += 1)
			vector[index]! /= norm;
		return [{ label, vector }];
	});
}
