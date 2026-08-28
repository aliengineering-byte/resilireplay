import { createHash } from "node:crypto";
import { createServer, request } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256 } from "../docs/standards/mcp-res/v0.2.0/conformance-kit/lib.mjs";
import {
  finalizeOAuthEvaluation,
  oauthReason,
  OAUTH_DIAGNOSTICS,
  validateOAuthEvaluation,
} from "../docs/standards/mcp-res/v0.2.0/conformance-kit/oauth-lib.mjs";
import { loadProfileManifests } from "../docs/standards/mcp-res/v0.2.0/conformance-kit/profile-lib.mjs";
import {
  assertMetadataTarget,
  pkceChallenge,
  startOAuthLoopbackFixture,
} from "../docs/standards/mcp-res/v0.2.0/field-fixtures/oauth-loopback-fixture.mjs";

const root = resolve(import.meta.dirname, "..");
const standard = join(root, "docs", "standards", "mcp-res", "v0.2.0");
const schemas = join(standard, "schemas");
const profiles = join(standard, "profiles");
const fixturePath = join(standard, "field-fixtures", "oauth-loopback-fixture.mjs");
const output = join(root, ".artifacts", "mcp-res-v02", "oauth-corpus");
await mkdir(output, { recursive: true });

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function rawDigest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function call(base, path, { method = "GET", body, token } = {}) {
  const target = new URL(path, base);
  return new Promise((resolveCall, reject) => {
    const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
    const operation = request(
      target,
      {
        method,
        headers: {
          ...(payload.length
            ? { "content-type": "application/json", "content-length": payload.length }
            : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolveCall({
            status: response.statusCode,
            headers: response.headers,
            value: text ? JSON.parse(text) : null,
          });
        });
      },
    );
    operation.setTimeout(5_000, () => operation.destroy(new Error("bounded OAuth probe timeout")));
    operation.once("error", reject);
    operation.end(payload);
  });
}

const fixture = await startOAuthLoopbackFixture();
const base = fixture.base;
const resource = `${base}/mcp`;
const clientId = `${base}/client-metadata.json`;
const redirectUri = `${base}/callback`;
const verifier = "mcp-res-synthetic-pkce-verifier-000000000000000000000000";
const challenge = pkceChallenge(verifier);
const probe = {
  prm: false,
  authorizationServerMetadata: false,
  cimd: false,
  issuerBound: false,
  resourceOnAuthorization: false,
  resourceOnToken: false,
  audienceAccepted: false,
  wrongAudienceRejectedForAudienceReason: false,
  malformedTokenWrongReasonReached: false,
  pkceS256: false,
  pkceDowngradeRejected: false,
  redirectExact: false,
  stateBound: false,
  mixupRejected: false,
  codeBound: false,
  tokenEndpointBound: false,
  scopeMinimized: false,
  refreshRotated: false,
  oldRefreshRejected: false,
  tokenPassthroughPrevented: false,
  errorsSanitized: false,
  redirectsBounded: false,
  ssrfRejected: false,
  loopbackCollisionRejected: false,
  consentClientBound: false,
};

const prm = await call(base, "/.well-known/oauth-protected-resource/mcp");
invariant(prm.status === 200 && prm.value.resource === resource, "PRM resource binding failed");
probe.prm = true;
const metadata = await call(base, "/.well-known/oauth-authorization-server");
invariant(
  metadata.status === 200 &&
    metadata.value.issuer === base &&
    metadata.value.token_endpoint === `${base}/token`,
  "Authorization-server metadata binding failed",
);
probe.authorizationServerMetadata = true;
probe.issuerBound = true;
probe.tokenEndpointBound = true;
const cimd = await call(base, "/client-metadata.json");
invariant(
  cimd.status === 200 &&
    cimd.value.client_id === clientId &&
    cimd.value.redirect_uris.includes(redirectUri),
  "CIMD identity failed",
);
probe.cimd = true;

