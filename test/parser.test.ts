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
		const parser = createAddressParser(resources);
		const raw =
			"ผู้รับ: Nok Chaiyaporn\nโทร: 0812345678\nที่อยู่: 45 ถนนจันทน์ ตำบลปทุมวัน เขตปทุมวัน กรุงเทพมหานคร 10330";

		expect(parser.parse(raw).fields).toMatchObject({
			name: "Nok Chaiyaporn",
			phone: "0812345678",
			address: "45 ถนนจันทน์",
			subdistrict: "ปทุมวัน",
			district: "ปทุมวัน",
			province: "กรุงเทพมหานคร",
			zipcode: "10330",
		});
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
			"เมือง ชัยพร\nโทร 0812345678\nบ้านเลขที่ 12 ซอยร่วมใจ ถนนนิตโย ต.ธาตุเชิงชุม อ.เมือง จ.สกลนคร 47000";

		expect(parser.parse(raw).fields).toEqual({
			name: "เมือง ชัยพร",
			phone: "0812345678",
			address: "บ้านเลขที่ 12 ซอยร่วมใจ ถนนนิตโย",
			subdistrict: "ธาตุเชิงชุม",
			district: "เมืองสกลนคร",
			province: "สกลนคร",
			zipcode: "47000",
		});
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
				scoringConfig: { ...resources.scoringConfig, version: "label-mix-v0" as "label-mix-v1" },
			}),
		).toThrow("Unsupported latent scoring version");
	});

	test("rejects invalid decoder options", () => {
		expect(() => createAddressParser(resources, { beamWidth: 0 })).toThrow();
		expect(() =>
			createAddressParser(resources, { minFieldConfidence: Number.NaN }),
		).toThrow();
	});
});
