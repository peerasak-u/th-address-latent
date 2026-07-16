import type { OutputLabel } from "./types";

function asciiDigits(value: string): string {
	return value.replace(/[๐-๙]/gu, (digit) =>
		String("๐๑๒๓๔๕๖๗๘๙".indexOf(digit)),
	);
}

export function normalizePhone(value: string): string | null {
	let digits = asciiDigits(value).replace(/\D/g, "");
  if (digits.startsWith("0066")) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith("66")) digits = `0${digits.slice(2)}`;
  return /^0\d{8,9}$/.test(digits) ? digits : null;
}

export function normalizePostcode(value: string): string | null {
	const digits = asciiDigits(value).replace(/\D/g, "");
  return /^\d{5}$/.test(digits) ? digits : null;
}

export function normalizeCandidate(label: OutputLabel, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (label === "PHONE") return normalizePhone(trimmed);
  if (label === "POSTCODE") return normalizePostcode(trimmed);
  return trimmed.replace(/\s+/gu, " ");
}