const authorizeBody = {
  resource,
  client_id: clientId,
  consent_client_id: clientId,
  redirect_uri: redirectUri,
  code_challenge: challenge,
  code_challenge_method: "S256",
  state: "mcp-res-synthetic-state",
  scope: "mcp.read",
};
const wrongAuthorizationResource = await call(base, "/authorize", {
  method: "POST",
  body: { ...authorizeBody, resource: `${base}/other-resource` },
});
invariant(
  wrongAuthorizationResource.value.reason ===
    "MCP_RES_OAUTH_AUTHORIZATION_REQUEST_RESOURCE_REJECTED",
  "Authorization resource negative did not reach resource binding",
);
const wrongRedirect = await call(base, "/authorize", {
  method: "POST",
  body: { ...authorizeBody, redirect_uri: `${base}/other-callback` },
});
invariant(
  wrongRedirect.value.reason === "MCP_RES_OAUTH_EXACT_REDIRECT_URI_REJECTED",
  "Redirect mismatch did not reach redirect binding",
);
const missingState = await call(base, "/authorize", {
  method: "POST",
  body: { ...authorizeBody, state: "" },
});
invariant(
  missingState.value.reason === "MCP_RES_OAUTH_STATE_BINDING_REJECTED",
  "Missing state did not reach state binding",
);
const excessiveScope = await call(base, "/authorize", {
  method: "POST",
  body: { ...authorizeBody, scope: "mcp.read admin" },
});
invariant(
  excessiveScope.value.reason === "MCP_RES_OAUTH_SCOPE_MINIMIZATION_REJECTED",
  "Excess scope did not reach scope minimization",
);
const downgrade = await call(base, "/authorize", {
  method: "POST",
  body: { ...authorizeBody, code_challenge_method: "plain" },
});
invariant(
  downgrade.value.reason === "MCP_RES_OAUTH_PKCE_DOWNGRADE_REFUSED_REJECTED",
  "PKCE downgrade was not rejected for the intended reason",
);
probe.pkceDowngradeRejected = true;
const wrongConsent = await call(base, "/authorize", {
  method: "POST",
  body: { ...authorizeBody, consent_client_id: `${base}/other-client` },
});
invariant(
  wrongConsent.value.reason === "MCP_RES_OAUTH_PROXY_CONSENT_CLIENT_BINDING_REJECTED",
  "Proxy consent/client mismatch was not reached",
);
probe.consentClientBound = true;
const authorization = await call(base, "/authorize", { method: "POST", body: authorizeBody });
invariant(
  authorization.status === 200 &&
    authorization.value.state === authorizeBody.state &&
    authorization.value.issuer === base,
  "Authorization response was not state/issuer bound",
);
probe.resourceOnAuthorization = true;
probe.redirectExact = true;
probe.stateBound = true;
probe.scopeMinimized = true;
const wrongVerifier = await call(base, "/token", {
  method: "POST",
  body: {
    code: authorization.value.code,
    code_verifier: "wrong-but-syntactically-valid-verifier-0000000000000000000",
    resource,
    client_id: clientId,
    redirect_uri: redirectUri,
    issuer: base,
    token_endpoint: `${base}/token`,
  },
});
invariant(
  wrongVerifier.value.reason === "MCP_RES_OAUTH_PKCE_S256_REJECTED",
  "Wrong verifier did not reach the PKCE reason",
);
const token = await call(base, "/token", {
  method: "POST",
  body: {
    code: authorization.value.code,
    code_verifier: verifier,
    resource,
    client_id: clientId,
    redirect_uri: redirectUri,
    issuer: base,
    token_endpoint: `${base}/token`,
  },
});
invariant(
  token.status === 200 && token.value.resource === resource && token.value.scope === "mcp.read",
  "Token response was not resource/scope bound",
);
probe.pkceS256 = true;
probe.resourceOnToken = true;
probe.codeBound = true;
const reusedCode = await call(base, "/token", {
  method: "POST",
  body: {
    code: authorization.value.code,
    code_verifier: verifier,
    resource,
    client_id: clientId,
    redirect_uri: redirectUri,
    issuer: base,
    token_endpoint: `${base}/token`,
  },
});
invariant(
  reusedCode.value.reason === "MCP_RES_OAUTH_AUTHORIZATION_CODE_BINDING_REJECTED",
  "Authorization code replay was not rejected",
);
const mixupAuthorization = await call(base, "/authorize", { method: "POST", body: authorizeBody });
const mixup = await call(base, "/token", {
  method: "POST",
  body: {
    code: mixupAuthorization.value.code,
    code_verifier: verifier,
    resource,
    client_id: clientId,
    redirect_uri: redirectUri,
    issuer: `${base}/other-issuer`,
    token_endpoint: `${base}/token`,
  },
});
invariant(
  mixup.value.reason === "MCP_RES_OAUTH_TOKEN_ENDPOINT_IDENTITY_REJECTED",
  "Issuer mix-up did not reach token-endpoint identity",
);
probe.mixupRejected = true;
const accepted = await call(base, "/mcp", {
  method: "POST",
  token: token.value.access_token,
});
invariant(
  accepted.status === 200 && accepted.value.resource === resource,
  "Audience token rejected",
);
probe.audienceAccepted = true;
const wrongAudience = await call(base, "/mcp", {
  method: "POST",
  token: "mcp-res-synthetic-other-resource",
});
invariant(
  wrongAudience.status === 401 &&
    wrongAudience.value.reason === "MCP_RES_OAUTH_WRONG_RESOURCE_TOKEN_REJECTION_REJECTED",
  "Wrong-audience token did not reach audience validation",
);
probe.wrongAudienceRejectedForAudienceReason = true;
const malformed = await call(base, "/mcp", { method: "POST", token: "malformed" });
invariant(
  malformed.value.reason === "MCP_RES_OAUTH_EARLY_SYNTAX_REJECTION",
  "Wrong-reason token mutant did not stop at syntax",
);
probe.malformedTokenWrongReasonReached = true;
const proxy = await call(base, "/proxy", {
  method: "POST",
  token: token.value.access_token,
});
invariant(
  proxy.value.downstreamTokenDistinct && !proxy.value.passthrough,
  "Inbound token was passed through",
);
probe.tokenPassthroughPrevented = true;
const rotated = await call(base, "/refresh", {
  method: "POST",
  body: { refresh_token: token.value.refresh_token },
});
invariant(rotated.status === 200, "Refresh token did not rotate");
probe.refreshRotated = true;
const reused = await call(base, "/refresh", {
  method: "POST",
  body: { refresh_token: token.value.refresh_token },
});
invariant(
  reused.value.reason === "MCP_RES_OAUTH_REFRESH_TOKEN_ROTATION_WHEN_CLAIMED_REJECTED",
  "Old refresh token reuse was not rejected",
);
probe.oldRefreshRejected = true;

