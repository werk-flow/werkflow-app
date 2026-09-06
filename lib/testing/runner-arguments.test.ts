import { describe, expect, test } from "bun:test";
import { parseRunnerArguments } from "./runner-arguments";
import { backendOriginFromUrl, resolveTestPrerequisites, validateDeclaredPrerequisites, validateDiagnosticProvenance, validateExecutedSelection } from "./test-evidence";

describe("runner argument and evidence boundaries", () => {
  test('distinguishes missing and invalid URLs without accepting either as provenance', () => {
    for (const value of [undefined, '', '  ']) expect(backendOriginFromUrl(value)).toBe('missing');
    for (const value of ['not-a-url', 'invalid://missing', 'file:///private']) expect(backendOriginFromUrl(value)).toBe('invalid');
    expect(backendOriginFromUrl(' https://example.test/path ')).toBe('https://example.test');
  });
  for (const argument of ["p1-16.spec.ts", "--shard=1/2", "--grep-invert=x", "--retries=2", "--workers=4", "--fully-parallel", "--config=other.ts", "--output=temp", "--reporter=list", "--project=smoke", "--repeat-each=2", "--list", "--override-rerun-budget=again"]) {
    test(`rejects certification bypass ${argument}`, () => {
      expect(() => parseRunnerArguments("certification", [argument])).toThrow("Unsupported runner argument");
    });
  }
  test("accepts only an explicit focused selection and rejects ambiguous repeated flags", () => {
    expect(parseRunnerArguments("iteration", ["--grep", "@P1-16", "--target=local"])).toEqual({ "--grep": "@P1-16", "--target": "local" });
    expect(() => parseRunnerArguments("iteration", ["--grep=x", "--grep=y"])).toThrow("cannot be repeated");
    expect(() => parseRunnerArguments("certification", ["--grep=x"])).toThrow("cannot select a subset");
  });
  test("requires exact execution once per selected identity", () => {
    const outcome = { id: "scenario-a", status: "passed" as const, durationMilliseconds: 10 };
    expect(validateExecutedSelection({ selectedTestIds: [outcome.id], outcomes: [outcome] })).toEqual([]);
    expect(validateExecutedSelection({ selectedTestIds: ["scenario-a", "scenario-b"], outcomes: [outcome] })).not.toEqual([]);
    expect(validateExecutedSelection({ selectedTestIds: [outcome.id], outcomes: [outcome, outcome] })).not.toEqual([]);
    expect(validateExecutedSelection({ selectedTestIds: [outcome.id], outcomes: [{ ...outcome, status: "skipped" }] })).not.toEqual([]);
    expect(validateExecutedSelection({ selectedTestIds: [outcome.id], outcomes: [outcome], candidateBefore: 'before', candidateAfter: 'after' })).toContain('Application, test or environment inputs changed during the browser run; this attempt cannot certify the candidate.');
  });
  test("resolves exact declared producers before selecting fresh stages", () => {
    const producer = { id: 'file › create', file: 'file', title: 'create', annotations: [] };
    const consumer = { id: 'file › consume', file: 'file', title: 'consume', annotations: [{ type: 'requires-test', description: 'create' }] };
    const tests = resolveTestPrerequisites([producer, consumer]);
    expect(validateDeclaredPrerequisites({ selectedTestIds: [consumer.id], tests })).toHaveLength(1);
    expect(validateDeclaredPrerequisites({ selectedTestIds: [producer.id, consumer.id], tests })).toEqual([]);
    expect(() => resolveTestPrerequisites([consumer, producer])).toThrow('executes later');
    expect(() => resolveTestPrerequisites([{ ...consumer, annotations: [{ type: 'requires-test', description: 'unknown' }] }])).toThrow('unknown or ambiguous');
  });
  test("rejects retained backend, suite, bucket and endpoint mismatches before restore", () => {
    const source = { suite: "golden" as const, target: "local" as const, backendOrigin: "http://172.20.1.1:54321", r2Bucket: "local-bucket", storageEndpoint: "http://172.20.1.1:54321/storage/v1/s3" };
    expect(validateDiagnosticProvenance(source, source)).toEqual([]);
    expect(validateDiagnosticProvenance({ ...source, backendOrigin: 'null' }, { ...source, backendOrigin: 'null' })).not.toEqual([]);
    expect(validateDiagnosticProvenance(undefined, source)).toHaveLength(1);
    for (const override of [{ suite: "audit" as const }, { target: "cloud" as const }, { backendOrigin: "http://172.22.1.1:54321" }, { r2Bucket: "other" }, { storageEndpoint: null }]) {
      expect(validateDiagnosticProvenance(source, { ...source, ...override })).toHaveLength(1);
    }
  });
});
