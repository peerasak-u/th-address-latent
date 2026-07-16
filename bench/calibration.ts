import { labelToField } from "../src/labels";
import type { ParseResult } from "../src/types";
import type { ExpectedAddress } from "./dataset";

interface CalibrationBin {
	count: number;
	confidenceSum: number;
	correct: number;
}

export interface CalibrationAccumulator {
	samples: number;
	brierSum: number;
	readonly bins: CalibrationBin[];
}

export function createCalibration(binCount = 10): CalibrationAccumulator {
	if (!Number.isInteger(binCount) || binCount <= 0) {
		throw new Error("calibration bin count must be a positive integer");
	}
	return {
		samples: 0,
		brierSum: 0,
		bins: Array.from({ length: binCount }, () => ({
			count: 0,
			confidenceSum: 0,
			correct: 0,
		})),
	};
}

export function addCalibration(
	calibration: CalibrationAccumulator,
	expected: ExpectedAddress,
	result: ParseResult,
): void {
	for (const span of result.spans) {
		const field = labelToField(span.label);
		const correct = expected[field] === span.canonical ? 1 : 0;
		const confidence = Math.max(0, Math.min(1, span.confidence));
		const binIndex = Math.min(
			calibration.bins.length - 1,
			Math.floor(confidence * calibration.bins.length),
		);
		const bin = calibration.bins[binIndex]!;
		bin.count += 1;
		bin.confidenceSum += confidence;
		bin.correct += correct;
		calibration.samples += 1;
		calibration.brierSum += (confidence - correct) ** 2;
	}
}

export function summarizeCalibration(
	calibration: CalibrationAccumulator,
): {
	readonly samples: number;
	readonly brierScore: number;
	readonly expectedCalibrationError: number;
	readonly note: string;
} {
	let expectedCalibrationError = 0;
	for (const bin of calibration.bins) {
		if (bin.count === 0 || calibration.samples === 0) continue;
		const averageConfidence = bin.confidenceSum / bin.count;
		const accuracy = bin.correct / bin.count;
		expectedCalibrationError +=
			(bin.count / calibration.samples) *
			Math.abs(averageConfidence - accuracy);
	}
	return {
		samples: calibration.samples,
		brierScore:
			calibration.samples === 0
				? 0
				: calibration.brierSum / calibration.samples,
		expectedCalibrationError,
		note: "accepted spans only; current scores are uncalibrated selection scores",
	};
}