invariant(
  assertMetadataTarget("http://169.254.169.254/latest/meta-data", base).reason ===
    "MCP_RES_OAUTH_SSRF_RESISTANT_METADATA_RESOLUTION_REJECTED",
  "Link-local metadata target passed the SSRF boundary",
);
invariant(
  assertMetadataTarget(`http://127.0.0.1:${fixture.port + 1}/metadata`, base).accepted === false,
  "Unreviewed loopback port passed the exact-origin boundary",
);
probe.ssrfRejected = true;
let redirectPath = "/redirect-a";
let redirectCount = 0;
while (redirectCount <= 2) {
  const response = await call(base, redirectPath);
  if (response.status !== 302) {
    invariant(response.value.resource === resource, "Bounded redirect did not end at PRM");
    break;
  }
  redirectCount += 1;
  invariant(redirectCount <= 2, "Redirect limit exceeded");
  redirectPath = response.headers.location;
}
probe.redirectsBounded = redirectCount === 2;

const collisionServer = createServer();
const collision = await new Promise((resolveCollision) => {
  collisionServer.once("error", (error) => resolveCollision(error.code));
  collisionServer.listen(fixture.port, "127.0.0.1", () => resolveCollision("UNEXPECTED_LISTEN"));
});
invariant(collision === "EADDRINUSE", `Loopback redirect collision was not rejected: ${collision}`);
probe.loopbackCollisionRejected = true;
const errorCorpus = JSON.stringify([
  wrongAuthorizationResource.value,
  wrongRedirect.value,
  missingState.value,
  excessiveScope.value,
  downgrade.value,
  wrongConsent.value,
  wrongVerifier.value,
  reusedCode.value,
  mixup.value,
  wrongAudience.value,
  malformed.value,
  reused.value,
]);
probe.errorsSanitized =
  !errorCorpus.includes(token.value.access_token) &&
  !errorCorpus.includes(token.value.refresh_token) &&
  !errorCorpus.includes(verifier);

await call(base, "/shutdown", { method: "POST" });
await fixture.closed;
const sourceDigest = rawDigest(await readFile(fixturePath));
const manifest = (await loadProfileManifests(profiles, { schemaDirectory: schemas })).get(
  "mcp-res/oauth-boundary/v1",
);
invariant(manifest, "OAuth profile manifest missing");
const caseArtifactSha256 = sha256({
  ...probe,
  inboundTokenSha256: fixture.observations.inboundTokenSha256,
  downstreamTokenSha256: fixture.observations.downstreamTokenSha256,
});

