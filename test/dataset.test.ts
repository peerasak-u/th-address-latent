import { describe, expect, test } from "bun:test";
import { parseJsonl, type DatasetRecord } from "../bench/dataset";
import { splitByLocation, splitForTraining } from "../bench/split";
import { contentChecksum, contentSetChecksum } from "../bench/integrity";

function record(id: string, caseType: string, location: DatasetRecord["seedLocation"]): DatasetRecord {
  return {
    id,
    raw: "กรุงเทพมหานคร",
    caseType,
    difficulty: "medium",
    spans: [{
      label: "PROVINCE",
      text: "กรุงเทพมหานคร",
      canonical: "กรุงเทพมหานคร",
      start: 0,
      end: 13,
      codePointStart: 0,
      codePointEnd: 13,
    }],
    expected: {
      name: null,
      phone: null,
      address: null,
      subdistrict: null,
      district: null,
      province: "กรุงเทพมหานคร",
      zipcode: null,
    },
    normalizationExpected: {
      name: null,
      phone: null,
      address: null,
      subdistrict: null,
      district: null,
      province: "กรุงเทพมหานคร",
      zipcode: null,
    },
    seedLocation: location,
		partition: {},
  };
}

const bangkok = {
  subdistrict: "ปทุมวัน",
  district: "ปทุมวัน",
  province: "กรุงเทพมหานคร",
  zipcode: "10330",
};

describe("dataset boundary", () => {
  test("rejects a span whose UTF-16 offsets do not reproduce its text", () => {
    const malformed = { ...record("bad", "clean", bangkok), spans: [{
      label: "PROVINCE",
      text: "กรุงเทพมหานคร",
      canonical: "กรุงเทพมหานคร",
      start: 1,
      end: 13,
      codePointStart: 1,
      codePointEnd: 13,
    }] };

    expect(() => parseJsonl(JSON.stringify(malformed))).toThrow("invalid offsets");
  });

  test("never places the same authoritative tuple in both partitions", () => {
    const locations = Array.from({ length: 20 }, (_, index) => ({
      subdistrict: `ตำบล${index}`,
      district: `อำเภอ${index}`,
      province: `จังหวัด${index}`,
      zipcode: `${10000 + index}`,
    }));
    const records = locations.flatMap((location, index) => [
      record(`a-${index}`, index === 0 ? "ocr-noise" : "clean", location),
      record(`b-${index}`, "reordered", location),
    ]);

    const split = splitByLocation(records, "test-seed", 0.2);
    const trainKeys = new Set(split.train.map((item) => JSON.stringify(item.seedLocation)));
    const evaluationKeys = new Set(split.evaluation.map((item) => JSON.stringify(item.seedLocation)));

    expect([...trainKeys].some((key) => evaluationKeys.has(key))).toBe(false);
    expect(new Set(split.evaluation.map((item) => item.caseType))).toContain("ocr-noise");
  });

	test("normalizes NAME and ADDRESS_DETAIL gold values from their source spans", () => {
		const source = {
			...record("surface", "whitespace-noise", bangkok),
			raw: "นาย  สมชายบ้านเลขที่  12",
			spans: [
				{
					label: "NAME",
					text: "นาย  สมชาย",
					canonical: "สมชาย",
					start: 0,
					end: 10,
					codePointStart: 0,
					codePointEnd: 10,
				},
				{
					label: "ADDRESS_DETAIL",
					text: "บ้านเลขที่  12",
					canonical: "บ้านเลขที่12",
					start: 10,
					end: 24,
					codePointStart: 10,
					codePointEnd: 24,
				},
			],
			expected: {
				...record("surface", "clean", bangkok).expected,
				name: "สมชาย",
				address: "บ้านเลขที่12",
			},
		};
		const [parsed] = parseJsonl(JSON.stringify(source));

		expect(parsed?.expected.name).toBe("นาย สมชาย");
		expect(parsed?.expected.address).toBe("บ้านเลขที่ 12");
		expect(parsed?.normalizationExpected.name).toBe("สมชาย");
		expect(parsed?.normalizationExpected.address).toBe("บ้านเลขที่12");
		expect(parsed?.spans.map((span) => span.canonical)).toEqual([
			"นาย สมชาย",
			"บ้านเลขที่ 12",
		]);
	});

	test("holds out both location tuples and declared evaluation templates", () => {
		const locations = Array.from({ length: 80 }, (_, index) => ({
			subdistrict: `ตำบล${index}`,
			district: `อำเภอ${index}`,
			province: `จังหวัด${index}`,
			zipcode: `${10000 + index}`,
		}));
		const records = locations.flatMap((location, index) => [
			{
				...record(`train-${index}`, "clean", location),
				partition: {
					declaredSplit: "train" as const,
					templateFamily: "train-template",
				},
			},
			{
				...record(`evaluation-${index}`, "clean", location),
				partition: {
					declaredSplit: "evaluation" as const,
					templateFamily: "evaluation-template",
				},
			},
		]);

		const split = splitForTraining(records, "leakage-safe");
		const locationSets = [split.train, split.development, split.evaluation].map(
			(partition) => new Set(partition.map((item) => JSON.stringify(item.seedLocation))),
		);

		expect(split.train.every((item) => item.partition.declaredSplit === "train")).toBe(true);
		expect(split.development.every((item) => item.partition.declaredSplit === "train")).toBe(true);
		expect(
			split.evaluation.every(
				(item) => item.partition.declaredSplit === "evaluation",
			),
		).toBe(true);
		expect(
			locationSets.some((left, index) =>
				locationSets.slice(index + 1).some((right) =>
					[...left].some((key) => right.has(key)),
				),
			),
		).toBe(false);
		expect(split.excluded.length).toBeGreaterThan(0);
	});
});

describe("resource provenance", () => {
	test("combined content checksums are independent of file order and path", () => {
		const left = contentChecksum("first dataset");
		const right = contentChecksum("second dataset");

		expect(contentSetChecksum([left, right])).toBe(
			contentSetChecksum([right, left]),
		);
	});
});
