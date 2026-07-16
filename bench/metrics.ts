import type { ExpectedAddress } from "./dataset";

export const FIELD_NAMES = [
  "name",
  "phone",
  "address",
  "subdistrict",
  "district",
  "province",
  "zipcode",
] as const satisfies readonly (keyof ExpectedAddress)[];

export interface MetricAccumulator {
  records: number;
  exactRecords: number;
  failures: number;
  fields: Record<keyof ExpectedAddress, { correct: number; total: number }>;
}

export function createMetrics(): MetricAccumulator {
  return {
    records: 0,
    exactRecords: 0,
    failures: 0,
    fields: Object.fromEntries(
      FIELD_NAMES.map((field) => [field, { correct: 0, total: 0 }]),
    ) as MetricAccumulator["fields"],
  };
}

export function addResult(
  metrics: MetricAccumulator,
  expected: ExpectedAddress,
  actual: ExpectedAddress | null,
): void {
  metrics.records += 1;
  if (!actual) {
    metrics.failures += 1;
    for (const field of FIELD_NAMES) metrics.fields[field].total += 1;
    return;
  }
  let exact = true;
  for (const field of FIELD_NAMES) {
    const fieldMetric = metrics.fields[field];
    fieldMetric.total += 1;
    if (actual[field] === expected[field]) fieldMetric.correct += 1;
    else exact = false;
  }
  if (exact) metrics.exactRecords += 1;
}

export function summarize(metrics: MetricAccumulator): object {
  return {
    records: metrics.records,
    exactRecords: metrics.exactRecords,
    exactRecordAccuracy: metrics.records === 0 ? 0 : metrics.exactRecords / metrics.records,
    failures: metrics.failures,
    failureRate: metrics.records === 0 ? 0 : metrics.failures / metrics.records,
    fields: Object.fromEntries(
      FIELD_NAMES.map((field) => {
        const value = metrics.fields[field];
        return [field, {
          correct: value.correct,
          total: value.total,
          accuracy: value.total === 0 ? 0 : value.correct / value.total,
        }];
      }),
    ),
  };
}
