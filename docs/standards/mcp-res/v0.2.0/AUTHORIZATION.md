# OAuth authorization-boundary reliability

Profile: `mcp-res/oauth-boundary/v1` — **PROVISIONAL**.

This profile records observable reliability at an MCP authorization boundary. It is not security certification, penetration testing, an authorization-provider audit, or proof that unobserved application paths are secure. Evaluation is restricted to synthetic credentials and local or authenticated loopback fixtures. A valid evaluation records zero real authorization providers and zero external-network requests.

## Required evidence

| Property group                    | Positive observation                                                                                                             | Intended negative reason                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| PRM and AS discovery              | Exact resource metadata, authorization server, metadata endpoint, and issuer chain resolve.                                      | A resource, issuer, endpoint, or discovery-chain mismatch is rejected at that property.                |
| RFC 8707 resource binding         | The same resource is carried by authorization and token requests and bound to the access token.                                  | A syntactically valid token for another resource is rejected for the audience/resource reason.         |
| PKCE                              | `S256` challenge/verifier pair is reached and accepted.                                                                          | Wrong verifier and unsafe `plain`/missing downgrade are rejected at PKCE, not an earlier parser guard. |
| Redirect, state, mix-up, and code | Exact redirect URI, nonempty state, issuer, client, code, and token endpoint remain correlated.                                  | Redirect/state/issuer/client/code replay or endpoint substitution is rejected at the named binding.    |
| CIMD and proxy consent            | Client metadata digest, trust-policy ID, redirect set, consent, and acting client agree.                                         | Metadata or consent/client substitution is rejected before token use.                                  |
| Token handling                    | Audience, minimized scope, refresh rotation when claimed, and a distinct downstream token are observed.                          | Wrong audience, excess scope, refresh reuse, or upstream-token passthrough is rejected.                |
| Error and evidence privacy        | Errors contain stable reason codes but no verifier, access token, refresh token, or client secret; evidence stores digests only. | Persisted credential material or unsanitized error content invalidates the evaluation.                 |
| Redirect and metadata safety      | Redirect count is finite; metadata resolution is restricted to an exact reviewed origin.                                         | Link-local, private/unreviewed origin, port substitution, or redirect overflow is rejected.            |
| Loopback lifecycle                | Listener identity is exact, port collision fails closed, and all listeners are released.                                         | Listener collision or incomplete cleanup prevents pass.                                                |

Every registered check contains a reached positive observation, a reached reason-bound negative observation, and an early-syntax wrong-reason mutant. Expected reason codes are derived from the registered check ID. A wrong-audience token rejected as malformed therefore yields `MCP_RES_OAUTH_WRONG_REASON`, not credit for audience binding.

`refresh-token-rotation-when-claimed` is conditional in the sense that implementations need not issue refresh tokens; an evaluation that claims rotation MUST run the reuse negative. The bundled synthetic fixture does issue and rotate one disposable value in memory.

## Fixture and data boundary

The executable fixture listens only on an ephemeral `127.0.0.1` port. Credentials use conspicuous `mcp-res-synthetic-*` values and exist only in process memory. Published artifacts contain no raw token, code, verifier, state, or secret. The evidence retains the fixture source SHA-256, sanitized endpoint shapes, observation digests, cleanup digest, platform, and runtime.

The SSRF check is an exact-origin reliability boundary, not a universal URL-security proof. DNS rebinding, proxy policy, cloud metadata variants, browser navigation, cookie policy, and deployment-specific trust stores remain outside this profile.

Validate an evaluation with either implementation:

```text
node conformance-kit/validate-oauth.mjs oauth-evaluation.json
python conformance-kit/python/mcp_res_validator.py oauth oauth-evaluation.json
```
