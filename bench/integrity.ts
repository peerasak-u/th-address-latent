import type { DatasetRecord } from "./dataset";

export function recordsChecksum(records: readonly DatasetRecord[]): string {
  const payload = records
    .map((record) => ({
      id: record.id,
      raw: record.raw,
      expected: record.expected,
      spans: record.spans,
      seedLocation: record.seedLocation,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}
