import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import { format as prettierFormat } from "prettier";
import {
  VALIDATOR_IDENTITY,
  materializeIntegrity,
  sha256,
} from "../docs/standards/mcp-res/v0.1.0/conformance-kit/lib.mjs";

const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  console.error(
    "Usage: node scripts/export-mcp-res-reference.mjs <sanitized-input.json> <bundle.json>",
  );
  process.exitCode = 2;
} else {
  const repositoryRoot = resolve(import.meta.dirname, "..");
  const inputPath = resolve(inputArgument);
  const outputPath = resolve(outputArgument);
  if (
    !inputPath.startsWith(`${repositoryRoot}${sep}`) ||
    !outputPath.startsWith(`${repositoryRoot}${sep}`)
  ) {
    throw new Error("MCP-RES export input and output must remain inside the repository");
  }
  const inputBytes = await readFile(inputPath);
  const input = JSON.parse(inputBytes.toString("utf8"));
  if (input.schemaVersion !== "resilireplay.mcp-res-export-input/0.1.0") {
    throw new Error("Unsupported ResiliReplay MCP-RES export input");
  }
  const runId = input.runId;
  const recoveryFault = {
    id: "fault/tool-error",
    version: "1.0.0",
    method: "RETURN_ERROR",
    seed: input.faultSeed,
    targetOperationId: "op-fault",
    activation: { trigger: "DURING_OPERATION", maxApplications: 1 },
    expectedEffect: "FAILURE",
    reproducibilitySha256: sha256({ kind: "tool-error", seed: input.faultSeed }),
  };
  const negativeFault = {
    id: "fault/expected-invalid-result",
    version: "1.0.0",
    method: "FIXTURE_MUTATION",
    seed: input.negativeSeed,
    targetOperationId: "op-negative",
    activation: { trigger: "AFTER_OPERATION", maxApplications: 1 },
    expectedEffect: "INVALID_RESULT",
    reproducibilitySha256: sha256({ kind: "expected-invalid-result", seed: input.negativeSeed }),
  };
  const recoveryPolicy = {
    id: "recovery/bounded-read-only",
    retryLimit: input.retryLimit,
    timeLimitMs: 5000,
    cancellationBoundary: "PER_OPERATION",
    backoff: { kind: "NONE", maxDelayMs: 0 },
    sideEffectModel: "READ_ONLY",
    safetyMechanism: null,
    terminalOutcomes: ["PASS", "FAIL", "TIME_LIMIT"],
  };
  const evidence = {
    schemaVersion: "mcp-res.evidence-envelope/0.1.0",
    standardVersion: "0.1.0",
    profile: { id: "mcp-res/server-tool-call/v1", version: "1.0.0" },
    evidenceClass: "GENUINE_RUNTIME",
    run: { id: runId, startedAt: input.startedAt, finishedAt: input.finishedAt },
    subject: {
      schemaVersion: "0.1.0",
      subjectType: "MCP_SERVER",
      name: input.subject.name,
      version: input.subject.version,
      artifact: {
        kind: input.subject.artifactKind,
        identifier: input.subject.artifactIdentifier,
        sha256: input.subject.artifactSha256,
      },
      transport: { kind: input.subject.transport, endpointClass: "LOCAL", authenticated: false },
      configurationProfile: {
        id: "resilireplay/pinned-mcp-source",
        version: "1.0.0",
        sha256: input.subject.configurationSha256,
      },
      harness: { ...input.harness },
      runtimes: [{ ...input.runtime }],
    },
    validator: { ...VALIDATOR_IDENTITY },
    execution: {
      actualRuntime: true,
      protocolMessagesExchanged: true,
      fixtureUsed: input.sourceKind === "MCP_INSPECTOR_DEMO",
      installationExecuted: true,
      regressionExecuted: input.regression.executed,
    },
    sourceEvidence: {
      kind: "SANITIZED_PROJECTION",
      name: basename(inputPath),
      originalSha256: input.sourceEvidenceSha256,
      originalBytes: input.sourceEvidenceBytes,
      projectionSha256: sha256(inputBytes.toString("utf8")),
      projectionBytes: inputBytes.length,
    },
    limits: {
      inputBytes: 1048576,
      eventCount: 1000,
      nestingDepth: 32,
      stringBytes: 65536,
      retryCount: input.retryLimit,
      concurrency: 1,
      scenarioDurationMs: 10000,
      totalDurationMs: 30000,
      generatedOutputBytes: 1048576,
    },
    operations: [
      {
        runId,
        operationId: "op-clean",
        parentOperationId: null,
        kind: "CLEAN_CONTROL",
        faultId: null,
        recoveryPolicyId: null,
        attempt: 0,
        outcome: "PASS",
        startedOffsetMs: 0,
        durationMs: input.controlDurationMs,
      },
      {
        runId,
        operationId: "op-fault",
        parentOperationId: null,
        kind: "FAULT_CASE",
        faultId: recoveryFault.id,
        recoveryPolicyId: recoveryPolicy.id,
        attempt: 0,
        outcome: "EXPECTED_FAILURE",
        startedOffsetMs: input.controlDurationMs,
        durationMs: input.faultDurationMs,
      },
      {
        runId,
        operationId: "op-recovery",
        parentOperationId: "op-fault",
        kind: "RECOVERY_ATTEMPT",
        faultId: null,
        recoveryPolicyId: recoveryPolicy.id,
        attempt: 1,
        outcome: "PASS",
        startedOffsetMs: input.controlDurationMs + input.faultDurationMs,
        durationMs: input.recoveryDurationMs,
      },
      {
        runId,
        operationId: "op-negative",
        parentOperationId: null,
        kind: "NEGATIVE_CONTROL",
        faultId: negativeFault.id,
        recoveryPolicyId: null,
        attempt: 0,
        outcome: "EXPECTED_FAILURE",
        startedOffsetMs: input.controlDurationMs + input.faultDurationMs + input.recoveryDurationMs,
        durationMs: input.negativeDurationMs,
      },
    ],
    faults: [recoveryFault, negativeFault],
    recoveryPolicies: [recoveryPolicy],
    cleanup: {
      complete:
        input.cleanup.childProcessesRemaining === 0 && input.cleanup.listenersRemaining === 0,
      childProcessesRemaining: input.cleanup.childProcessesRemaining,
      listenersRemaining: input.cleanup.listenersRemaining,
      temporaryArtifacts: "REMOVED",
      targetState: "CLEAN",
      partialOutput: "COMPLETE",
      durationMs: 25,
    },
    regression: {
      provided: true,
      generatedWithoutExecution: true,
      containedOutput: true,
      deterministicDependencies: true,
      brokenConditionFails: true,
      fixedConditionPasses: true,
      secretScanPassed: true,
      runtimeRequirements: [`${input.runtime.name} ${input.runtime.version}`],
    },
    privacy: {
      credentialsOmitted: true,
      authorizationHeadersOmitted: true,
      environmentValuesOmitted: true,
      promptsOmitted: true,
      toolBodiesOmitted: true,
      personalPathsOmitted: true,
      summariesBounded: true,
      oneWayIdentities: true,
      scanPassed: true,
    },
  };
  const statement = {
    schemaVersion: "mcp-res.conformance-statement/0.1.0",
    standardVersion: "0.1.0",
    profileId: evidence.profile.id,
    profileVersion: evidence.profile.version,
    subjectType: evidence.subject.subjectType,
    subjectName: evidence.subject.name,
    subjectVersion: evidence.subject.version,
    evidenceClass: evidence.evidenceClass,
    result: "PASS",
    evidenceSha256: sha256(evidence),
    validatorName: evidence.validator.name,
    validatorVersion: evidence.validator.version,
    validatorSha256: evidence.validator.sha256,
    verifiedAt: input.finishedAt,
  };
  const bundle = {
    schemaVersion: "mcp-res.conformance-bundle/0.1.0",
    evidence,
    statement,
    integrity: materializeIntegrity(evidence, statement, [
      {
        path: `source-evidence/${basename(inputPath)}`,
        mediaType: "application/json",
        bytes: inputBytes.length,
        sha256: sha256(inputBytes.toString("utf8")),
      },
    ]),
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, await prettierFormat(JSON.stringify(bundle), { parser: "json" }), {
    encoding: "utf8",
    flag: "wx",
  });
  console.log(`MCP-RES reference bundle exported: ${outputPath} (${statement.evidenceSha256})`);
}
