import type { DatasetRecord } from "./dataset";

function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

function locationKey(record: DatasetRecord): string {
  const location = record.seedLocation;
  return `${location.subdistrict}\u0000${location.district}\u0000${location.province}\u0000${location.zipcode}`;
}

export interface DatasetSplit {
  readonly train: readonly DatasetRecord[];
  readonly evaluation: readonly DatasetRecord[];
}

export function splitByLocation(
  records: readonly DatasetRecord[],
  seed: string,
  evaluationRatio = 0.2,
): DatasetSplit {
  if (!(evaluationRatio > 0 && evaluationRatio < 1)) {
    throw new Error("evaluationRatio must be between zero and one");
  }
  const threshold = Math.floor(evaluationRatio * 10_000);
  const groups = new Map<string, DatasetRecord[]>();
  for (const record of records) {
    const key = locationKey(record);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }

  const trainGroups = new Map(groups);
  const evaluationGroups = new Map<string, DatasetRecord[]>();
  for (const [key, group] of groups) {
    const bucket = hash(`${seed}\u0000${key}`) % 10_000;
    if (bucket < threshold) {
      evaluationGroups.set(key, group);
      trainGroups.delete(key);
    }
  }

  const coveredCases = new Set(
    [...evaluationGroups.values()].flat().map((record) => record.caseType),
  );
  const allCases = new Set(records.map((record) => record.caseType));
  for (const caseType of allCases) {
    if (coveredCases.has(caseType)) continue;
    const candidate = [...trainGroups.entries()]
      .filter(([, group]) => group.some((record) => record.caseType === caseType))
      .sort(([left], [right]) =>
        hash(`${seed}\u0000coverage\u0000${left}`) - hash(`${seed}\u0000coverage\u0000${right}`),
      )[0];
    if (!candidate) continue;
    const [key, group] = candidate;
    evaluationGroups.set(key, group);
    trainGroups.delete(key);
    for (const record of group) coveredCases.add(record.caseType);
  }

  const train = [...trainGroups.values()].flat();
  const evaluation = [...evaluationGroups.values()].flat();
  if (train.length === 0 || evaluation.length === 0) {
    throw new Error("split produced an empty partition");
  }
  return { train, evaluation };
}
