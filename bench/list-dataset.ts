import { normalizePhone } from "../src/normalize";
import type { ExpectedAddress } from "./dataset";

export interface RecipientListRecord {
	readonly id: string;
	readonly raw: string;
	readonly style: "bangkok" | "province";
	readonly expected: ExpectedAddress;
}

function field(lines: readonly string[], prefix: string, block: number): string {
	const line = lines.find((item) => item.startsWith(prefix));
	if (!line) throw new Error(`recipient list block ${block}: missing ${prefix}`);
	const value = line.slice(prefix.length).trim();
	if (!value) throw new Error(`recipient list block ${block}: empty ${prefix}`);
	return value;
}

function parseAddress(
	value: string,
	block: number,
): { style: RecipientListRecord["style"]; expected: Omit<ExpectedAddress, "name" | "phone"> } {
	const bangkok = /^(.*?)\s+แขวง(.+?)\s+เขต(.+?)\s+(กรุงเทพมหานคร)\s+(\d{5})$/u.exec(value);
	if (bangkok) {
		const [, address, subdistrict, district, province, zipcode] = bangkok;
		if (address && subdistrict && district && province && zipcode) {
			return {
				style: "bangkok",
				expected: { address, subdistrict, district, province, zipcode },
			};
		}
	}
	const province = /^(.*?)\s+ตำบล(.+?)\s+อำเภอ(.+?)\s+จังหวัด(.+?)\s+(\d{5})$/u.exec(value);
	if (province) {
		const [, address, subdistrict, district, provinceName, zipcode] = province;
		if (address && subdistrict && district && provinceName && zipcode) {
			return {
				style: "province",
				expected: {
					address,
					subdistrict,
					district,
					province: provinceName,
					zipcode,
				},
			};
		}
	}
	throw new Error(`recipient list block ${block}: unsupported address structure`);
}

export function recipientListBlocks(text: string): readonly string[] {
	return text
		.replace(/\r\n?/gu, "\n")
		.split(/\n\s*---\s*\n/gu)
		.map((block) => block.trim())
		.filter(Boolean)
		.map((block) =>
			block
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean)
				.join("\n"),
		);
}

export function parseRecipientList(text: string): readonly RecipientListRecord[] {
	return recipientListBlocks(text)
		.flatMap((block, index): RecipientListRecord[] => {
			const blockNumber = index + 1;
			const lines = block.split("\n");
			const structured = lines.some((line) => line.startsWith("ชื่อผู้รับ:"));
			if (!structured) return [];
			const raw = lines.join("\n");
			const name = field(lines, "ชื่อผู้รับ:", blockNumber);
			const phone = normalizePhone(field(lines, "เบอร์โทร:", blockNumber));
			if (!phone) throw new Error(`recipient list block ${blockNumber}: invalid phone`);
			const address = parseAddress(
				field(lines, "ที่อยู่:", blockNumber),
				blockNumber,
			);
			return [{
				id: `recipient-list-${String(blockNumber).padStart(4, "0")}`,
				raw,
				style: address.style,
				expected: { name, phone, ...address.expected },
			}];
		});
}
