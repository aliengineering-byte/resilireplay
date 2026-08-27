import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schemaNames = [
  "subject-identity.schema.json",
  "fault-description.schema.json",
  "recovery-policy.schema.json",
  "cleanup-result.schema.json",
  "integrity-manifest.schema.json",
  "evidence-envelope.schema.json",
  "conformance-statement.schema.json",
  "profile-manifest.schema.json",
  "conformance-bundle.schema.json",
];

function canonical(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    typeof value === "number"
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function containsEncodedSecret(serialized) {
  for (const candidate of serialized.match(/[A-Za-z0-9+/]{24,}={0,2}/gu) ?? []) {
    const decoded = Buffer.from(candidate, "base64").toString("utf8");
    if (/(?:authorization\s*:\s*bearer|api[_-]?key\s*[:=]|token\s*[:=])/iu.test(decoded))
      return true;
  }
  return false;
}

export async function createReferenceValidator(schemaDirectory) {
  const schemas = await Promise.all(
    schemaNames.map(async (name) =>
      JSON.parse(await readFile(join(schemaDirectory, name), "utf8")),
    ),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  schemas.forEach((schema) => ajv.addSchema(schema));
  const bundleSchema = schemas.find((schema) =>
    schema.$id.endsWith("conformance-bundle.schema.json"),
  );
  const schemaValidate = ajv.getSchema(bundleSchema.$id);
  return {
    schemaCount: schemas.length,
    validate(bundle) {
      const evidence = bundle?.evidence;
      const serialized = JSON.stringify(bundle);
      if (
        !evidence?.operations?.some(
          (operation) => operation.kind === "CLEAN_CONTROL" && operation.outcome === "PASS",
        )
      )
        return false;
      if (
        !evidence.operations.some(
          (operation) =>
            operation.kind === "NEGATIVE_CONTROL" &&
            operation.outcome === "EXPECTED_FAILURE" &&
            operation.faultId,
        )
      )
        return false;
      if (evidence.recoveryPolicies?.some((policy) => !Number.isInteger(policy.retryLimit)))
        return false;
      if (
        !evidence.cleanup?.complete ||
        evidence.cleanup.childProcessesRemaining !== 0 ||
        evidence.cleanup.listenersRemaining !== 0 ||
        evidence.cleanup.targetState === "UNAPPROVED_CHANGE"
      )
        return false;
      if (!bundle.integrity?.complete || bundle.integrity.publication !== "MANIFEST_LAST")
        return false;
      if (
        !evidence.subject?.name ||
        !evidence.subject?.version ||
        !evidence.subject?.artifact?.sha256
      )
        return false;
      if (["absolutePath", "workingDirectory", "hostName"].some((key) => key in evidence.subject))
        return false;
      if (Buffer.byteLength(serialized, "utf8") > 1048576 || evidence.limits?.stringBytes > 1048576)
        return false;
      if (
        /authorization\s*[:=]\s*(?:bearer|basic)\s+[a-z0-9._~+/-]+/iu.test(serialized) ||
        containsEncodedSecret(serialized)
      )
        return false;
      if (!schemaValidate(bundle)) return false;
      const profileKey = `${evidence.profile.id}@${evidence.profile.version}`;
      const allowed = new Map([
        ["mcp-res/server-tool-call/v1@1.0.0", ["MCP_SERVER"]],
        ["mcp-res/client-config-source/v1@1.0.0", ["MCP_CLIENT", "TEST_HARNESS"]],
        ["mcp-res/agent-tool-recovery/v1@1.0.0", ["AGENT_RUNTIME", "ADAPTER"]],
      ]);
      if (!allowed.get(profileKey)?.includes(evidence.subject.subjectType)) return false;
      const sourceEvidenceArtifact = bundle.integrity.artifacts.find(
        (artifact) => artifact.path === `source-evidence/${evidence.sourceEvidence?.name ?? ""}`,
      );
      const hasSourceEvidence =
        evidence.sourceEvidence?.kind === "SANITIZED_PROJECTION" &&
        sourceEvidenceArtifact?.sha256 === evidence.sourceEvidence.projectionSha256 &&
        sourceEvidenceArtifact?.bytes === evidence.sourceEvidence.projectionBytes;
      const classValid = {
        GENUINE_RUNTIME:
          evidence.execution.actualRuntime &&
          evidence.execution.protocolMessagesExchanged &&
          hasSourceEvidence,
        FIXTURE_BACKED_PROTOCOL:
          evidence.execution.protocolMessagesExchanged && evidence.execution.fixtureUsed,
        FIXTURE_VERIFIED: evidence.execution.fixtureUsed,
        INSTALLATION_VERIFIED: evidence.execution.installationExecuted,
        DOCUMENTED_ONLY: !Object.values(evidence.execution).some(Boolean),
      };
      if (!classValid[evidence.evidenceClass]) return false;
      const operationIds = new Set(evidence.operations.map((operation) => operation.operationId));
      const faults = new Map(evidence.faults.map((fault) => [fault.id, fault]));
      const policies = new Map(evidence.recoveryPolicies.map((policy) => [policy.id, policy]));
      for (const operation of evidence.operations) {
        if (
          operation.runId !== evidence.run.id ||
          (operation.parentOperationId && !operationIds.has(operation.parentOperationId))
        )
          return false;
        if (
          operation.faultId &&
          faults.get(operation.faultId)?.targetOperationId !== operation.operationId
        )
          return false;
        if (operation.recoveryPolicyId && !policies.has(operation.recoveryPolicyId)) return false;
      }
      if (
        evidence.recoveryPolicies.some(
          (policy) =>
            policy.retryLimit > 0 &&
            ["SIDE_EFFECTING", "UNKNOWN"].includes(policy.sideEffectModel) &&
            !policy.safetyMechanism,
        )
      )
        return false;
      if (
        evidence.regression?.provided &&
        (!evidence.regression.brokenConditionFails ||
          !evidence.regression.fixedConditionPasses ||
          !evidence.execution.regressionExecuted)
      )
        return false;
      const evidenceHash = digest(evidence);
      const statementHash = digest(bundle.statement);
      const evidenceArtifact = bundle.integrity.artifacts.find(
        (artifact) => artifact.path === "evidence-envelope.json",
      );
      const statementArtifact = bundle.integrity.artifacts.find(
        (artifact) => artifact.path === "conformance-statement.json",
      );
      if (
        bundle.statement.evidenceSha256 !== evidenceHash ||
        evidenceArtifact?.sha256 !== evidenceHash ||
        statementArtifact?.sha256 !== statementHash
      )
        return false;
      const artifactPaths = bundle.integrity.artifacts.map((artifact) => artifact.path);
      if (new Set(artifactPaths).size !== artifactPaths.length) return false;
      if (
        bundle.integrity.bundleDigest !==
        digest({
          artifacts: [...bundle.integrity.artifacts].sort((left, right) =>
            left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
          ),
        })
      )
        return false;
      return (
        bundle.statement.profileId === evidence.profile.id &&
        bundle.statement.subjectName === evidence.subject.name &&
        bundle.statement.validatorSha256 === evidence.validator.sha256
      );
    },
  };
}
