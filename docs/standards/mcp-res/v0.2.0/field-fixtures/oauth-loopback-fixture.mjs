import { createHash } from "node:crypto";
import { createServer } from "node:http";

const SYNTHETIC_ACCESS_TOKEN = "mcp-res-synthetic-access-for-resource";
const SYNTHETIC_DOWNSTREAM_TOKEN = "mcp-res-synthetic-downstream-token";

function base64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

export function pkceChallenge(verifier) {
  return base64url(createHash("sha256").update(verifier).digest());
}

function json(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": body.length,
  });
  response.end(body);
}

function sanitizedError(reason) {
  return { error: "invalid_request", reason };
}

export async function startOAuthLoopbackFixture() {
  const codes = new Map();
  const refreshTokens = new Set(["mcp-res-synthetic-refresh-1"]);
  const observations = {
    inboundTokenSha256: null,
    downstreamTokenSha256: null,
    rawTokenPersisted: false,
  };
  let base;
  const server = createServer((request, response) => {
    const url = new URL(request.url, base);
    const resource = `${base}/mcp`;
    const issuer = base;
    const clientId = `${base}/client-metadata.json`;
    const redirectUri = `${base}/callback`;
    if (request.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      json(response, 200, { resource, authorization_servers: [issuer] });
      return;
    }
    if (request.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
      json(response, 200, {
        issuer,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        code_challenge_methods_supported: ["S256"],
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/client-metadata.json") {
      json(response, 200, {
        client_id: clientId,
        redirect_uris: [redirectUri],
        scope: "mcp.read",
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/redirect-a") {
      response.writeHead(302, { location: `${base}/redirect-b` });
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/redirect-b") {
      response.writeHead(302, { location: `${base}/.well-known/oauth-protected-resource/mcp` });
      response.end();
      return;
    }
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      let body = {};
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      } catch {
        json(response, 400, sanitizedError("MCP_RES_OAUTH_EARLY_SYNTAX_REJECTION"));
        return;
      }
      if (request.method === "POST" && url.pathname === "/authorize") {
        if (body.resource !== resource) {
          json(
            response,
            400,
            sanitizedError("MCP_RES_OAUTH_AUTHORIZATION_REQUEST_RESOURCE_REJECTED"),
          );
          return;
        }
        if (body.client_id !== clientId || body.consent_client_id !== clientId) {
          json(
            response,
            400,
            sanitizedError("MCP_RES_OAUTH_PROXY_CONSENT_CLIENT_BINDING_REJECTED"),
          );
          return;
        }
        if (body.redirect_uri !== redirectUri) {
          json(response, 400, sanitizedError("MCP_RES_OAUTH_EXACT_REDIRECT_URI_REJECTED"));
          return;
        }
        if (body.code_challenge_method !== "S256") {
          json(response, 400, sanitizedError("MCP_RES_OAUTH_PKCE_DOWNGRADE_REFUSED_REJECTED"));
          return;
        }
        if (!body.state || !body.code_challenge) {
          json(response, 400, sanitizedError("MCP_RES_OAUTH_STATE_BINDING_REJECTED"));
          return;
        }
        if (body.scope !== "mcp.read") {
          json(response, 400, sanitizedError("MCP_RES_OAUTH_SCOPE_MINIMIZATION_REJECTED"));
          return;
        }
        const code = "mcp-res-synthetic-code";
        codes.set(code, {
          resource,
          clientId,
          redirectUri,
          issuer,
          tokenEndpoint: `${base}/token`,
          state: body.state,
          challenge: body.code_challenge,
        });
        json(response, 200, { code, state: body.state, issuer });
        return;
      }
      if (request.method === "POST" && url.pathname === "/token") {
        const binding = codes.get(body.code);
        if (!binding) {
          json(response, 400, sanitizedError("MCP_RES_OAUTH_AUTHORIZATION_CODE_BINDING_REJECTED"));
          return;
        }
        if (body.token_endpoint !== binding.tokenEndpoint || body.issuer !== binding.issuer) {
          json(response, 400, sanitizedError("MCP_RES_OAUTH_TOKEN_ENDPOINT_IDENTITY_REJECTED"));
          return;
        }
        if (
          body.resource !== binding.resource ||
          body.client_id !== binding.clientId ||
          body.redirect_uri !== binding.redirectUri
        ) {
          json(response, 400, sanitizedError("MCP_RES_OAUTH_AUTHORIZATION_CODE_BINDING_REJECTED"));
          return;
        }
        if (pkceChallenge(body.code_verifier ?? "") !== binding.challenge) {
          json(response, 400, sanitizedError("MCP_RES_OAUTH_PKCE_S256_REJECTED"));
          return;
        }
        codes.delete(body.code);
        json(response, 200, {
          access_token: SYNTHETIC_ACCESS_TOKEN,
          token_type: "Bearer",
          resource,
          scope: "mcp.read",
          refresh_token: "mcp-res-synthetic-refresh-1",
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/refresh") {
        if (!refreshTokens.delete(body.refresh_token)) {
          json(
            response,
            400,
            sanitizedError("MCP_RES_OAUTH_REFRESH_TOKEN_ROTATION_WHEN_CLAIMED_REJECTED"),
          );
          return;
        }
        refreshTokens.add("mcp-res-synthetic-refresh-2");
        json(response, 200, { refresh_token: "mcp-res-synthetic-refresh-2" });
        return;
      }
      if (request.method === "POST" && url.pathname === "/mcp") {
        const token = request.headers.authorization?.replace(/^Bearer /u, "");
        if (token === "mcp-res-synthetic-other-resource") {
          json(
            response,
            401,
            sanitizedError("MCP_RES_OAUTH_WRONG_RESOURCE_TOKEN_REJECTION_REJECTED"),
          );
          return;
        }
        if (token !== SYNTHETIC_ACCESS_TOKEN) {
          json(response, 401, sanitizedError("MCP_RES_OAUTH_EARLY_SYNTAX_REJECTION"));
          return;
        }
        json(response, 200, { accepted: true, resource });
        return;
      }
      if (request.method === "POST" && url.pathname === "/proxy") {
        const inbound = request.headers.authorization?.replace(/^Bearer /u, "") ?? "";
        observations.inboundTokenSha256 = createHash("sha256").update(inbound).digest("hex");
        observations.downstreamTokenSha256 = createHash("sha256")
          .update(SYNTHETIC_DOWNSTREAM_TOKEN)
          .digest("hex");
        json(response, 200, {
          passthrough: inbound === SYNTHETIC_DOWNSTREAM_TOKEN,
          downstreamTokenDistinct: inbound !== SYNTHETIC_DOWNSTREAM_TOKEN,
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/shutdown") {
        response.writeHead(204);
        response.end(() => server.close());
        return;
      }
      json(response, 404, sanitizedError("MCP_RES_OAUTH_ROUTE_REJECTED"));
    });
  });
  const closed = new Promise((resolve) => server.once("close", resolve));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("OAuth fixture has no loopback port");
  base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    port: address.port,
    observations,
    closed,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export function assertMetadataTarget(candidate, allowedOrigin) {
  const target = new URL(candidate);
  if (target.origin !== allowedOrigin || target.protocol !== "http:") {
    return { accepted: false, reason: "MCP_RES_OAUTH_SSRF_RESISTANT_METADATA_RESOLUTION_REJECTED" };
  }
  return { accepted: true, reason: "MCP_RES_OAUTH_SSRF_RESISTANT_METADATA_RESOLUTION_ACCEPTED" };
}
