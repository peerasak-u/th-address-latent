import type { LocationTerm } from "../location-index";

export interface SpanRange {
	readonly start: number;
	readonly end: number;
}

export interface ParseContext {
	readonly raw: string;
	readonly phoneRanges: readonly SpanRange[];
	readonly postcodeRanges: readonly SpanRange[];
	readonly administrativeRanges: readonly SpanRange[];
	readonly addressHintRanges: readonly SpanRange[];
	readonly titleHintRanges: readonly SpanRange[];
	readonly recipientLabels: readonly SpanRange[];
	readonly phoneLabels: readonly SpanRange[];
	readonly addressLabels: readonly SpanRange[];
	readonly separators: readonly SpanRange[];
	readonly excludedRanges: readonly SpanRange[];
	readonly provinceHint?: string;
}

const PHONE_PATTERN =
	/(?<!\d)(?:(?:\+66|0066)[-\s]?[1-9]\d?(?:[-\s]?\d){7,8}|0[2-9]\d?(?:[-\s]?\d){6,8})(?!\d)/gu;
const POSTCODE_PATTERN = /(?<!\d)\d{5}(?!\d)/gu;
const ADDRESS_HINT =
	/(?:บ้านเลขที่|เลขที่|หมู่บ้าน|คอนโดมิเนียม|คอนโด|อพาร์ทเม้นท์|อพาร์ตเมนต์|หอพัก|โรงพยาบาล|โรงแรม|โรงงาน|โกดัง|ตลาด|คลินิก|ร้าน|โรงเรียน|อาคาร|โครงการ|สำนักงาน|ถนน|ซอย|ตึก|\d+(?:\/\d+)?)/gu;
const TITLE_HINT =
	/(?:เด็กชาย|เด็กหญิง|ด\.ช\.|ด\.ญ\.|นาย|นางสาว|นาง|น\.ส\.|ดร\.|คุณ|พระ|อาจารย์|ศาสตราจารย์)/gu;
const ADMIN_HINT = /(?:แขวง|ตำบล|ต\.|เขต|อำเภอ|อ\.|จังหวัด|จ\.)\s*/gu;
const RECIPIENT_LABEL = /(?:ชื่อผู้รับ|ผู้รับ|ชื่อ)\s*[:：]\s*/gu;
const PHONE_LABEL = /(?:เบอร์โทร|โทรศัพท์|โทร|เบอร์)\s*[:：]\s*/gu;
const ADDRESS_LABEL = /(?:ที่อยู่จัดส่ง|ที่อยู่|ส่งที่)\s*[:：]\s*/gu;
const CHAT_SEPARATOR = /(?:\||\r?\n)/gu;
const ADDRESS_WORD =
	/(?:บ้านเลขที่|เลขที่|หมู่บ้าน|คอนโด|อพาร์|หอพัก|โรงพยาบาล|โรงแรม|โรงงาน|โกดัง|ตลาด|คลินิก|ร้าน|โรงเรียน|อาคาร|โครงการ|สำนักงาน|ถนน|ซอย|ตึก)/u;
const TITLE_WORD =
	/^(?:เด็กชาย|เด็กหญิง|ด\.ช\.|ด\.ญ\.|นาย|นางสาว|นาง|น\.ส\.|ดร\.|คุณ|พระ|อาจารย์|ศาสตราจารย์)/u;

export function matches(pattern: RegExp, raw: string): readonly SpanRange[] {
	const copy = new RegExp(pattern.source, pattern.flags);
	const result: SpanRange[] = [];
	for (const match of raw.matchAll(copy)) {
		const start = match.index;
		if (start === undefined || match[0].length === 0) continue;
		result.push({ start, end: start + match[0].length });
	}
	return result;
}

export function overlaps(left: SpanRange, right: SpanRange): boolean {
	return left.start < right.end && right.start < left.end;
}

export function trimRange(
	raw: string,
	start: number,
	end: number,
): SpanRange | null {
	while (start < end && /\s/u.test(raw[start] ?? "")) start += 1;
	while (end > start && /\s/u.test(raw[end - 1] ?? "")) end -= 1;
	return start < end ? { start, end } : null;
}

export function containsAddressWord(text: string): boolean {
	return ADDRESS_WORD.test(text);
}

export function startsWithTitle(text: string): boolean {
	return TITLE_WORD.test(text);
}

export function buildParseContext(
	raw: string,
	locationTerms: readonly LocationTerm[],
): ParseContext {
	const phoneRanges = matches(PHONE_PATTERN, raw);
	const postcodeRanges = matches(POSTCODE_PATTERN, raw);
	const administrativeRanges = matches(ADMIN_HINT, raw);
	const addressHintRanges = matches(ADDRESS_HINT, raw);
	const titleHintRanges = matches(TITLE_HINT, raw);
	const recipientLabels = matches(RECIPIENT_LABEL, raw);
	const phoneLabels = matches(PHONE_LABEL, raw);
	const addressLabels = matches(ADDRESS_LABEL, raw);
	const separators = matches(CHAT_SEPARATOR, raw);
	const provinceHint = [...new Set(
		locationTerms
			.filter((term) => term.label === "PROVINCE")
			.map((term) => term.surface),
	)]
		.filter((province) => raw.includes(province))
		.sort((left, right) => right.length - left.length)[0];
	return {
		raw,
		phoneRanges,
		postcodeRanges,
		administrativeRanges,
		addressHintRanges,
		titleHintRanges,
		recipientLabels,
		phoneLabels,
		addressLabels,
		separators,
		excludedRanges: [
			...recipientLabels,
			...phoneLabels,
			...addressLabels,
			...administrativeRanges,
			...separators,
		],
		...(provinceHint === undefined ? {} : { provinceHint }),
	};
}
