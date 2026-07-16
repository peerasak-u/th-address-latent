import { describe, expect, test } from "bun:test";
import { parseJsonl, type DatasetRecord } from "../bench/dataset";
import { splitByLocation } from "../bench/split";
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
    seedLocation: location,
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
