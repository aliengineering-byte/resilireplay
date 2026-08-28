#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBundle as validateV01Bundle } from "../docs/standards/mcp-res/v0.1.0/conformance-kit/lib.mjs";

const TOOL_NAME = "mcp-res-migrate";
const TOOL_VERSION = "0.2.0";

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArguments(args) {
  const options = { dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (["--from", "--to", "--input", "--output"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
      options[argument.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function collectLegacyAssertions(evidence) {
  const assertions = [];
  for (const [name, value] of Object.entries(evidence.execution ?? {})) {
    if (typeof value === "boolean")
      assertions.push({ name, value, strength: "LEGACY_SELF_ASSERTED" });
  }
  for (const [name, value] of Object.entries(evidence.privacy ?? {})) {
    if (typeof value === "boolean") {
      assertions.push({ name: `privacy.${name}`, value, strength: "LEGACY_SELF_ASSERTED" });
    }
  }
  if (typeof evidence.cleanup?.complete === "boolean") {
    assertions.push({
      name: "cleanup.complete",
      value: evidence.cleanup.complete,
      strength: "LEGACY_SELF_ASSERTED",
    });
  }
  for (const [name, value] of Object.entries(evidence.regression ?? {})) {
    if (typeof value === "boolean") {
      assertions.push({ name: `regression.${name}`, value, strength: "LEGACY_SELF_ASSERTED" });
    }
  }
  return assertions.sort((left, right) => left.name.localeCompare(right.name, "en"));
}

export async function migrateBundleV01(bundle, sourceBytes, toolSha256) {
  if (bundle?.schemaVersion === "mcp-res.migration-result/0.2.0") return bundle;
  if (bundle?.schemaVersion === "mcp-res.conformance-bundle/0.2.0") {
    throw new Error("MCP_RES_MIGRATION_ALREADY_V02");
  }
  if (bundle?.schemaVersion !== "mcp-res.conformance-bundle/0.1.0") {
    throw new Error("MCP_RES_MIGRATION_SOURCE_VERSION_UNSUPPORTED");
  }
  const validation = await validateV01Bundle(bundle);
  if (!validation.valid) {
    throw new Error(`MCP_RES_MIGRATION_SOURCE_INVALID:${validation.diagnostics.join(",")}`);
  }
  const legacyAssertions = collectLegacyAssertions(bundle.evidence);
  const unresolvedRequirements = [
    "AUTHENTICITY_EVIDENCE",
    "EXECUTION_INSTANCE_DIGEST",
    "OBSERVATION_BINDINGS",
    "OBSERVATION_COVERAGE",
    "REASON_BOUND_NEGATIVE_OBSERVATION",
    "SCENARIO_FINGERPRINT",
    "TRIAL_REPETITION_EVIDENCE",
  ];
  if (!bundle.evidence.sourceEvidence) unresolvedRequirements.push("SOURCE_EVIDENCE");
  unresolvedRequirements.sort();
  const warnings = [
    "Producer booleans remain LEGACY_SELF_ASSERTED.",
    "No reason-bound negative evidence was fabricated.",
    "No signature or signer identity was fabricated.",
    "No repeated-trial evidence was fabricated.",
    "A fresh v0.2 run is required to resolve incomplete requirements.",
  ];
  const source = {
    standardVersion: "0.1.0",
    evidenceSha256: bundle.statement.evidenceSha256,
    bundleFileSha256: digest(sourceBytes),
  };
  const target = {
    standardVersion: "0.2.0",
    status: "INCOMPLETE",
    evidenceClass: bundle.evidence.evidenceClass,
    authenticityClassification: "UNSIGNED_INTEGRITY_ONLY",
    stabilityClassification: "SINGLE_OBSERVATION",
    legacyAssertions,
    unresolvedRequirements,
  };
  return {
    schemaVersion: "mcp-res.migration-result/0.2.0",
    source,
    target,
    migration: {
      from: "0.1.0",
      to: "0.2.0",
      tool: { name: TOOL_NAME, version: TOOL_VERSION, sha256: toolSha256 },
      inputOverwritten: false,
      fabricatedEvidence: false,
    },
    report: {
      status: "INCOMPLETE",
      preservedEvidenceSha256: source.evidenceSha256,
      preservedEvidenceClass: target.evidenceClass,
      legacyAssertionCount: legacyAssertions.length,
      unresolvedRequirements,
      warnings,
    },
    originalBundle: bundle,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.from !== "0.1.0" || options.to !== "0.2.0" || !options.input) {
    throw new Error(
      "Usage: mcp-res migrate --from 0.1.0 --to 0.2.0 --input <file> --output <file> [--dry-run]",
    );
  }
  if (!options.dryRun && !options.output) throw new Error("--output is required without --dry-run");
  const input = resolve(options.input);
  const output = options.output ? resolve(options.output) : undefined;
  if (output && output === input) throw new Error("MCP_RES_MIGRATION_INPUT_OVERWRITE_FORBIDDEN");
  if (output) {
    const cwd = await realpath(process.cwd());
    const parent = await realpath(dirname(output));
    const parentRelative = relative(cwd, parent);
    if (
      isAbsolute(parentRelative) ||
      parentRelative === ".." ||
      parentRelative.startsWith(`..\\`) ||
      parentRelative.startsWith("../")
    ) {
      throw new Error("MCP_RES_MIGRATION_OUTPUT_OUTSIDE_WORKSPACE");
    }
    try {
      await access(output);
      throw new Error("MCP_RES_MIGRATION_OUTPUT_CONFLICT");
    } catch (error) {
      if (error instanceof Error && error.message === "MCP_RES_MIGRATION_OUTPUT_CONFLICT")
        throw error;
    }
  }
  const sourceBytes = await readFile(input);
  let bundle;
  try {
    bundle = JSON.parse(sourceBytes.toString("utf8"));
  } catch {
    throw new Error("MCP_RES_MIGRATION_INPUT_JSON_INVALID");
  }
  const toolBytes = await readFile(fileURLToPath(import.meta.url));
  const result = await migrateBundleV01(bundle, sourceBytes, digest(toolBytes));
  const outputBytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`, "utf8");
  if (options.dryRun) {
    process.stdout.write(
      `${JSON.stringify({ dryRun: true, wouldWrite: output ?? null, outputSha256: digest(outputBytes), report: result.report })}\n`,
    );
    return;
  }
  await writeFile(output, outputBytes, { flag: "wx" });
  process.stdout.write(
    `${JSON.stringify({ dryRun: false, output, outputSha256: digest(outputBytes), report: result.report })}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
