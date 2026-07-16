import { LABELS, type Label, type LocationTuple } from "../src/types";

export interface DatasetSpan {
  readonly label: Label;
  readonly text: string;
  readonly canonical: string | null;
  readonly start: number;
  readonly end: number;
  readonly codePointStart: number;
  readonly codePointEnd: number;
}

export interface ExpectedAddress {
  readonly name: string | null;
  readonly phone: string | null;
  readonly address: string | null;
  readonly subdistrict: string | null;
  readonly district: string | null;
  readonly province: string | null;
  readonly zipcode: string | null;
}

export interface DatasetRecord {
  readonly id: string;
  readonly raw: string;
  readonly caseType: string;
  readonly difficulty: string;
  readonly spans: readonly DatasetSpan[];
  readonly expected: ExpectedAddress;
  readonly seedLocation: LocationTuple;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`${field} must be a string or null`);
  return value;
}

function parseLocation(value: unknown): LocationTuple {
  if (!isObject(value)) throw new Error("seedLocation must be an object");
  const fields = ["subdistrict", "district", "province", "zipcode"] as const;
  const result = {} as Record<(typeof fields)[number], string>;
  for (const field of fields) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      throw new Error(`seedLocation.${field} must be a non-empty string`);
    }
    result[field] = value[field];
  }
  return result;
}

function codePointOffset(raw: string, utf16Offset: number): number {
  return Array.from(raw.slice(0, utf16Offset)).length;
}

function parseRecord(value: unknown, line: number): DatasetRecord {
  if (!isObject(value)) throw new Error(`line ${line}: record must be an object`);
  if (typeof value.id !== "string" || typeof value.raw !== "string") {
    throw new Error(`line ${line}: id and raw must be strings`);
  }
  const raw = value.raw;
  if (typeof value.caseType !== "string" || typeof value.difficulty !== "string") {
    throw new Error(`line ${line}: caseType and difficulty must be strings`);
  }
  if (!Array.isArray(value.spans)) throw new Error(`line ${line}: spans must be an array`);
  if (!isObject(value.expected)) throw new Error(`line ${line}: expected must be an object`);

  const spans = value.spans.map((span, index): DatasetSpan => {
    if (!isObject(span)) throw new Error(`line ${line}: span ${index} must be an object`);
    if (!LABELS.includes(span.label as Label)) throw new Error(`line ${line}: invalid span label`);
    if (
      typeof span.text !== "string" ||
      !(span.canonical === null || typeof span.canonical === "string") ||
      !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) ||
      !Number.isInteger(span.codePointStart) ||
      !Number.isInteger(span.codePointEnd)
    ) {
      throw new Error(`line ${line}: malformed span ${index}`);
    }
    const start = span.start as number;
    const end = span.end as number;
    const codePointStart = span.codePointStart as number;
    const codePointEnd = span.codePointEnd as number;
    if (
      start < 0 || end <= start || end > raw.length ||
      raw.slice(start, end) !== span.text ||
      codePointOffset(raw, start) !== codePointStart ||
      codePointOffset(raw, end) !== codePointEnd
    ) {
      throw new Error(`line ${line}: invalid offsets in span ${index}`);
    }
    return {
      label: span.label as Label,
      text: span.text,
      canonical: span.canonical as string | null,
      start,
      end,
      codePointStart,
      codePointEnd,
    };
  });

  const expected = {
    name: nullableString(value.expected.name, `line ${line}: expected.name`),
    phone: nullableString(value.expected.phone, `line ${line}: expected.phone`),
    address: nullableString(value.expected.address, `line ${line}: expected.address`),
    subdistrict: nullableString(value.expected.subdistrict, `line ${line}: expected.subdistrict`),
    district: nullableString(value.expected.district, `line ${line}: expected.district`),
    province: nullableString(value.expected.province, `line ${line}: expected.province`),
    zipcode: nullableString(value.expected.zipcode, `line ${line}: expected.zipcode`),
  };
  return {
    id: value.id,
    raw,
    caseType: value.caseType,
    difficulty: value.difficulty,
    spans,
    expected,
    seedLocation: parseLocation(value.seedLocation),
  };
}

export function parseJsonl(text: string): readonly DatasetRecord[] {
  const records: DatasetRecord[] = [];
  const ids = new Set<string>();
  for (const [index, rawLine] of text.split(/\r?\n/u).entries()) {
    if (!rawLine.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(rawLine);
    } catch (error) {
      throw new Error(`line ${index + 1}: invalid JSON: ${String(error)}`);
    }
    const record = parseRecord(value, index + 1);
    if (ids.has(record.id)) throw new Error(`line ${index + 1}: duplicate id ${record.id}`);
    ids.add(record.id);
    records.push(record);
  }
  return records;
}

export async function loadDataset(path: string): Promise<readonly DatasetRecord[]> {
  return parseJsonl(await Bun.file(path).text());
}