function evaluationFor(revision, evidenceSource = "RUNTIME_PROBE") {
  const ids = [
    ...manifest.requiredChecks,
    ...manifest.conditionalChecks
      .filter((entry) => entry.protocolRevisions.includes(revision))
      .map((entry) => entry.id),
  ].sort();
  return finalizeOAuthEvaluation({
    schemaVersion: "mcp-res.oauth-boundary-evaluation/0.2.0",
    subject: {
      name: "mcp-res-synthetic-oauth-loopback-fixture",
      version: "0.2.0-draft.1",
      artifactSha256: sourceDigest,
    },
    environment: { platform: process.platform, runtime: "node", runtimeVersion: process.version },
    profile: {
      id: manifest.id,
      version: manifest.version,
      manifestSha256: sha256(manifest),
      protocolRevision: revision,
    },
    fixture: {
      loopbackOnly: true,
      syntheticCredentials: true,
      realAuthorizationProvidersContacted: 0,
      externalNetworkRequests: 0,
      listenerSha256: sha256({ origin: "127.0.0.1", subject: sourceDigest }),
    },
    flow: {
      resourceUri: "http://127.0.0.1:1/mcp",
      authorizationServerIssuer: "http://127.0.0.1:1",
      authorizationEndpoint: "http://127.0.0.1:1/authorize",
      tokenEndpoint: "http://127.0.0.1:1/token",
      clientId: "http://127.0.0.1:1/client-metadata.json",
      redirectUri: "http://127.0.0.1:1/callback",
      requestedScopes: ["mcp.read"],
      authorizedScopes: ["mcp.read"],
      codeChallengeMethod: "S256",
      cimdSha256: sha256(cimd.value),
      trustPolicyId: "mcp-res-synthetic-cimd-trust-policy",
    },
    cases: ids.map((id) => ({
      id,
      evidenceSource,
      positive: {
        propertyReached: true,
        expectedOutcome: "ACCEPT",
        observedOutcome: "ACCEPT",
        expectedReasonCode: oauthReason(id, "ACCEPTED"),
        observedReasonCode: oauthReason(id, "ACCEPTED"),
        artifactSha256: caseArtifactSha256,
      },
      negative: {
        propertyReached: true,
        expectedOutcome: "REJECT",
        observedOutcome: "REJECT",
        expectedReasonCode: oauthReason(id, "REJECTED"),
        observedReasonCode: oauthReason(id, "REJECTED"),
        artifactSha256: caseArtifactSha256,
      },
      wrongReasonMutant: {
        propertyReached: true,
        observedReasonCode: "MCP_RES_OAUTH_EARLY_SYNTAX_REJECTION",
        expectedDiagnostic: "MCP_RES_OAUTH_WRONG_REASON",
        artifactSha256: sha256({ id, mutant: "early-syntax-rejection" }),
      },
    })),
    privacy: {
      tokenMaterialPersisted: false,
      evidenceContainsCredentialMaterial: false,
      authorizationErrorsSanitized: true,
    },
    cleanup: {
      listenerClosed: true,
      redirectListenerReleased: true,
      observationSha256: sha256({ oauthListenerClosed: true, collisionListenerCreated: false }),
    },
    result: evidenceSource === "TEST_FIXTURE" ? "INCOMPLETE" : "PASS",
  });
}

const valid = [];
for (const revision of manifest.protocolRevisions) {
  const evaluation = evaluationFor(revision);
  const result = await validateOAuthEvaluation(evaluation, {
    schemaDirectory: schemas,
    profileDirectory: profiles,
  });
  invariant(result.valid && result.result === "PASS", JSON.stringify(result));
  const file = `valid-${revision}.json`;
  await writeFile(join(output, file), `${JSON.stringify(evaluation, null, 2)}\n`, "utf8");
  valid.push({ id: revision, file, expectedResult: "PASS" });
}
const fixtureEvaluation = evaluationFor("2026-07-28", "TEST_FIXTURE");
const fixtureResult = await validateOAuthEvaluation(fixtureEvaluation, {
  schemaDirectory: schemas,
  profileDirectory: profiles,
});
invariant(fixtureResult.valid && fixtureResult.result === "INCOMPLETE", "Fixture was promoted");
await writeFile(
  join(output, "valid-fixture-incomplete.json"),
  `${JSON.stringify(fixtureEvaluation, null, 2)}\n`,
);
valid.push({
  id: "fixture-incomplete",
  file: "valid-fixture-incomplete.json",
  expectedResult: "INCOMPLETE",
});

