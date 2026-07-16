import { buildLocationTerms } from "./location-index";
import { spanFeatures, scoreDirection } from "./latent/features";
import { normalizeCandidate } from "./normalize";
import type { Candidate, OutputLabel, ParserResources } from "./types";

interface CandidateSeed {
	label: OutputLabel;
	start: number;
	end: number;
	canonical?: string;
	evidence: number;
	locationId?: number;
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

function matches(
	pattern: RegExp,
	raw: string,
): Array<{ start: number; end: number }> {
	const copy = new RegExp(pattern.source, pattern.flags);
	const result: Array<{ start: number; end: number }> = [];
	for (const match of raw.matchAll(copy)) {
		const start = match.index;
		if (start === undefined || match[0].length === 0) continue;
		result.push({ start, end: start + match[0].length });
	}
	return result;
}

function overlaps(
	left: { start: number; end: number },
	right: { start: number; end: number },
): boolean {
	return left.start < right.end && right.start < left.end;
}

function trimRange(
	raw: string,
	start: number,
	end: number,
): { start: number; end: number } | null {
	while (start < end && /\s/u.test(raw[start] ?? "")) start += 1;
	while (end > start && /\s/u.test(raw[end - 1] ?? "")) end -= 1;
	return start < end ? { start, end } : null;
}

function seedKey(seed: CandidateSeed): string {
	return `${seed.label}\u0000${seed.start}\u0000${seed.end}\u0000${seed.canonical ?? ""}`;
}

function addSeed(
	target: Map<string, CandidateSeed>,
	seed: CandidateSeed,
): void {
	const key = seedKey(seed);
	const previous = target.get(key);
	if (!previous) {
		target.set(key, seed);
		return;
	}
	target.set(key, {
		...previous,
		evidence: Math.max(previous.evidence, seed.evidence),
		...(previous.locationId === undefined && seed.locationId !== undefined
			? { locationId: seed.locationId }
			: {}),
	});
}

export function generateCandidates(
	raw: string,
	resources: ParserResources,
): readonly Candidate[] {
	const seeds = new Map<string, CandidateSeed>();
	const locationIdsBySeed = new Map<string, Set<number>>();
	const locationTerms = buildLocationTerms(resources.locations);
	const addressHintRanges = matches(ADDRESS_HINT, raw);
	const addressLabels = matches(ADDRESS_LABEL, raw);
	const provinceHint = [...new Set(
		locationTerms
			.filter((term) => term.label === "PROVINCE")
			.map((term) => term.surface),
	)]
		.filter((province) => raw.includes(province))
		.sort((left, right) => right.length - left.length)[0];

	const phoneRanges = matches(PHONE_PATTERN, raw);
	const administrativeRanges = matches(ADMIN_HINT, raw);
	for (const range of phoneRanges) {
		const canonical = normalizeCandidate(
			"PHONE",
			raw.slice(range.start, range.end),
		);
		if (canonical)
			addSeed(seeds, { label: "PHONE", ...range, canonical, evidence: 0.99 });
	}

	for (const range of matches(POSTCODE_PATTERN, raw)) {
		if (phoneRanges.some((phone) => overlaps(phone, range))) continue;
		addSeed(seeds, {
			label: "POSTCODE",
			...range,
			canonical: raw.slice(range.start, range.end),
			evidence: 0.94,
		});
	}

	for (const term of locationTerms) {
		let from = 0;
		while (from <= raw.length - term.surface.length) {
			const start = raw.indexOf(term.surface, from);
			if (start < 0) break;
			const end = start + term.surface.length;
			const location = resources.locations[term.locationId];
			const cityStart = raw.indexOf("เมือง", end);
			const provinceStart = location
				? raw.indexOf(location.province, cityStart < 0 ? end : cityStart + "เมือง".length)
				: -1;
			const hasCityProvinceSequence =
				location !== undefined &&
				provinceHint !== undefined &&
				location.province === provinceHint &&
				((term.label === "SUBDISTRICT" && cityStart >= end && provinceStart > cityStart) ||
					(term.label === "DISTRICT" &&
						term.surface === "เมือง" &&
						raw.slice(0, start).includes(location.subdistrict) &&
						provinceStart > start));
			const isProvinceHint =
				term.label === "PROVINCE" && term.surface === provinceHint;
			if (
				term.label === "DISTRICT" &&
				term.surface === "เมือง" &&
				(!(
					provinceHint !== undefined &&
					location?.province === provinceHint &&
					(/อ\.\s*$/u.test(raw.slice(0, start)) || hasCityProvinceSequence)
				))
			) {
				from = start + Math.max(1, term.surface.length);
				continue;
			}
			if (
				["SUBDISTRICT", "DISTRICT", "PROVINCE", "POSTCODE"].includes(term.label) &&
				(phoneRanges.some((phone) => start < phone.start) ||
					(() => {
						const firstAdminAfterPhone = administrativeRanges.find((admin) =>
							phoneRanges.some((phone) => admin.start > phone.end),
						);
						const firstAdminAfterAddress = administrativeRanges.find((admin) =>
							admin.start > start,
						);
						const startsInAddressContext =
							addressHintRanges.some((hint) => start >= hint.start) ||
							addressLabels.some((label) => start >= label.end);
						return firstAdminAfterPhone !== undefined &&
							phoneRanges.some((phone) => start > phone.end) &&
							start < firstAdminAfterPhone.start &&
							!hasCityProvinceSequence &&
							!isProvinceHint ||
							(firstAdminAfterAddress !== undefined &&
								startsInAddressContext &&
								!administrativeRanges.some((admin) => admin.start <= start) &&
								!hasCityProvinceSequence &&
								!isProvinceHint);
					})())
			) {
				from = start + Math.max(1, term.surface.length);
				continue;
			}
			if (
				term.label === "POSTCODE" &&
				(/\d/u.test(raw[start - 1] ?? "") || /\d/u.test(raw[end] ?? ""))
			) {
				from = start + Math.max(1, term.surface.length);
				continue;
			}
			const seed: CandidateSeed = {
				label: term.label,
				start,
				end,
				canonical: term.canonical,
				evidence: 0.96,
				locationId: term.locationId,
			};
			addSeed(seeds, seed);
			const ids = locationIdsBySeed.get(seedKey(seed)) ?? new Set<number>();
			ids.add(term.locationId);
			locationIdsBySeed.set(seedKey(seed), ids);
			from = start + Math.max(1, term.surface.length);
		}
	}

	const anchors = [...seeds.values()].filter((seed) => seed.evidence >= 0.9);
	const boundaries = new Set<number>([0, raw.length]);
	for (const anchor of anchors) {
		boundaries.add(anchor.start);
		boundaries.add(anchor.end);
	}
	for (const range of [
		...matches(ADDRESS_HINT, raw),
		...matches(TITLE_HINT, raw),
	]) {
		boundaries.add(range.start);
	}
	for (const range of administrativeRanges) {
		boundaries.add(range.start);
		boundaries.add(range.end);
	}
	const recipientLabels = matches(RECIPIENT_LABEL, raw);
	const phoneLabels = matches(PHONE_LABEL, raw);
	const separators = matches(CHAT_SEPARATOR, raw);
	const excludedBoundaryLabels = [
		...recipientLabels,
		...phoneLabels,
		...addressLabels,
		...administrativeRanges,
		...separators,
	];
	for (const range of excludedBoundaryLabels) {
		boundaries.add(range.start);
		boundaries.add(range.end);
	}

	const ordered = [...boundaries].sort((left, right) => left - right);
	for (let startIndex = 0; startIndex < ordered.length; startIndex += 1) {
		for (
			let endIndex = startIndex + 1;
			endIndex < ordered.length;
			endIndex += 1
		) {
			const rawStart = ordered[startIndex];
			const rawEnd = ordered[endIndex];
			if (
				rawStart === undefined ||
				rawEnd === undefined ||
				rawEnd - rawStart > 140
			)
				continue;
			const range = trimRange(raw, rawStart, rawEnd);
			if (!range || anchors.some((anchor) => overlaps(anchor, range))) continue;
			if (excludedBoundaryLabels.some((label) => overlaps(label, range)))
				continue;
			const text = raw.slice(range.start, range.end);
			if (text.length < 2) continue;

			const hasAddressWord = ADDRESS_WORD.test(text);
			const hasDigit = /\d/u.test(text);
			const hasTitle = TITLE_WORD.test(text);
			const followsRecipientLabel = recipientLabels.some(
				(label) => raw.slice(label.end, range.start).trim().length === 0,
			);
			const followsAddressLabel = addressLabels.some(
				(label) => raw.slice(label.end, range.start).trim().length === 0,
			);
			const thaiRatio =
				(text.match(/[ก-๙]/gu)?.length ?? 0) /
				Math.max(1, Array.from(text).length);

			let nameEvidence = followsRecipientLabel
				? 0.96
				: hasTitle
					? 0.94
					: thaiRatio > 0.7 && !hasDigit
						? 0.62
						: 0.2;
			if (hasAddressWord || hasDigit) nameEvidence -= 0.5;
			let addressEvidence =
				followsAddressLabel || hasAddressWord || /^\d+(?:\/\d+)?/u.test(text)
					? 0.94
					: 0.45;
			if (hasTitle) addressEvidence -= 0.4;

			addSeed(seeds, {
				label: "NAME",
				...range,
				evidence: Math.max(0, nameEvidence),
			});
			addSeed(seeds, {
				label: "ADDRESS_DETAIL",
				...range,
				evidence: Math.max(0, addressEvidence),
			});
		}
	}

	return [...seeds.values()].map((seed) => {
		const text = raw.slice(seed.start, seed.end);
		const features = spanFeatures(
			raw,
			seed.start,
			seed.end,
			resources.featureDimension,
			resources.featureConfig,
		);
		const latentScore = scoreDirection(
			features,
			seed.label,
			resources.labelDirections,
		);
		const score = Math.max(
			0,
			Math.min(
				1,
				(resources.scoringConfig.latentWeightByLabel[seed.label] ?? 0.55) * latentScore +
				(1 - (resources.scoringConfig.latentWeightByLabel[seed.label] ?? 0.55)) * seed.evidence,
			),
		);
		return {
			label: seed.label,
			text,
			canonical: seed.canonical ?? normalizeCandidate(seed.label, text) ?? text,
			start: seed.start,
			end: seed.end,
			latentScore,
			evidenceScore: seed.evidence,
			score,
			locationIds: [...(locationIdsBySeed.get(seedKey(seed)) ?? [])],
		};
	});
}
