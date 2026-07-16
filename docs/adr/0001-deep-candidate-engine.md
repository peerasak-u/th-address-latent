# ADR-0001: Keep one deep candidate engine

- Status: Accepted
- Date: 2026-07-16

## Context

Candidate generation had accumulated context scanning, gazetteer matching, `เมือง` disambiguation, segment enumeration, evidence policy, and latent scoring in one 340-line function. New fixes repeatedly edited the same compound conditions.

## Decision

Keep the external parser seam small: `createAddressParser(resources).parse(raw)`. Implement candidate generation as one deep module with internal parse-context, structured-source, location-source, segment-source, evidence-rule, seed-store, and scoring seams.

Evidence rules use normal typed functions with explicit IDs, priorities, and bounded effects. We will not create a general-purpose rule DSL. The pruner and validator remain separate modules.

## Consequences

- Resource-derived location terms are compiled once per parser.
- Candidate traces can explain evidence, pruning, pre-candidate rejection, and validation abstention.
- Safe refactors can compare public parse output while internal modules evolve.
- Internal files may contain more total code than the previous function, but each domain decision has one locality.
