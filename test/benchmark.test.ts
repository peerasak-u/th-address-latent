import { expect, test } from "bun:test";
import {
	addCandidateFunnel,
	createCandidateFunnel,
	summarizeCandidateFunnel,
} from "../bench/funnel";
import { exactAcceptance } from "../bench/metrics";
import type { ExpectedAddress } from "../bench/dataset";
import type { ParseResult } from "../src/types";
import { parseRecipientList } from "../bench/list-dataset";
import {
	addCalibration,
	createCalibration,
	summarizeCalibration,
} from "../bench/calibration";

test("candidate funnel separates reachability, selection, and acceptance", () => {
	const expected: ExpectedAddress = {
		name: "สมชาย",
		phone: null,
		address: null,
		subdistrict: null,
		district: null,
		province: null,
		zipcode: null,
	};
	const result: ParseResult = {
		raw: "สมชาย",
		fields: { ...expected },
		spans: [
			{
				label: "NAME",
				text: "สมชาย",
				canonical: "สมชาย",
				start: 0,
				end: 5,
				confidence: 0.9,
			},
		],
		confidence: 0.9,
		abstentions: [],
		diagnostics: {
			resourceVersion: "test",
			candidatesEvaluated: 1,
			hypothesesEvaluated: 1,
			latentScoring: "frozen-direction",
			scoreSemantics: "uncalibrated-selection-score",
			candidateTrace: [
				{
					label: "NAME",
					text: "สมชาย",
					canonical: "สมชาย",
					start: 0,
					end: 5,
					evidenceScore: 0.9,
					latentScore: 0.5,
					score: 0.9,
					evidence: [],
					outcome: "accepted",
				},
			],
		},
	};
	const funnel = createCandidateFunnel();

	addCandidateFunnel(funnel, expected, result);

	expect(summarizeCandidateFunnel(funnel).fields.name).toEqual({
		expected: 1,
		reachable: 1,
		selected: 1,
		accepted: 1,
		reachability: 1,
		selectionRate: 1,
		acceptanceRate: 1,
	});
});

test("recipient-list benchmark derives expected fields without the parser under test", () => {
	const records = parseRecipientList(`ชื่อผู้รับ: ผู้รับทดสอบ ใจดี
เบอร์โทร: 081-234-5678
ที่อยู่: 12 ถนนตัวอย่าง แขวงปทุมวัน เขตปทุมวัน กรุงเทพมหานคร 10330
หมายเหตุ: ข้อมูลทดสอบเท่านั้น

---

ผู้รับทดสอบแบบไม่มีป้าย
0812345678
ข้อมูลที่อยู่แบบยุ่ง`);

	expect(records).toEqual([
		{
			id: "recipient-list-0001",
			raw: "ชื่อผู้รับ: ผู้รับทดสอบ ใจดี\nเบอร์โทร: 081-234-5678\nที่อยู่: 12 ถนนตัวอย่าง แขวงปทุมวัน เขตปทุมวัน กรุงเทพมหานคร 10330\nหมายเหตุ: ข้อมูลทดสอบเท่านั้น",
			style: "bangkok",
			expected: {
				name: "ผู้รับทดสอบ ใจดี",
				phone: "0812345678",
				address: "12 ถนนตัวอย่าง",
				subdistrict: "ปทุมวัน",
				district: "ปทุมวัน",
				province: "กรุงเทพมหานคร",
				zipcode: "10330",
			},
		},
	]);
});

test("calibration reports accepted-span Brier score and expected calibration error", () => {
	const expected: ExpectedAddress = {
		name: "สมชาย",
		phone: null,
		address: null,
		subdistrict: null,
		district: null,
		province: null,
		zipcode: null,
	};
	const calibration = createCalibration();
	const result: ParseResult = {
		raw: "สมชาย",
		fields: { ...expected },
		spans: [{
			label: "NAME",
			text: "สมชาย",
			canonical: "สมชาย",
			start: 0,
			end: 5,
			confidence: 0.9,
		}],
		confidence: 0.9,
		abstentions: [],
		diagnostics: {
			resourceVersion: "test",
			candidatesEvaluated: 1,
			hypothesesEvaluated: 1,
			latentScoring: "frozen-direction",
			scoreSemantics: "uncalibrated-selection-score",
		},
	};

	addCalibration(calibration, expected, result);
	const summary = summarizeCalibration(calibration);

	expect(summary.brierScore).toBeCloseTo(0.01);
	expect(summary.expectedCalibrationError).toBeCloseTo(0.1);
});

test("95 percent exact acceptance requires 56 of 58 records", () => {
	expect(exactAcceptance({ records: 58, exactRecords: 55 }, 0.95)).toEqual({
		minimumAccuracy: 0.95,
		requiredExactRecords: 56,
		actualExactRecords: 55,
		passed: false,
	});
	expect(exactAcceptance({ records: 58, exactRecords: 56 }, 0.95).passed).toBe(
		true,
	);
});
