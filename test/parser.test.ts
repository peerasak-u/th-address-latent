import { describe, expect, test } from "bun:test";
import { createAddressParser, type ParserResources } from "../src";

const resources: ParserResources = {
	version: "test-v2",
	featureDimension: 64,
	featureConfig: {
		version: "char-ngram-v2",
		minCharacterNgram: 1,
		maxCharacterNgram: 4,
	},
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
	locations: [
		{
			subdistrict: "ปทุมวัน",
			district: "ปทุมวัน",
			province: "กรุงเทพมหานคร",
			zipcode: "10330",
		},
	],
};

describe("createAddressParser", () => {
	test("extracts a complete no-space address through candidates, pruning, and validation", () => {
		const parser = createAddressParser(resources);
		const raw = "นายทดสอบ ใจดี081-234-5678บ้านเลขที่ 1ปทุมวันปทุมวันกรุงเทพมหานคร10330";

		const result = parser.parse(raw);

		expect(result.fields).toEqual({
			name: "นายทดสอบ ใจดี",
			phone: "0812345678",
			address: "บ้านเลขที่ 1",
			subdistrict: "ปทุมวัน",
			district: "ปทุมวัน",
			province: "กรุงเทพมหานคร",
			zipcode: "10330",
		});
		for (const span of result.spans) {
			expect(raw.slice(span.start, span.end)).toBe(span.text);
		}
		expect(result.diagnostics.resourceVersion).toBe("test-v2");
	});

	test("uses chat field labels and administrative prefixes as field boundaries", () => {
		const parser = createAddressParser(resources, { diagnostics: "full" });
		const raw =
			"ผู้รับ: Nok Chaiyaporn\nโทร: 0812345678\nที่อยู่: 45 ถนนจันทน์ ตำบลปทุมวัน เขตปทุมวัน กรุงเทพมหานคร 10330";

		const result = parser.parse(raw);
		expect(result.fields).toMatchObject({
			name: "Nok Chaiyaporn",
			phone: "0812345678",
			address: "45 ถนนจันทน์",
			subdistrict: "ปทุมวัน",
			district: "ปทุมวัน",
			province: "กรุงเทพมหานคร",
			zipcode: "10330",
		});
		expect(
			result.diagnostics.candidateTrace
				?.find(
					(candidate) =>
						candidate.label === "ADDRESS_DETAIL" &&
						candidate.outcome === "accepted",
				)
				?.evidence.map((item) => item.ruleId),
		).toContain("address.labeled-value");
	});

	test("recognizes common chat label variants and separators", () => {
		const parser = createAddressParser(resources);
		const raw =
			"ชื่อ: Manee | เบอร์โทร: 0812345678 | ส่งที่: บ้านเลขที่ 45 ถนนจันทน์ ตำบลปทุมวัน เขตปทุมวัน กรุงเทพมหานคร 10330";

		expect(parser.parse(raw).fields).toMatchObject({
			name: "Manee",
			phone: "0812345678",
			address: "บ้านเลขที่ 45 ถนนจันทน์",
		});
	});

	test("keeps a title-less person named เมือง separate from the district alias", () => {
		const parser = createAddressParser(
			{
				...resources,
				locations: [
					{
						subdistrict: "ธาตุเชิงชุม",
						district: "เมืองสกลนคร",
						province: "สกลนคร",
						zipcode: "47000",
					},
				],
			},
			{ diagnostics: "full" },
		);
		const raw =
			"เมือง ชัยพร\nโทร 0812345678\nบ้านเลขที่ 12 ซอยร่วมใจ ถนนนิตโย ต.ธาตุเชิงชุม อ.เมือง จ.สกลนคร 47000";

		const result = parser.parse(raw);
		expect(result.fields).toEqual({
			name: "เมือง ชัยพร",
			phone: "0812345678",
			address: "บ้านเลขที่ 12 ซอยร่วมใจ ถนนนิตโย",
			subdistrict: "ธาตุเชิงชุม",
			district: "เมืองสกลนคร",
			province: "สกลนคร",
			zipcode: "47000",
		});
		expect(result.diagnostics.candidateRejections).toContainEqual({
			label: "DISTRICT",
			text: "เมือง",
			start: 0,
			end: 5,
			ruleId: "location.city-unscoped",
		});
	});

	test("explains why a title-less first-line recipient was accepted", () => {
		const parser = createAddressParser(resources, { diagnostics: "full" });
		const raw =
			"สมชาย ใจดี\nโทร 0812345678\nบ้านเลขที่ 12 ปทุมวัน ปทุมวัน กรุงเทพมหานคร 10330";

		const result = parser.parse(raw);
		const acceptedName = result.diagnostics.candidateTrace?.find(
			(candidate) => candidate.label === "NAME" && candidate.outcome === "accepted",
		);

		expect(result.fields.name).toBe("สมชาย ใจดี");
		expect(acceptedName?.evidence.map((item) => item.ruleId)).toContain(
			"name.titleless-first-line",
		);
	});

	test("expands the informal อ.เมือง abbreviation using the province tuple", () => {
		const parser = createAddressParser({
			...resources,
			locations: [
				{
					subdistrict: "งิ้วด่อน",
					district: "เมืองสกลนคร",
					province: "สกลนคร",
					zipcode: "47000",
				},
			],
		});
		const raw =
			"คุณปิยะดา แสงคำ\n089-123-4567\nบ้านเลขที่ 18/7 หมู่2 ซอยร่วมพัฒนา ถ.สกล-นาแก ต.งิ้วด่อน อ.เมือง จ สกลนคร 47000";

		expect(parser.parse(raw).fields).toEqual({
			name: "คุณปิยะดา แสงคำ",
			phone: "0891234567",
			address: "บ้านเลขที่ 18/7 หมู่2 ซอยร่วมพัฒนา ถ.สกล-นาแก",
			subdistrict: "งิ้วด่อน",
			district: "เมืองสกลนคร",
			province: "สกลนคร",
			zipcode: "47000",
		});
	});

	test("resolves city alias from the final province mention", () => {
		const parser = createAddressParser({
			...resources,
			locations: [
				{
					subdistrict: "งิ้วด่อน",
					district: "เมืองสกลนคร",
					province: "สกลนคร",
					zipcode: "47000",
				},
				{
					subdistrict: "ปทุมวัน",
					district: "ปทุมวัน",
					province: "กรุงเทพมหานคร",
					zipcode: "10330",
				},
			],
		});
		const raw =
			"นายทดสอบ ใจดี\n0812345678\nบ้านเลขที่ 1 ถนนกรุงเทพมหานคร ต.งิ้วด่อน อ.เมือง จ.สกลนคร 47000";

		expect(parser.parse(raw).fields.district).toBe("เมืองสกลนคร");
	});

	test("keeps road text when an address line has no phone prefix", () => {
		const parser = createAddressParser({
			...resources,
			locations: [
				{
					subdistrict: "งิ้วด่อน",
					district: "เมืองสกลนคร",
					province: "สกลนคร",
					zipcode: "47000",
				},
			],
		});
		const raw =
			"บ้านเลขที่ 18/7 หมู่2 ซอยร่วมพัฒนา ถ.สกล-นาแก ต.งิ้วด่อน อ.เมือง จ สกลนคร 47000";

		expect(parser.parse(raw).fields).toMatchObject({
			address: "บ้านเลขที่ 18/7 หมู่2 ซอยร่วมพัฒนา ถ.สกล-นาแก",
			district: "เมืองสกลนคร",
		});
	});

	test("keeps a location-like road name inside address detail", () => {
		const parser = createAddressParser(resources);
		const raw =
			"นายทดสอบ ใจดี\n0812345678\nบ้านเลขที่ 1 ถนนปทุมวัน ตำบลปทุมวัน เขตปทุมวัน กรุงเทพมหานคร 10330";

		expect(parser.parse(raw).fields.address).toBe(
			"บ้านเลขที่ 1 ถนนปทุมวัน",
		);
	});

	test("normalizes dotted phones and Thai digits", () => {
		const parser = createAddressParser(resources);
		const dotted = parser.parse("นายทดสอบ ใจดี\n081.234.5678");
		const thai = parser.parse(
			"นายทดสอบ ใจดี\n๐๘๑-๒๓๔-๕๖๗๘\nบ้านเลขที่ 1 ปทุมวัน ปทุมวัน กรุงเทพมหานคร ๑๐๓๓๐",
		);

		expect(dotted.fields.phone).toBe("0812345678");
		expect(thai.fields.phone).toBe("0812345678");
		expect(thai.fields.zipcode).toBe("10330");
	});

	test("recognizes administrative prefixes with internal spacing", () => {
		const parser = createAddressParser(resources);
		const raw =
			"นายทดสอบ ใจดี\n0812345678\nบ้านเลขที่ 1 ถนนจันทน์ ต .ปทุมวัน อ .ปทุมวัน กรุงเทพมหานคร 10330";

		expect(parser.parse(raw).fields.address).toBe("บ้านเลขที่ 1 ถนนจันทน์");
	});

	test("keeps an explicitly prefixed subdistrict absent from the gazetteer", () => {
		const parser = createAddressParser(resources);
		const raw =
			"นายทดสอบ ใจดี\n0812345678\nบ้านเลขที่ 1 ต.บางใหม่ เขตปทุมวัน กรุงเทพมหานคร 10330";

		expect(parser.parse(raw).fields).toMatchObject({
			subdistrict: "บางใหม่",
			district: "ปทุมวัน",
			province: "กรุงเทพมหานคร",
			zipcode: "10330",
		});
	});

	test("recognizes an unprefixed subdistrict and city district before a province", () => {
		const parser = createAddressParser({
			...resources,
			locations: [
				{
					subdistrict: "ธาตุเชิงชุม",
					district: "เมืองสกลนคร",
					province: "สกลนคร",
					zipcode: "47000",
				},
			],
		});
		const raw =
			"คุณอัญชลี คำหอม\n092 778 6315\nอาคารพาณิชย์ 2 ชั้น ห้อง 3, 44/16 ซ.สุขสวัสดิ์ ถ.นิตโย ธาตุเชิงชุม เมือง สกลนคร จ.47000";

		expect(parser.parse(raw).fields).toEqual({
			name: "คุณอัญชลี คำหอม",
			phone: "0927786315",
			address: "อาคารพาณิชย์ 2 ชั้น ห้อง 3, 44/16 ซ.สุขสวัสดิ์ ถ.นิตโย",
			subdistrict: "ธาตุเชิงชุม",
			district: "เมืองสกลนคร",
			province: "สกลนคร",
			zipcode: "47000",
		});
	});

	test("abstains from an invalid postcode instead of inventing one", () => {
		const parser = createAddressParser(resources);
		const result = parser.parse("บ้านเลขที่ 1 ปทุมวัน ปทุมวัน กรุงเทพมหานคร 1033");

		expect(result.fields.zipcode).toBeNull();
	});

	test("does not accept a format-valid postcode that conflicts with the location", () => {
		const parser = createAddressParser(resources);
		const result = parser.parse("บ้านเลขที่ 1 ปทุมวัน ปทุมวัน กรุงเทพมหานคร 99999");

		expect(result.fields.province).toBe("กรุงเทพมหานคร");
		expect(result.fields.zipcode).toBeNull();
	});

	test("does not extract a postcode from inside a longer number", () => {
		const parser = createAddressParser(resources);
		const result = parser.parse("บ้านเลขที่ 610330 ปทุมวัน ปทุมวัน กรุงเทพมหานคร");

		expect(result.fields.zipcode).toBeNull();
	});

	test("rejects unsupported frozen feature resources", () => {
		expect(() =>
			createAddressParser({
				...resources,
				featureConfig: {
					...resources.featureConfig,
					version: "char-ngram-v1" as "char-ngram-v2",
				},
			}),
		).toThrow("Unsupported latent feature version");
	});

	test("rejects unsupported scoring resources", () => {
		expect(() =>
			createAddressParser({
				...resources,
				scoringConfig: {
					...resources.scoringConfig,
					version: "label-mix-v0" as "label-mix-v1",
				} as ParserResources["scoringConfig"],
			}),
		).toThrow("Unsupported latent scoring version");
	});

	test("rejects invalid decoder options", () => {
		expect(() => createAddressParser(resources, { beamWidth: 0 })).toThrow();
		expect(() =>
			createAddressParser(resources, { minFieldConfidence: Number.NaN }),
		).toThrow();
	});

	test("full diagnostics preserve the validator abstention reason", () => {
		const parser = createAddressParser(resources, {
			diagnostics: "full",
			minFieldConfidence: 1,
		});

		const result = parser.parse("นายทดสอบ ใจดี");

		expect(
			result.diagnostics.candidateTrace?.some(
				(candidate) =>
					candidate.label === "NAME" &&
					candidate.outcome === "abstained" &&
					candidate.reason === "low-confidence",
			),
		).toBe(true);
	});
});

