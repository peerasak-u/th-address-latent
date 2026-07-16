import type { LocationTuple } from "../src/types";

function stripPrefix(value: string, prefixes: readonly string[]): string {
  for (const prefix of prefixes) {
    if (value.startsWith(prefix)) return value.slice(prefix.length).trim();
  }
  return value.trim();
}

export async function loadGazetteer(path: string): Promise<readonly LocationTuple[]> {
  const source: unknown = await Bun.file(path).json();
  if (!Array.isArray(source)) throw new Error("gazetteer root must be an array");
  const unique = new Map<string, LocationTuple>();
  for (const row of source) {
    if (typeof row !== "object" || row === null || !("name" in row) || typeof row.name !== "string") {
      throw new Error("gazetteer row must contain a string name");
    }
    const name = row.name as string;
    const parts = name.split(",").map((part: string) => part.trim());
    if (parts.length !== 4) throw new Error(`invalid gazetteer row: ${row.name}`);
    const [rawSubdistrict, rawDistrict, rawProvince, zipcode] = parts;
    if (!rawSubdistrict || !rawDistrict || !rawProvince || !zipcode || !/^\d{5}$/u.test(zipcode)) {
      throw new Error(`invalid gazetteer row: ${row.name}`);
    }
    const tuple = {
      subdistrict: stripPrefix(rawSubdistrict, ["แขวง", "ตำบล", "ต."]),
      district: stripPrefix(rawDistrict, ["กิ่งอำเภอ", "อำเภอ", "เขต", "อ."]),
      province: stripPrefix(rawProvince, ["จังหวัด", "จ."]),
      zipcode,
    };
    unique.set(Object.values(tuple).join("\u0000"), tuple);
  }
  return [...unique.values()];
}
