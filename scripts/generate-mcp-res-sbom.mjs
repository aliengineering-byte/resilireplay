#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha1(bytes) {
  return createHash("sha1").update(bytes).digest("hex");
}

export async function generateSpdx(directory, options) {
  const excluded = new Set([options.outputName, "SHA256SUMS"]);
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && !excluded.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  const files = [];
  const packageVerificationInputs = [];
  const relationships = [
    {
      spdxElementId: "SPDXRef-DOCUMENT",
      relationshipType: "DESCRIBES",
      relatedSpdxElement: "SPDXRef-Package-MCP-RES-v0.2.0",
    },
  ];
  for (const [index, name] of names.entries()) {
    const id = `SPDXRef-File-${index + 1}`;
    const bytes = await readFile(join(directory, name));
    packageVerificationInputs.push(sha1(bytes));
    files.push({
      fileName: `./${name}`,
      SPDXID: id,
      checksums: [{ algorithm: "SHA256", checksumValue: digest(bytes) }],
      licenseConcluded: "Apache-2.0",
      copyrightText: "NOASSERTION",
    });
    relationships.push({
      spdxElementId: "SPDXRef-Package-MCP-RES-v0.2.0",
      relationshipType: "CONTAINS",
      relatedSpdxElement: id,
    });
  }
  const document = {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: "MCP-RES-v0.2.0-draft.1-release-assets",
    documentNamespace: `https://github.com/aliengineering-byte/resilireplay/releases/mcp-res/v0.2.0/${options.sourceCommit}`,
    documentDescribes: ["SPDXRef-Package-MCP-RES-v0.2.0"],
    creationInfo: {
      created: options.createdAt,
      creators: ["Tool: mcp-res-sbom-generator-0.2.0"],
    },
    packages: [
      {
        name: "MCP-RES",
        SPDXID: "SPDXRef-Package-MCP-RES-v0.2.0",
        versionInfo: "0.2.0-draft.1",
        downloadLocation: "NOASSERTION",
        filesAnalyzed: true,
        packageVerificationCode: {
          packageVerificationCodeValue: sha1(
            Buffer.from(packageVerificationInputs.sort().join(""), "utf8"),
          ),
        },
        licenseConcluded: "Apache-2.0",
        licenseDeclared: "Apache-2.0",
        copyrightText: "NOASSERTION",
      },
    ],
    files,
    relationships,
  };
  const output = join(directory, options.outputName);
  await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return { output, files: files.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directoryArgument, commit, createdAt] = process.argv.slice(2);
  if (!directoryArgument || !commit || !createdAt) {
    throw new Error(
      "Usage: generate-mcp-res-sbom.mjs <release-directory> <source-commit> <created-at>",
    );
  }
  const result = await generateSpdx(resolve(directoryArgument), {
    sourceCommit: commit,
    createdAt,
    outputName: "mcp-res-v0.2.0.spdx.json",
  });
  console.log(JSON.stringify({ ...result, name: basename(result.output) }));
}