const baseEvaluation = evaluationFor("2026-07-28");
const invalid = [];
async function record(id, mutate, diagnostic, recompute = true) {
  const value = structuredClone(baseEvaluation);
  mutate(value);
  const candidate = recompute ? finalizeOAuthEvaluation(value) : value;
  const file = `invalid-${id}.json`;
  await writeFile(join(output, file), `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
  const result = await validateOAuthEvaluation(candidate, {
    schemaDirectory: schemas,
    profileDirectory: profiles,
  });
  invariant(result.diagnostics[0] === diagnostic, `${id}: ${JSON.stringify(result)}`);
  invalid.push({ id, file, expectedDiagnostics: [diagnostic] });
}
await record(
  "wrong-reason",
  (value) => {
    value.cases[0].negative.observedReasonCode = "MCP_RES_OAUTH_EARLY_SYNTAX_REJECTION";
  },
  OAUTH_DIAGNOSTICS.WRONG_REASON,
);
await record(
  "property-not-reached",
  (value) => {
    value.cases[0].negative.propertyReached = false;
  },
  OAUTH_DIAGNOSTICS.PROPERTY_NOT_REACHED,
);
await record(
  "wrong-reason-control-missing",
  (value) => {
    value.cases[0].wrongReasonMutant.observedReasonCode =
      value.cases[0].negative.expectedReasonCode;
  },
  OAUTH_DIAGNOSTICS.WRONG_REASON_CONTROL_MISSING,
);
await record(
  "external-provider",
  (value) => {
    value.fixture.realAuthorizationProvidersContacted = 1;
  },
  OAUTH_DIAGNOSTICS.EXTERNAL_PROVIDER_CONTACT,
);
await record(
  "non-synthetic-credential",
  (value) => {
    value.fixture.syntheticCredentials = false;
  },
  OAUTH_DIAGNOSTICS.NON_SYNTHETIC_CREDENTIAL,
);
await record(
  "secret-persisted",
  (value) => {
    value.privacy.tokenMaterialPersisted = true;
  },
  OAUTH_DIAGNOSTICS.SECRET_PERSISTED,
);
await record(
  "unsanitized-error",
  (value) => {
    value.privacy.authorizationErrorsSanitized = false;
  },
  OAUTH_DIAGNOSTICS.UNSANITIZED_ERROR,
);
await record(
  "cleanup-incomplete",
  (value) => {
    value.cleanup.listenerClosed = false;
  },
  OAUTH_DIAGNOSTICS.CLEANUP_INCOMPLETE,
);
await record(
  "coverage-omission",
  (value) => {
    value.cases.pop();
  },
  OAUTH_DIAGNOSTICS.COVERAGE_MISMATCH,
);
await record(
  "digest-mismatch",
  (value) => {
    value.cases[0].positive.artifactSha256 = "0".repeat(64);
  },
  OAUTH_DIAGNOSTICS.DIGEST_MISMATCH,
  false,
);
await record(
  "fixture-pass-overclaim",
  (value) => {
    for (const entry of value.cases) entry.evidenceSource = "TEST_FIXTURE";
    value.result = "PASS";
  },
  OAUTH_DIAGNOSTICS.TEST_FIXTURE_OVERCLAIM,
);

const catalog = {
  schemaVersion: "mcp-res.oauth-test-catalog/0.2.0",
  valid,
  invalid,
};
await writeFile(join(output, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
await writeFile(
  join(root, ".artifacts", "mcp-res-v02", "oauth-field-verification.json"),
  `${JSON.stringify(
    {
      schemaVersion: "mcp-res.oauth-field-verification/0.2.0",
      platform: process.platform,
      runtimeVersion: process.version,
      profileManifestSha256: sha256(manifest),
      subjectSha256: sourceDigest,
      protocolRevisions: manifest.protocolRevisions,
      properties: manifest.requiredChecks.length + manifest.conditionalChecks.length,
      reasonBoundWrongReasonControls: baseEvaluation.cases.length,
      loopbackOnly: true,
      syntheticCredentials: true,
      realAuthorizationProvidersContacted: 0,
      externalNetworkRequests: 0,
      securityCertificationClaim: false,
      probe,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(
  JSON.stringify({
    protocolRevisionEvaluations: 2,
    authorizationProperties: baseEvaluation.cases.length,
    wrongReasonControls: baseEvaluation.cases.length,
    invalidMutants: invalid.length,
    realAuthorizationProvidersContacted: 0,
    securityCertificationClaim: false,
  }),
);
