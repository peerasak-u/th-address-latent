import { OUTPUT_LABELS } from "../labels";
import type { Candidate, DecodeResult, OutputLabel } from "../types";

interface BeamState {
  readonly selected: readonly Candidate[];
  readonly score: number;
}

function overlaps(left: Candidate, right: Candidate): boolean {
  return left.start < right.end && right.start < left.end;
}

function intersect(left: readonly number[], right: readonly number[]): readonly number[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function adminIds(selected: readonly Candidate[]): readonly number[] | null {
  let ids: readonly number[] | null = null;
  for (const candidate of selected) {
    if (!["SUBDISTRICT", "DISTRICT", "PROVINCE", "POSTCODE"].includes(candidate.label)) continue;
    if (candidate.locationIds.length === 0) continue;
    ids = ids === null ? candidate.locationIds : intersect(ids, candidate.locationIds);
  }
  return ids;
}

function additionScore(selected: readonly Candidate[], candidate: Candidate): number {
  let score = candidate.score - 0.5;
  if (["SUBDISTRICT", "DISTRICT", "PROVINCE", "POSTCODE"].includes(candidate.label)) {
    const existing = adminIds(selected);
    if (existing !== null) {
      const coherent = candidate.locationIds.length > 0 &&
        intersect(existing, candidate.locationIds).length > 0;
      score += coherent ? 0.22 : -0.9;
    }
  }
  return score;
}

function orderBonus(selected: readonly Candidate[]): number {
  const byLabel = new Map<OutputLabel, Candidate>();
  for (const candidate of selected) byLabel.set(candidate.label, candidate);
  const pairs: Array<[OutputLabel, OutputLabel, number]> = [
    ["NAME", "ADDRESS_DETAIL", 0.04],
    ["SUBDISTRICT", "DISTRICT", 0.06],
    ["DISTRICT", "PROVINCE", 0.06],
    ["PROVINCE", "POSTCODE", 0.03],
  ];
  let bonus = 0;
  for (const [leftLabel, rightLabel, weight] of pairs) {
    const left = byLabel.get(leftLabel);
    const right = byLabel.get(rightLabel);
    if (left && right) bonus += left.start <= right.start ? weight : -weight;
  }
  return bonus;
}

export function pruneCandidates(
  candidates: readonly Candidate[],
  beamWidth = 64,
  candidatesPerLabel = 24,
): DecodeResult {
  let beam: readonly BeamState[] = [{ selected: [], score: 0 }];
  let hypothesesEvaluated = 0;

  for (const label of OUTPUT_LABELS) {
    const choices = candidates
      .filter((candidate) => candidate.label === label && candidate.score >= 0.48)
      .sort((left, right) =>
        right.score - left.score ||
        (right.end - right.start) - (left.end - left.start) ||
        left.start - right.start,
      )
      .slice(0, candidatesPerLabel);
    const next: BeamState[] = [];
    for (const state of beam) {
      next.push(state);
      hypothesesEvaluated += 1;
      for (const candidate of choices) {
        hypothesesEvaluated += 1;
        if (state.selected.some((selected) => overlaps(selected, candidate))) continue;
        next.push({
          selected: [...state.selected, candidate],
          score: state.score + additionScore(state.selected, candidate),
        });
      }
    }
    beam = next
      .sort((left, right) =>
        right.score + orderBonus(right.selected) - (left.score + orderBonus(left.selected)),
      )
      .slice(0, Math.max(1, beamWidth));
  }

  const best = beam[0] ?? { selected: [], score: 0 };
  return {
    selected: [...best.selected].sort((left, right) => left.start - right.start),
    score: best.score + orderBonus(best.selected),
    hypothesesEvaluated,
  };
}
