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

export interface TrainingDatasetSplit extends DatasetSplit {
	readonly development: readonly DatasetRecord[];
	readonly excluded: readonly DatasetRecord[];
	readonly method: "location-and-declared-template-held-out";
}

function validateDeclaredTemplates(records: readonly DatasetRecord[]): void {
	const declarations = new Map<string, "train" | "evaluation">();
	for (const record of records) {
		const { templateFamily, declaredSplit } = record.partition;
		if (!templateFamily || !declaredSplit) continue;
		const previous = declarations.get(templateFamily);
		if (previous && previous !== declaredSplit) {
			throw new Error(
				`template family ${templateFamily} appears in both declared splits`,
			);
		}
		declarations.set(templateFamily, declaredSplit);
	}
}

/**
 * Creates train/development/evaluation partitions without sharing an
 * authoritative location tuple. Generator-declared evaluation template
 * families are admitted only to evaluation; declared training families are
 * admitted only to train/development. Ineligible cross-product records are
 * retained in `excluded` for an auditable resource artifact.
 */
export function splitForTraining(
	records: readonly DatasetRecord[],
	seed: string,
	developmentRatio = 0.15,
	evaluationRatio = 0.2,
): TrainingDatasetSplit {
	if (
		!(developmentRatio > 0) ||
		!(evaluationRatio > 0) ||
		developmentRatio + evaluationRatio >= 1
	) {
		throw new Error("development and evaluation ratios must be positive and sum below one");
	}
	validateDeclaredTemplates(records);
	const developmentThreshold = Math.floor(developmentRatio * 10_000);
	const evaluationThreshold = Math.floor(
		(developmentRatio + evaluationRatio) * 10_000,
	);
	const groups = new Map<string, DatasetRecord[]>();
	for (const record of records) {
		const key = locationKey(record);
		const group = groups.get(key) ?? [];
		group.push(record);
		groups.set(key, group);
	}

	const train: DatasetRecord[] = [];
	const development: DatasetRecord[] = [];
	const evaluation: DatasetRecord[] = [];
	const excluded: DatasetRecord[] = [];
	for (const [key, group] of groups) {
		const bucket = hash(`${seed}\u0000partition\u0000${key}`) % 10_000;
		const partition = bucket < developmentThreshold
			? "development"
			: bucket < evaluationThreshold
				? "evaluation"
				: "train";
		for (const record of group) {
			const declared = record.partition.declaredSplit;
			const eligible = partition === "evaluation"
				? declared !== "train"
				: declared !== "evaluation";
			if (!eligible) {
				excluded.push(record);
			} else if (partition === "development") {
				development.push(record);
			} else if (partition === "evaluation") {
				evaluation.push(record);
			} else {
				train.push(record);
			}
		}
	}
	if (train.length === 0 || development.length === 0 || evaluation.length === 0) {
		throw new Error("split produced an empty train, development, or evaluation partition");
	}
	return {
		train,
		development,
		evaluation,
		excluded,
		method: "location-and-declared-template-held-out",
	};
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
