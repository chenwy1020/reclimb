# Task 1: graph decisions, queries and persistence

Implemented against the approved 0.7 design in `codex/reclimb-knowledge-graph`.

## Shared contract

- `KnowledgeRelation`: append-only `confirmed` / `retracted` decisions. The target owns `projectId`; source identity is recorded separately. One linear `rootId` / `previousId` history exists per directed source/target capability pair.
- `KnowledgeUse`: one immutable record per teaching version, with the actually selected public memory entries. Clearing a source project removes all incoming relations but preserves other projects' frozen uses as unavailable history.
- `buildKnowledgeView(snapshot, projectId, capabilityId?, search?)`: returns candidates, latest decisions with history, original evidence state, finite prerequisite gaps, use impacts and typed nodes/edges. No name match creates an effective relationship and equivalence never propagates transitively.
- `knowledgeMemory(snapshot, projectId, capabilityId)`: `{projectId, capabilityId, entries, instruction, fingerprint}`. Each entry identifies a relation decision, source project/capability, source evidence/attempt/session, date, help/outcome and public summary.
- `KnowledgeService(store)`: `confirm(input)`, `retract(input)`, `view(projectId, capabilityId?, search?)`, `rememberUse(teachingVersionId, memory)`.
- `confirm` input: `{projectId, targetCapabilityId, sourceCapabilityId, kind, reason}`. Kinds: `equivalent`, `related`, `prerequisite`. `retract` input: `{relationId, reason}`.
- Helpers exported for consumers: `knowledgeUseImpact`, `knowledgeEvidenceView`, `knowledgeRelationView`, `capabilitySignature`, `latestKnowledgeRelations`, schemas and `validateKnowledgeRecords`.

## Validity and resource boundaries

- Reusable history requires explicit equivalent confirmation, visible existing endpoints, unchanged semantic scope, valid `evidenceStanding`, a matching original attempt/session, zero help in both evidence and attempt, independent/delayed/transfer status, `outcome=met`, all applicable criteria met and coverage of the original rubric.
- Scope includes capability definition, project goal/current learning focus, prerequisites, unit core questions/outcomes/goal semantics and source text/confirmed transcriptions. Routine phase, position, completion status and timestamps are excluded; retirement removes the unit from current scope.
- Memory selects the most recent qualifying performances, at most 3 per source capability and 12 overall. Ties are deterministic. Project title is capped at 200 characters, capability title at 300, description and user reason at 1000 each. The instruction respects the user's current intent and does not force a short check during a requested explanation.
- Fingerprints and scope signatures are exact canonical JSON, retained locally; the model-facing integration should send only entries and instruction to avoid repeating scope source text. Oversized relation scopes are rejected before persistence, using the same schema as backup validation.
- Public graph projections strip legacy `activitySnapshot.referenceAnswer`; memory does not copy private review solutions, issues or branch answers.
- `rememberUse` revalidates fingerprint and entries even for empty memory; it is safe inside the store's existing synchronous nested transaction. It rejects stale context before creating a record and is idempotent for an unchanged teaching version.

## Persistence

- SQLite and full backup format advance to 12. Existing databases are copied byte-for-byte before migration (`pre-0.7` for v11); failed upgrades preserve the old file.
- Both graph collections enter full snapshots, backup schemas, restoration, sync content hashing and readable Markdown export.
- Historical formats receive empty collections. Formats below 12 omit those collections from their original sync hash, retaining old WebDAV verification compatibility.
- Backup checks reject malformed/cross-project endpoints, invalid signatures, duplicate roots, branching/cyclic history, wrong target versions and forged live source references. Missing source projects are accepted only as unavailable frozen use history; missing active relation endpoints are rejected.
- Source project purge removes its incoming relationship decisions and its owned records. Other projects' knowledge uses remain intact and display unavailable-source impact.

## Verification evidence

All tests used synthetic local data; external model requests: 0.

1. Initial graph tests: 10 failures caused by unimplemented confirmation/query behavior.
2. Initial storage tests: 6 failures caused by missing schema 12, graph persistence and compatibility support.
3. Review-driven goal/scope and bounded-history tests: 3 observed failures before fixes.
4. Oversized relation persistence test: observed failure before validating generated relations at the write boundary.
5. Final targeted run: **22 test files, 191 tests passed** (graph, knowledge learning integration, store, migrations, full backups, old versions, WebDAV, project trash, readable exports, public snapshots, handwriting persistence, model profiles and curriculum state).
6. `node node_modules/typescript/bin/tsc --noEmit`: **passed**.

Desktop/Electron packaging and the complete application test suite belong to Task 4 and are not claimed by this report.