describe("createAddressParser fuzzy location recovery", () => {
	test("resolves a misspelled province to its correct canonical spelling", () => {
		const parser = createAddressParser({
			...resources,
			locations: [
				{
					subdistrict: "ศรีภูมิ",
					district: "เมืองเชียงใหม่",
					province: "เชียงใหม่",
					zipcode: "50200",
				},
			],
		});
		const raw =
			"คุณสมชาย ใจดี\n0812345678\nบ้านเลขที่ 1 ต.ศรีภูมิ อ.เมืองเชียงใหม่ จ.เชียงใหม 50200";

		expect(parser.parse(raw).fields).toMatchObject({
			subdistrict: "ศรีภูมิ",
			district: "เมืองเชียงใหม่",
			province: "เชียงใหม่",
			zipcode: "50200",
		});
	});

	test("resolves a misspelled district after อ. using the province-scoped index", () => {
		const parser = createAddressParser({
			...resources,
			locations: [
				{
					subdistrict: "สันทรายหลวง",
					district: "สันทราย",
					province: "เชียงใหม่",
					zipcode: "50210",
				},
			],
		});
		const raw =
			"คุณอารีย์ พรมมา\n0898887777\nบ้านเลขที่ 9 ต.สันทรายหลวง อ.สันทาย จ.เชียงใหม่ 50210";

		expect(parser.parse(raw).fields).toMatchObject({
			subdistrict: "สันทรายหลวง",
			district: "สันทราย",
			province: "เชียงใหม่",
			zipcode: "50210",
		});
	});

	test("resolves a misspelled subdistrict after ต. using the province-scoped index", () => {
		const parser = createAddressParser({
			...resources,
			locations: [
				{
					subdistrict: "ศรีภูมิ",
					district: "เมืองเชียงใหม่",
					province: "เชียงใหม่",
					zipcode: "50200",
				},
			],
		});
		const raw =
			"คุณดารุณี ทองดี\n0865554444\nบ้านเลขที่ 5 ต.ศรีพูมิ อ.เมืองเชียงใหม่ จ.เชียงใหม่ 50200";

		expect(parser.parse(raw).fields).toMatchObject({
			subdistrict: "ศรีภูมิ",
			district: "เมืองเชียงใหม่",
			province: "เชียงใหม่",
			zipcode: "50200",
		});
	});

	test("abstains instead of hallucinating a subdistrict from unrelated text after ต.", () => {
		const parser = createAddressParser(resources, {
			diagnostics: "full",
			minFieldConfidence: 0.9,
		});
		const raw =
			"นายทดสอบ ใจดี\n0812345678\nบ้านเลขที่ 1 ต.กระรอกน้อยเล่นซน เขตปทุมวัน กรุงเทพมหานคร 10330";

		const result = parser.parse(raw);

		expect(result.fields.subdistrict).toBeNull();
		expect(result.abstentions).toContainEqual({
			field: "subdistrict",
			reason: "low-confidence",
		});
		expect(result.diagnostics.candidateRejections).toContainEqual({
			label: "SUBDISTRICT",
			text: "กระรอกน้อยเล่นซน",
			start: 40,
			end: 56,
			ruleId: "location.fuzzy-no-match",
		});
	});

	test("keeps the raw unmatched text rather than snapping to a wrong existing subdistrict", () => {
		const parser = createAddressParser(resources, { diagnostics: "full" });
		const raw =
			"นายทดสอบ ใจดี\n0812345678\nบ้านเลขที่ 1 ต.กระรอกน้อยเล่นซน เขตปทุมวัน กรุงเทพมหานคร 10330";

		const result = parser.parse(raw);

		expect(result.fields.subdistrict).toBe("กระรอกน้อยเล่นซน");
		expect(result.fields.subdistrict).not.toBe("ปทุมวัน");
		expect(result.diagnostics.candidateRejections).toContainEqual({
			label: "SUBDISTRICT",
			text: "กระรอกน้อยเล่นซน",
			start: 40,
			end: 56,
			ruleId: "location.fuzzy-no-match",
		});
	});
});
