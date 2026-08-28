#!/usr/bin/env python3
"""Second-implementation, dependency-free MCP-RES v0.2 validator.

This implementation consumes the public schemas and bundles. It imports no
ResiliReplay package, JavaScript module, generated JavaScript decision, or
private monorepo function. It intentionally implements only the JSON Schema
2020-12 vocabulary used by the published MCP-RES schemas.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urldefrag, urlparse

MAX_SAFE_INTEGER = 9_007_199_254_740_991


def _reject_constant(value: str) -> None:
    raise ValueError(f"non-JSON number: {value}")


def load_json(path: Path) -> Any:
    def no_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate JSON key: {key}")
            result[key] = value
        return result

    return json.loads(
        path.read_text(encoding="utf-8"),
        object_pairs_hook=no_duplicates,
        parse_constant=_reject_constant,
    )


def _reject_surrogates(value: str) -> None:
    if any(0xD800 <= ord(character) <= 0xDFFF for character in value):
        raise ValueError("MCP_RES_INVALID_UNICODE")


def _quote(value: str) -> str:
    _reject_surrogates(value)
    output = ['"']
    escapes = {
        '"': '\\"',
        "\\": "\\\\",
        "\b": "\\b",
        "\t": "\\t",
        "\n": "\\n",
        "\f": "\\f",
        "\r": "\\r",
    }
    for character in value:
        if character in escapes:
            output.append(escapes[character])
        elif ord(character) < 0x20:
            output.append(f"\\u{ord(character):04x}")
        else:
            output.append(character)
    output.append('"')
    return "".join(output)


def _utf16_sort_key(value: str) -> bytes:
    _reject_surrogates(value)
    return value.encode("utf-16-be")


def canonicalize(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _quote(value)
    if isinstance(value, int) and not isinstance(value, bool):
        if abs(value) > MAX_SAFE_INTEGER:
            raise ValueError("MCP_RES_NON_CANONICAL_NUMBER")
        return str(value)
    if isinstance(value, float):
        raise ValueError("MCP_RES_NON_CANONICAL_NUMBER")
    if isinstance(value, list):
        return "[" + ",".join(canonicalize(item) for item in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value, key=_utf16_sort_key)
        return "{" + ",".join(f"{_quote(key)}:{canonicalize(value[key])}" for key in keys) + "}"
    raise ValueError("MCP_RES_UNSUPPORTED_CANONICAL_VALUE")


def sha256(value: Any) -> str:
    material = value if isinstance(value, bytes) else canonicalize(value).encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def _json_equal(left: Any, right: Any) -> bool:
    if isinstance(left, bool) or isinstance(right, bool):
        return isinstance(left, bool) and isinstance(right, bool) and left == right
    if left is None or right is None:
        return left is None and right is None
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(_json_equal(left[key], right[key]) for key in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(_json_equal(a, b) for a, b in zip(left, right))
    return left == right


class SchemaSet:
    """Small Draft 2020-12 evaluator for the vocabulary used by MCP-RES."""

    def __init__(self, directory: Path):
        self.directory = directory
        self.schemas: dict[str, dict[str, Any]] = {}
        self.by_name: dict[str, dict[str, Any]] = {}
        for path in sorted(directory.glob("*.schema.json")):
            schema = load_json(path)
            self.schemas[schema["$id"]] = schema
            self.by_name[path.name] = schema

    def get(self, identifier: str) -> dict[str, Any]:
        if identifier in self.schemas:
            return self.schemas[identifier]
        name = Path(urlparse(identifier).path).name
        if name in self.by_name:
            return self.by_name[name]
        raise ValueError(f"unresolved schema: {identifier}")

    @staticmethod
    def _pointer(root: Any, fragment: str) -> Any:
        value = root
        if not fragment:
            return value
        if not fragment.startswith("/"):
            raise ValueError(f"unsupported JSON pointer: {fragment}")
        for token in fragment[1:].split("/"):
            token = token.replace("~1", "/").replace("~0", "~")
            value = value[token]
        return value

    def _resolve(self, reference: str, root: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        if reference.startswith("#"):
            return self._pointer(root, reference[1:]), root
        base, fragment = urldefrag(reference)
        target_root = self.get(base)
        return self._pointer(target_root, fragment), target_root

    @staticmethod
    def _is_type(value: Any, expected: str) -> bool:
        return {
            "null": value is None,
            "boolean": isinstance(value, bool),
            "integer": isinstance(value, int) and not isinstance(value, bool),
            "number": (isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)),
            "string": isinstance(value, str),
            "array": isinstance(value, list),
            "object": isinstance(value, dict),
        }.get(expected, False)

    @staticmethod
    def _date_time(value: str) -> bool:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed.tzinfo is not None
        except ValueError:
            return False

    def errors(
        self,
        value: Any,
        schema: dict[str, Any],
        root: dict[str, Any] | None = None,
        path: str = "",
    ) -> list[dict[str, str]]:
        root = root or schema
        errors: list[dict[str, str]] = []
        if "$ref" in schema:
            target, target_root = self._resolve(schema["$ref"], root)
            return self.errors(value, target, target_root, path)
        if "oneOf" in schema:
            matches = [not self.errors(value, option, root, path) for option in schema["oneOf"]]
            if sum(matches) != 1:
                errors.append({"instancePath": path, "keyword": "oneOf", "message": "must match exactly one schema"})
                return errors
        if "const" in schema and not _json_equal(value, schema["const"]):
            errors.append({"instancePath": path, "keyword": "const", "message": "must equal constant"})
        if "enum" in schema and not any(_json_equal(value, item) for item in schema["enum"]):
            errors.append({"instancePath": path, "keyword": "enum", "message": "must be an allowed value"})
        expected_types = schema.get("type")
        if expected_types is not None:
            types = expected_types if isinstance(expected_types, list) else [expected_types]
            if not any(self._is_type(value, expected) for expected in types):
                errors.append({"instancePath": path, "keyword": "type", "message": "has wrong type"})
                return errors
        if isinstance(value, dict):
            required = schema.get("required", [])
            for name in required:
                if name not in value:
                    errors.append({"instancePath": path, "keyword": "required", "message": f"missing {name}"})
            properties = schema.get("properties", {})
            if schema.get("additionalProperties") is False:
                for name in value:
                    if name not in properties:
                        errors.append({"instancePath": path, "keyword": "additionalProperties", "message": f"unknown {name}"})
            for name, child_schema in properties.items():
                if name in value:
                    escaped = name.replace("~", "~0").replace("/", "~1")
                    errors.extend(self.errors(value[name], child_schema, root, f"{path}/{escaped}"))
        if isinstance(value, list):
            if len(value) < schema.get("minItems", 0):
                errors.append({"instancePath": path, "keyword": "minItems", "message": "too few items"})
            if len(value) > schema.get("maxItems", sys.maxsize):
                errors.append({"instancePath": path, "keyword": "maxItems", "message": "too many items"})
            if schema.get("uniqueItems"):
                seen: set[str] = set()
                for item in value:
                    identity = canonicalize(item)
                    if identity in seen:
                        errors.append({"instancePath": path, "keyword": "uniqueItems", "message": "duplicate item"})
                        break
                    seen.add(identity)
            if "items" in schema:
                for index, item in enumerate(value):
                    errors.extend(self.errors(item, schema["items"], root, f"{path}/{index}"))
        if isinstance(value, str):
            if len(value) < schema.get("minLength", 0):
                errors.append({"instancePath": path, "keyword": "minLength", "message": "too short"})
            if len(value) > schema.get("maxLength", sys.maxsize):
                errors.append({"instancePath": path, "keyword": "maxLength", "message": "too long"})
            if "pattern" in schema and re.search(schema["pattern"], value) is None:
                errors.append({"instancePath": path, "keyword": "pattern", "message": "pattern mismatch"})
            if schema.get("format") == "date-time" and not self._date_time(value):
                errors.append({"instancePath": path, "keyword": "format", "message": "invalid date-time"})
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if value < schema.get("minimum", -math.inf):
                errors.append({"instancePath": path, "keyword": "minimum", "message": "below minimum"})
            if value > schema.get("maximum", math.inf):
                errors.append({"instancePath": path, "keyword": "maximum", "message": "above maximum"})
        return errors


def _iso_milliseconds(value: str) -> float:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000


def _sorted_artifacts(artifacts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(artifacts, key=lambda item: item["path"])


def observation_digest(observation: dict[str, Any]) -> str:
    material = dict(observation)
    material.pop("observationSha256", None)
    return sha256(material)


def supporting_manifest_digest(artifacts: list[dict[str, Any]]) -> str:
    supporting = [
        item
        for item in artifacts
        if item["path"] not in {"evidence-envelope.json", "conformance-statement.json"}
    ]
    return sha256({"artifacts": _sorted_artifacts(supporting)})


def execution_digest(evidence: dict[str, Any], outcome: str) -> str:
    return sha256(
        {
            "scenarioFingerprint": evidence["scenario"]["fingerprint"],
            "run": evidence["run"],
            "observationDigests": [item["observationSha256"] for item in evidence["observations"]],
            "actualOutcome": outcome,
            "supportingArtifactManifestDigest": evidence["supportingArtifactManifestDigest"],
        }
    )


def _invalid(diagnostic: str, schema_errors: list[dict[str, str]] | None = None) -> dict[str, Any]:
    return {"valid": False, "diagnostics": [diagnostic], "schemaErrors": schema_errors or []}


def _pre_schema_core(bundle: Any) -> str | None:
    evidence = bundle.get("evidence", {}) if isinstance(bundle, dict) else {}
    execution = evidence.get("execution", {})
    if any(name in execution for name in ("actualRuntime", "protocolMessagesExchanged", "installationExecuted", "regressionExecuted")):
        return "MCP_RES_SELF_ASSERTED_CLAIM"
    if isinstance(evidence.get("privacy"), dict) and "scanPassed" in evidence["privacy"]:
        return "MCP_RES_SELF_ASSERTED_CLAIM"
    if isinstance(evidence.get("cleanup"), dict) and "complete" in evidence["cleanup"]:
        return "MCP_RES_SELF_ASSERTED_CLAIM"
    negatives = [item for item in evidence.get("operations", []) if item.get("kind") == "NEGATIVE_CONTROL"]
    if not negatives:
        return "MCP_RES_VACUOUS_NEGATIVE_CONTROL"
    for negative in negatives:
        reason = negative.get("negativeObservation")
        if not reason:
            return "MCP_RES_VACUOUS_NEGATIVE_CONTROL"
        if not reason.get("prerequisitesReached"):
            return "MCP_RES_NEGATIVE_PREREQUISITE_MISSING"
        if reason.get("propertyReached") is not True:
            return "MCP_RES_PROPERTY_NOT_REACHED"
        if reason.get("expectedVerdict") != reason.get("observedVerdict"):
            return "MCP_RES_VACUOUS_NEGATIVE_CONTROL"
        if reason.get("expectedStopReason") != reason.get("observedStopReason"):
            return "MCP_RES_WRONG_STOP_REASON"
        if reason.get("mutantId") and reason.get("mutantKilled") is not True:
            return "MCP_RES_NEGATIVE_MUTANT_SURVIVED"
    return None


def validate_core(bundle: Any, schemas: SchemaSet) -> dict[str, Any]:
    early = _pre_schema_core(bundle)
    if early:
        return _invalid(early)
    root_schema = schemas.get(
        "https://aliengineering-byte.github.io/resilireplay/standards/mcp-res/v0.2.0/schemas/conformance-bundle.schema.json"
    )
    schema_errors = schemas.errors(bundle, root_schema)
    if schema_errors:
        return _invalid("MCP_RES_SCHEMA_INVALID", schema_errors)
    evidence = bundle["evidence"]
    statement = bundle["statement"]
    integrity = bundle["integrity"]
    descriptor = evidence["scenario"]["descriptor"]
    if (
        descriptor["standardVersion"] != evidence["standardVersion"]
        or descriptor["profileId"] != evidence["profile"]["id"]
        or descriptor["profileVersion"] != evidence["profile"]["version"]
        or descriptor["protocolRevision"] != evidence["protocolRevision"]
        or descriptor["subjectIdentityDigest"] != evidence["subject"]["identityDigest"]
        or evidence["scenario"]["fingerprint"] != sha256(descriptor)
    ):
        return _invalid("MCP_RES_SCENARIO_FINGERPRINT_MISMATCH")
    started = _iso_milliseconds(evidence["run"]["startedAt"])
    finished = _iso_milliseconds(evidence["run"]["finishedAt"])
    if finished < started or evidence["run"]["monotonicDurationMs"] > finished - started:
        return _invalid("MCP_RES_WALL_CLOCK_REVERSAL")

    operations: dict[str, dict[str, Any]] = {}
    for operation in evidence["operations"]:
        if operation["operationId"] in operations:
            return _invalid("MCP_RES_CAUSAL_MISMATCH")
        operations[operation["operationId"]] = operation
        if operation["runId"] != evidence["run"]["id"]:
            return _invalid("MCP_RES_CROSS_RUN_SUBSTITUTION")
        if operation["startedOffsetMs"] + operation["durationMs"] > evidence["run"]["monotonicDurationMs"]:
            return _invalid("MCP_RES_CAUSAL_MISMATCH")
    policies = {item["id"]: item for item in descriptor["recoveryPolicies"]}
    faults = {item["id"] for item in descriptor["faults"]}
    for operation in evidence["operations"]:
        parent = operation["parentOperationId"]
        if parent is not None and parent not in operations:
            return _invalid("MCP_RES_CAUSAL_MISMATCH")
        if operation["faultId"] is not None and operation["faultId"] not in faults:
            return _invalid("MCP_RES_CAUSAL_MISMATCH")
        policy_id = operation["recoveryPolicyId"]
        if policy_id is not None:
            if policy_id not in policies:
                return _invalid("MCP_RES_CAUSAL_MISMATCH")
            if operation["attempt"] > policies[policy_id]["retryLimit"]:
                return _invalid("MCP_RES_RETRY_LIMIT_EXCEEDED")
    for operation_id in operations:
        seen: set[str] = set()
        cursor = operations[operation_id]
        while cursor["parentOperationId"] is not None:
            if cursor["operationId"] in seen:
                return _invalid("MCP_RES_OPERATION_PARENT_CYCLE")
            seen.add(cursor["operationId"])
            cursor = operations[cursor["parentOperationId"]]

    artifacts = {item["path"]: item for item in integrity["artifacts"]}
    observation_ids: set[str] = set()
    for observation in evidence["observations"]:
        if observation["id"] in observation_ids:
            return _invalid("MCP_RES_OBSERVATION_CAUSAL_MISMATCH")
        observation_ids.add(observation["id"])
        if (
            observation["subjectRef"] != evidence["subject"]["identityDigest"]
            or (observation["operationRef"] is not None and observation["operationRef"] not in operations)
            or observation["startedOffsetMs"] + observation["durationMs"] > evidence["run"]["monotonicDurationMs"]
        ):
            return _invalid("MCP_RES_OBSERVATION_CAUSAL_MISMATCH")
        referenced = [artifacts.get(name) for name in observation["artifactRefs"]]
        if any(item is None for item in referenced):
            return _invalid("MCP_RES_MISSING_OBSERVATION_ARTIFACT")
        material = dict(observation)
        material.pop("observationSha256")
        expected_bytes = len(canonicalize(material).encode("utf-8"))
        if observation["observationSha256"] != observation_digest(observation) or not any(
            item["sha256"] == observation["observationSha256"]
            and item["bytes"] == expected_bytes
            and item["mediaType"] == "application/vnd.mcp-res.observation+json"
            for item in referenced
        ):
            return _invalid("MCP_RES_OBSERVATION_HASH_MISMATCH")
    for negative in [item for item in evidence["operations"] if item["kind"] == "NEGATIVE_CONTROL"]:
        oracle = negative["negativeObservation"]["oracleEvidenceRef"]
        if oracle not in artifacts:
            return _invalid("MCP_RES_MISSING_OBSERVATION_ARTIFACT")
        if not any(
            item["type"] == "VALIDATOR_CHECK"
            and item["operationRef"] == negative["operationId"]
            and oracle in item["artifactRefs"]
            for item in evidence["observations"]
        ):
            return _invalid("MCP_RES_OBSERVATION_CAUSAL_MISMATCH")

    surfaces: set[str] = set()
    for entry in evidence["coverage"]["surfaces"]:
        if entry["surface"] in surfaces:
            return _invalid("MCP_RES_REQUIRED_SURFACE_UNOBSERVED")
        surfaces.add(entry["surface"])
        if entry["required"] and (
            entry["status"] in {"UNINSTRUMENTED", "UNKNOWN"}
            or (
                entry["status"] in {"INSTRUMENTED", "OBSERVED_INDIRECTLY"}
                and (not entry["observationRefs"] or any(name not in observation_ids for name in entry["observationRefs"]))
            )
        ):
            return _invalid("MCP_RES_REQUIRED_SURFACE_UNOBSERVED")
    if len(surfaces) != 14:
        return _invalid("MCP_RES_REQUIRED_SURFACE_UNOBSERVED")

    trial = evidence["trialSummary"]
    total = trial["counts"]["success"] + trial["counts"]["failure"] + trial["counts"]["incomplete"]
    duration = trial["durationMs"]
    if (
        total != trial["completedTrials"]
        or trial["completedTrials"] > trial["plannedTrials"]
        or len(trial["seeds"]) != trial["completedTrials"]
        or (trial["completedTrials"] > 0 and not trial["distinctOutcomeHashes"])
        or (trial["completedTrials"] > 0 and duration is None)
        or (duration is not None and not (duration["minimum"] <= duration["median"] <= duration["p95"]))
    ):
        return _invalid("MCP_RES_TRIAL_SUMMARY_INCONSISTENT")
    if trial["classification"] == "REPEATED_STABLE" and (
        trial["completedTrials"] < 2
        or trial["counts"]["success"] != trial["completedTrials"]
        or len(trial["distinctOutcomeHashes"]) != 1
    ):
        return _invalid("MCP_RES_FALSE_STABILITY_CLAIM")
    if trial["classification"] == "SINGLE_OBSERVATION" and trial["completedTrials"] != 1:
        return _invalid("MCP_RES_TRIAL_SUMMARY_INCONSISTENT")
    if (
        trial["classification"] == "INCOMPLETE"
        and trial["counts"]["incomplete"] == 0
        and trial["completedTrials"] == trial["plannedTrials"]
    ):
        return _invalid("MCP_RES_TRIAL_SUMMARY_INCONSISTENT")

    def observed(kind: str) -> bool:
        return any(
            item["type"] == kind and item["strength"] == "INTEGRITY_BOUND" and item["outcome"] == "PASS"
            for item in evidence["observations"]
        )

    source_refs = evidence.get("sourceEvidenceRefs", [])
    has_source = bool(source_refs) and all(name in artifacts for name in source_refs)
    if observed("PROCESS_EXECUTION") and observed("PROTOCOL_EXCHANGE") and has_source:
        derived_class = "GENUINE_RUNTIME"
    elif observed("PROTOCOL_EXCHANGE") and observed("FIXTURE_EXECUTION"):
        derived_class = "FIXTURE_BACKED_PROTOCOL"
    elif observed("FIXTURE_EXECUTION"):
        derived_class = "FIXTURE_VERIFIED"
    elif observed("INSTALLATION_EXECUTION"):
        derived_class = "INSTALLATION_VERIFIED"
    else:
        derived_class = "DOCUMENTED_ONLY"
    if evidence["evidenceClassClaim"] != derived_class or statement["evidenceClass"] != derived_class:
        return _invalid("MCP_RES_EVIDENCE_CLASS_PROMOTION")
    if statement["result"] == "PASS" and (not observed("CLEANUP_CHECK") or not observed("PRIVACY_SCAN")):
        return _invalid("MCP_RES_COMPLETION_UNOBSERVED")

    paths = [item["path"] for item in integrity["artifacts"]]
    if len(set(paths)) != len(paths):
        return _invalid("MCP_RES_DIGEST_MISMATCH")
    if evidence["supportingArtifactManifestDigest"] != supporting_manifest_digest(integrity["artifacts"]):
        return _invalid("MCP_RES_DIGEST_MISMATCH")
    evidence_hash = sha256(evidence)
    statement_hash = sha256(statement)
    evidence_artifact = artifacts.get("evidence-envelope.json")
    statement_artifact = artifacts.get("conformance-statement.json")
    if (
        evidence_artifact is None
        or evidence_artifact["sha256"] != evidence_hash
        or evidence_artifact["bytes"] != len(canonicalize(evidence).encode("utf-8"))
        or statement_artifact is None
        or statement_artifact["sha256"] != statement_hash
        or statement_artifact["bytes"] != len(canonicalize(statement).encode("utf-8"))
        or integrity["bundleDigest"] != sha256({"artifacts": _sorted_artifacts(integrity["artifacts"])})
    ):
        return _invalid("MCP_RES_DIGEST_MISMATCH")
    if statement["executionInstanceDigest"] != execution_digest(evidence, statement["result"]):
        return _invalid("MCP_RES_EXECUTION_DIGEST_MISMATCH")
    if (
        statement["standardVersion"] != evidence["standardVersion"]
        or statement["profileId"] != evidence["profile"]["id"]
        or statement["profileVersion"] != evidence["profile"]["version"]
        or statement["protocolRevision"] != evidence["protocolRevision"]
        or statement["subjectType"] != evidence["subject"]["subjectType"]
        or statement["subjectName"] != evidence["subject"]["name"]
        or statement["subjectVersion"] != evidence["subject"]["version"]
        or statement["scenarioFingerprint"] != evidence["scenario"]["fingerprint"]
        or statement["stabilityClassification"] != evidence["trialSummary"]["classification"]
        or statement["evidenceSha256"] != evidence_hash
        or canonicalize(statement["validator"]) != canonicalize(descriptor["validatorPolicy"])
    ):
        return _invalid("MCP_RES_CAUSAL_MISMATCH")
    return {"valid": True, "diagnostics": [], "schemaErrors": []}


# Dependency-free RFC 8032 Ed25519 verification. This reference verifier is
# cross-checked against signatures produced by Node's platform crypto in CI.
_Q = 2**255 - 19
_L = 2**252 + 27742317777372353535851937790883648493


def _inv(value: int) -> int:
    return pow(value, _Q - 2, _Q)


_D = (-121665 * _inv(121666)) % _Q
_I = pow(2, (_Q - 1) // 4, _Q)


def _xrecover(y: int) -> int:
    xx = (y * y - 1) * _inv(_D * y * y + 1)
    x = pow(xx, (_Q + 3) // 8, _Q)
    if (x * x - xx) % _Q != 0:
        x = (x * _I) % _Q
    if (x * x - xx) % _Q != 0:
        raise ValueError("invalid Ed25519 point")
    if x & 1:
        x = _Q - x
    return x


_BY = (4 * _inv(5)) % _Q
_B = (_xrecover(_BY), _BY)


def _edwards(left: tuple[int, int], right: tuple[int, int]) -> tuple[int, int]:
    x1, y1 = left
    x2, y2 = right
    product = _D * x1 * x2 * y1 * y2
    return (
        (x1 * y2 + x2 * y1) * _inv(1 + product) % _Q,
        (y1 * y2 + x1 * x2) * _inv(1 - product) % _Q,
    )


def _scalarmult(point: tuple[int, int], scalar: int) -> tuple[int, int]:
    result = (0, 1)
    addend = point
    while scalar:
        if scalar & 1:
            result = _edwards(result, addend)
        addend = _edwards(addend, addend)
        scalar >>= 1
    return result


def _decodepoint(encoded: bytes) -> tuple[int, int]:
    if len(encoded) != 32:
        raise ValueError("invalid Ed25519 point length")
    y = int.from_bytes(encoded, "little") & ((1 << 255) - 1)
    if y >= _Q:
        raise ValueError("non-canonical Ed25519 point")
    x = _xrecover(y)
    if (x & 1) != (encoded[31] >> 7):
        x = _Q - x
    if (-x * x + y * y - 1 - _D * x * x * y * y) % _Q != 0:
        raise ValueError("point is not on Ed25519 curve")
    return x, y


def verify_ed25519(public_key: bytes, message: bytes, signature: bytes) -> bool:
    try:
        if len(public_key) != 32 or len(signature) != 64:
            return False
        point_a = _decodepoint(public_key)
        point_r = _decodepoint(signature[:32])
        if _scalarmult(point_a, 8) == (0, 1) or _scalarmult(point_r, 8) == (0, 1):
            return False
        scalar_s = int.from_bytes(signature[32:], "little")
        if scalar_s >= _L:
            return False
        challenge = int.from_bytes(
            hashlib.sha512(signature[:32] + public_key + message).digest(), "little"
        ) % _L
        return _scalarmult(_B, scalar_s) == _edwards(point_r, _scalarmult(point_a, challenge))
    except (ValueError, ZeroDivisionError):
        return False


def _strict_b64(value: str) -> bytes:
    return base64.b64decode(value, validate=True)


def _dsse_pae(payload_type: str, payload: bytes) -> bytes:
    type_bytes = payload_type.encode("utf-8")
    return b"".join(
        [
            f"DSSEv1 {len(type_bytes)} ".encode(),
            type_bytes,
            f" {len(payload)} ".encode(),
            payload,
        ]
    )


def _attestation_invalid(*diagnostics: str, schema_errors: list[dict[str, str]] | None = None) -> dict[str, Any]:
    return {"valid": False, "diagnostics": list(diagnostics), "schemaErrors": schema_errors or []}


def validate_attestation(
    wrapper: Any,
    schemas: SchemaSet,
    trust_policy: Any | None,
    evaluated_at: str,
) -> dict[str, Any]:
    for envelope in wrapper.get("authenticity", {}).get("envelopes", []) if isinstance(wrapper, dict) else []:
        if not envelope.get("signatures"):
            return _attestation_invalid("MCP_RES_ATTESTATION_SIGNATURE_MISSING")
        if any(item.get("algorithm") != "Ed25519" for item in envelope["signatures"]):
            return _attestation_invalid("MCP_RES_ATTESTATION_ALGORITHM_UNSUPPORTED")
    wrapper_schema = schemas.get(
        "https://aliengineering-byte.github.io/resilireplay/standards/mcp-res/v0.2.0/schemas/attested-conformance-bundle.schema.json"
    )
    schema_errors = schemas.errors(wrapper, wrapper_schema)
    if schema_errors:
        return _attestation_invalid("MCP_RES_ATTESTATION_SCHEMA_INVALID", schema_errors=schema_errors)
    evidence_result = validate_core(wrapper["bundle"], schemas)
    if not evidence_result["valid"]:
        return _attestation_invalid("MCP_RES_ATTESTED_EVIDENCE_INVALID", *evidence_result["diagnostics"])
    claimed = wrapper["authenticity"]["claimedClassification"]
    envelopes = wrapper["authenticity"]["envelopes"]
    if not envelopes:
        if claimed == "UNSIGNED_INTEGRITY_ONLY":
            return {
                "valid": True,
                "diagnostics": [],
                "schemaErrors": [],
                "authenticityClassification": "UNSIGNED_INTEGRITY_ONLY",
            }
        return _attestation_invalid("MCP_RES_ATTESTATION_SIGNATURE_MISSING")
    if claimed == "UNSIGNED_INTEGRITY_ONLY":
        return _attestation_invalid("MCP_RES_AUTHENTICITY_CLASSIFICATION_OVERCLAIM")
    if trust_policy is not None:
        trust_schema = schemas.get(
            "https://aliengineering-byte.github.io/resilireplay/standards/mcp-res/v0.2.0/schemas/trust-policy.schema.json"
        )
        trust_errors = schemas.errors(trust_policy, trust_schema)
        if trust_errors:
            return _attestation_invalid("MCP_RES_ATTESTATION_SCHEMA_INVALID", schema_errors=trust_errors)
        moment = _iso_milliseconds(evaluated_at)
        if moment < _iso_milliseconds(trust_policy["validFrom"]) or moment > _iso_milliseconds(trust_policy["validUntil"]):
            return _attestation_invalid("MCP_RES_TRUST_POLICY_EXPIRED")
    statement_schema = schemas.get(
        "https://aliengineering-byte.github.io/resilireplay/standards/mcp-res/v0.2.0/schemas/attestation-statement.schema.json"
    )
    seen: set[str] = set()
    all_trusted = trust_policy is not None
    has_transparency = False
    bundle = wrapper["bundle"]
    for envelope in envelopes:
        if len(envelope["signatures"]) != 1:
            return _attestation_invalid("MCP_RES_ATTESTATION_DUPLICATE_SIGNER")
        signature = envelope["signatures"][0]
        if signature["keyid"] in seen:
            return _attestation_invalid("MCP_RES_ATTESTATION_DUPLICATE_SIGNER")
        seen.add(signature["keyid"])
        try:
            payload = _strict_b64(envelope["payload"])
            der = _strict_b64(signature["publicKeySpkiBase64"])
            signature_bytes = _strict_b64(signature["sig"])
        except (ValueError, TypeError):
            return _attestation_invalid("MCP_RES_ATTESTATION_SIGNATURE_INVALID")
        key_fingerprint = hashlib.sha256(der).hexdigest()
        if key_fingerprint != signature["keyid"]:
            return _attestation_invalid("MCP_RES_ATTESTATION_IDENTITY_MISMATCH")
        prefix = bytes.fromhex("302a300506032b6570032100")
        if len(der) != len(prefix) + 32 or not der.startswith(prefix):
            return _attestation_invalid("MCP_RES_ATTESTATION_SIGNATURE_INVALID")
        if not verify_ed25519(der[len(prefix) :], _dsse_pae(envelope["payloadType"], payload), signature_bytes):
            return _attestation_invalid("MCP_RES_ATTESTATION_SIGNATURE_INVALID")
        try:
            statement = json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return _attestation_invalid("MCP_RES_ATTESTATION_SCHEMA_INVALID")
        if payload != canonicalize(statement).encode("utf-8"):
            return _attestation_invalid("MCP_RES_ATTESTATION_SCHEMA_INVALID")
        statement_errors = schemas.errors(statement, statement_schema)
        if statement_errors:
            return _attestation_invalid("MCP_RES_ATTESTATION_SCHEMA_INVALID", schema_errors=statement_errors)
        predicate = statement["predicate"]
        if (
            len(statement["subject"]) != 1
            or statement["subject"][0]["name"] != bundle["evidence"]["subject"]["name"]
            or statement["subject"][0]["digest"]["sha256"] != bundle["evidence"]["subject"]["artifactSha256"]
            or predicate["evidenceBundleDigest"] != bundle["integrity"]["bundleDigest"]
            or predicate["scenarioFingerprint"] != bundle["evidence"]["scenario"]["fingerprint"]
            or predicate["executionInstanceDigest"] != bundle["statement"]["executionInstanceDigest"]
            or canonicalize(predicate["profile"]) != canonicalize(bundle["evidence"]["profile"])
            or canonicalize(predicate["validator"]) != canonicalize(bundle["statement"]["validator"])
        ):
            return _attestation_invalid("MCP_RES_ATTESTATION_BINDING_MISMATCH")
        if (
            predicate["signerIdentity"] != signature["signerIdentity"]
            or predicate["signerKeyFingerprint"] != signature["keyid"]
        ):
            return _attestation_invalid("MCP_RES_ATTESTATION_IDENTITY_MISMATCH")
        if predicate["signatureAlgorithm"] != "Ed25519":
            return _attestation_invalid("MCP_RES_ATTESTATION_ALGORITHM_UNSUPPORTED")
        if trust_policy is not None:
            if predicate["trustPolicyId"] != trust_policy["id"]:
                return _attestation_invalid("MCP_RES_ATTESTATION_IDENTITY_MISMATCH")
            signing_time = _iso_milliseconds(predicate["signingTime"])
            if (
                signing_time < _iso_milliseconds(trust_policy["validFrom"])
                or signing_time > _iso_milliseconds(trust_policy["validUntil"])
                or signing_time > _iso_milliseconds(evaluated_at)
            ):
                return _attestation_invalid("MCP_RES_TRUST_POLICY_EXPIRED")
            if signature["keyid"] in trust_policy["revokedKeyFingerprints"]:
                return _attestation_invalid("MCP_RES_ATTESTATION_KEY_REVOKED")
            trusted = any(
                item["keyFingerprint"] == signature["keyid"]
                and item["signerIdentity"] == signature["signerIdentity"]
                for item in trust_policy["trustedSigners"]
            )
            all_trusted = all_trusted and trusted
        transparency = predicate.get("transparencyReference")
        if transparency:
            try:
                proof = _strict_b64(transparency["inclusionProofBase64"])
            except (ValueError, TypeError):
                return _attestation_invalid("MCP_RES_TRANSPARENCY_REFERENCE_INVALID")
            if hashlib.sha256(proof).hexdigest() != transparency["inclusionProofSha256"]:
                return _attestation_invalid("MCP_RES_TRANSPARENCY_REFERENCE_INVALID")
            has_transparency = True
    derived = "SIGNED"
    if all_trusted:
        derived = "SIGNED_WITH_IDENTITY"
    if all_trusted and len(seen) >= 2:
        derived = "WITNESSED"
    if all_trusted and has_transparency:
        derived = "TRANSPARENCY_RECORDED"
    levels = [
        "UNSIGNED_INTEGRITY_ONLY",
        "SIGNED",
        "SIGNED_WITH_IDENTITY",
        "WITNESSED",
        "TRANSPARENCY_RECORDED",
    ]
    if levels.index(claimed) >= 2 and not all_trusted:
        return _attestation_invalid("MCP_RES_ATTESTATION_UNTRUSTED_SIGNER")
    if levels.index(claimed) > levels.index(derived):
        return _attestation_invalid("MCP_RES_AUTHENTICITY_CLASSIFICATION_OVERCLAIM")
    return {
        "valid": True,
        "diagnostics": [],
        "schemaErrors": [],
        "authenticityClassification": derived,
        "evidenceClass": bundle["statement"]["evidenceClass"],
    }


def validate_v01(bundle: Any, v01_schemas: SchemaSet) -> bool:
    evidence = bundle.get("evidence", {}) if isinstance(bundle, dict) else {}
    if not any(item.get("kind") == "CLEAN_CONTROL" for item in evidence.get("operations", [])):
        return False
    negative = next((item for item in evidence.get("operations", []) if item.get("kind") == "NEGATIVE_CONTROL"), None)
    if not negative or negative.get("outcome") != "EXPECTED_FAILURE" or not negative.get("faultId"):
        return False
    schema = v01_schemas.get(
        "https://aliengineering-byte.github.io/resilireplay/standards/mcp-res/v0.1.0/schemas/conformance-bundle.schema.json"
    )
    return not v01_schemas.errors(bundle, schema)


def validate_migration(result: Any, schemas: SchemaSet, v01_schemas: SchemaSet) -> dict[str, Any]:
    schema = schemas.get(
        "https://aliengineering-byte.github.io/resilireplay/standards/mcp-res/v0.2.0/schemas/migration-result.schema.json"
    )
    schema_errors = schemas.errors(result, schema)
    if schema_errors:
        return _invalid("MCP_RES_MIGRATION_SCHEMA_INVALID", schema_errors)
    original = result["originalBundle"]
    if not validate_v01(original, v01_schemas):
        return _invalid("MCP_RES_MIGRATION_SOURCE_INVALID")
    if (
        result["source"]["evidenceSha256"] != original["statement"]["evidenceSha256"]
        or result["report"]["preservedEvidenceSha256"] != result["source"]["evidenceSha256"]
    ):
        return _invalid("MCP_RES_MIGRATION_DIGEST_MISMATCH")
    if (
        result["target"]["evidenceClass"] != original["evidence"]["evidenceClass"]
        or result["report"]["preservedEvidenceClass"] != original["evidence"]["evidenceClass"]
    ):
        return _invalid("MCP_RES_MIGRATION_CLASS_PROMOTION")
    if (
        result["migration"]["fabricatedEvidence"] is not False
        or result["target"]["authenticityClassification"] != "UNSIGNED_INTEGRITY_ONLY"
        or result["target"]["stabilityClassification"] != "SINGLE_OBSERVATION"
        or result["target"]["status"] != "INCOMPLETE"
        or any(item["strength"] != "LEGACY_SELF_ASSERTED" for item in result["target"]["legacyAssertions"])
        or result["report"]["legacyAssertionCount"] != len(result["target"]["legacyAssertions"])
        or canonicalize(result["report"]["unresolvedRequirements"])
        != canonicalize(result["target"]["unresolvedRequirements"])
    ):
        return _invalid("MCP_RES_MIGRATION_FABRICATION")
    return {"valid": True, "diagnostics": [], "schemaErrors": []}


def _check_ref(check: dict[str, Any]) -> str:
    return f"{check['scenarioId']}:{check['checkId']}"


def _official_status(attachment: dict[str, Any]) -> str:
    if any(
        check["outcome"] in {"FAILURE", "WARNING"} and not check["baselineExpected"]
        for check in attachment["checks"]
    ):
        return "INVALID"
    inventories = attachment["inventories"]
    if (
        attachment["staleExpectedFailures"]
        or inventories["skipped"]
        or inventories["untestable"]
        or inventories["pending"]
        or inventories["notScored"]
        or attachment["harness"]["exitCode"] != 0
        or any(
            item["status"] in {"UNINSTRUMENTED", "UNKNOWN"}
            for item in attachment["observationCoverage"]
        )
    ):
        return "INCOMPLETE"
    return "COMPLETE"


def validate_official(
    attachment: Any, schemas: SchemaSet, original_result: Path | None = None
) -> dict[str, Any]:
    schema = schemas.get(
        "https://aliengineering-byte.github.io/resilireplay/standards/mcp-res/v0.2.0/schemas/official-conformance-attachment.schema.json"
    )
    schema_errors = schemas.errors(attachment, schema)
    if schema_errors:
        return _invalid("MCP_RES_OFFICIAL_ATTACHMENT_SCHEMA_INVALID", schema_errors)
    if attachment["protocolRevision"] != attachment["requirementSet"]["revision"]:
        return _invalid("MCP_RES_OFFICIAL_REQUIREMENT_REVISION_MISMATCH")
    if attachment["legs"][attachment["mode"]] != "EXECUTED":
        return _invalid("MCP_RES_OFFICIAL_LEG_NOT_EXECUTED")
    checks = attachment["checks"]
    refs = [_check_ref(check) for check in checks]
    inventories = attachment["inventories"]
    expected_wire = sorted(_check_ref(check) for check in checks if check["wireSchema"])
    expected_warnings = sorted(
        _check_ref(check) for check in checks if check["outcome"] == "WARNING"
    )
    expected_skipped = sorted(
        _check_ref(check) for check in checks if check["outcome"] == "SKIPPED"
    )
    expected_untestable = sorted(
        _check_ref(check) for check in checks if check.get("untestable") is True
    )
    expected_pending = sorted(ref for ref in inventories["declared"] if ref not in refs)
    if (
        len(set(refs)) != len(refs)
        or sorted(refs) != inventories["executed"]
        or any(ref not in inventories["declared"] for ref in refs)
        or expected_wire != inventories["wireSchema"]
        or expected_warnings != inventories["warnings"]
        or expected_skipped != inventories["skipped"]
        or expected_untestable != inventories["untestable"]
        or expected_pending != inventories["pending"]
    ):
        return _invalid("MCP_RES_OFFICIAL_INVENTORY_MISMATCH")
    baseline = attachment["expectedFailureBaseline"]["entries"]
    if sha256(baseline) != attachment["expectedFailureBaseline"]["sha256"]:
        return _invalid("MCP_RES_OFFICIAL_INVENTORY_MISMATCH")
    for check in checks:
        expected = (
            _check_ref(check) in baseline and check["outcome"] in {"FAILURE", "WARNING"}
        )
        if check["baselineExpected"] != expected:
            return _invalid("MCP_RES_OFFICIAL_EXPECTED_FAILURE_REWRITTEN")
    failures = {
        _check_ref(check)
        for check in checks
        if check["outcome"] in {"FAILURE", "WARNING"}
    }
    stale = [ref for ref in baseline if ref not in failures]
    if stale != attachment["staleExpectedFailures"]:
        return _invalid("MCP_RES_OFFICIAL_STALE_BASELINE_MISMATCH")
    if original_result is not None:
        material = original_result.read_bytes()
        if (
            hashlib.sha256(material).hexdigest()
            != attachment["originalResultArtifact"]["sha256"]
            or len(material) != attachment["originalResultArtifact"]["bytes"]
        ):
            return _invalid("MCP_RES_OFFICIAL_RESULT_DIGEST_MISMATCH")
    boundary = attachment["mappingBoundary"]
    if not boundary["explicitMapping"] and boundary["mcpResEvidenceClass"] is not None:
        return _invalid("MCP_RES_OFFICIAL_MAPPING_OVERCLAIM")
    if _official_status(attachment) != attachment["importStatus"]:
        return _invalid("MCP_RES_OFFICIAL_STATUS_MISMATCH")
    return {
        "valid": True,
        "diagnostics": [],
        "schemaErrors": [],
        "importStatus": attachment["importStatus"],
        "officialCertificationClaim": False,
    }


def _profile_registered(manifest: dict[str, Any]) -> list[str]:
    return sorted(
        manifest["requiredChecks"]
        + [item["id"] for item in manifest["conditionalChecks"]]
        + manifest["experimentalChecks"]
    )


def _profile_applicable(manifest: dict[str, Any], revision: str) -> list[str]:
    return sorted(
        manifest["requiredChecks"]
        + [
            item["id"]
            for item in manifest["conditionalChecks"]
            if revision in item["protocolRevisions"]
        ]
    )


def _profile_digest(evaluation: dict[str, Any]) -> str:
    material = dict(evaluation)
    material.pop("evaluationSha256", None)
    return sha256(material)


def validate_profile(
    evaluation: Any, schemas: SchemaSet, profile_directory: Path
) -> dict[str, Any]:
    schema = schemas.get(
        "https://aliengineering-byte.github.io/resilireplay/standards/mcp-res/v0.2.0/schemas/profile-evaluation.schema.json"
    )
    schema_errors = schemas.errors(evaluation, schema)
    if schema_errors:
        return _invalid("MCP_RES_PROFILE_SCHEMA_INVALID", schema_errors)
    manifest_schema = schemas.get(
        "https://aliengineering-byte.github.io/resilireplay/standards/mcp-res/v0.2.0/schemas/reliability-profile-manifest.schema.json"
    )
    manifests: dict[str, dict[str, Any]] = {}
    try:
        for path in sorted(profile_directory.glob("*.json")):
            manifest = load_json(path)
            if schemas.errors(manifest, manifest_schema):
                return _invalid("MCP_RES_PROFILE_MANIFEST_INVALID")
            registered = _profile_registered(manifest)
            if len(set(registered)) != len(registered) or manifest["id"] in manifests:
                return _invalid("MCP_RES_PROFILE_MANIFEST_INVALID")
            manifests[manifest["id"]] = manifest
    except (OSError, ValueError):
        return _invalid("MCP_RES_PROFILE_MANIFEST_INVALID")
    reference = evaluation["profile"]
    manifest = manifests.get(reference["id"])
    if manifest is None or manifest["version"] != reference["version"]:
        return _invalid("MCP_RES_PROFILE_MANIFEST_UNKNOWN")
    revision = reference["protocolRevision"]
    if revision not in manifest["protocolRevisions"]:
        return _invalid("MCP_RES_PROFILE_REVISION_UNSUPPORTED")
    if sha256(manifest) != reference["manifestSha256"]:
        return _invalid("MCP_RES_PROFILE_MANIFEST_DIGEST_MISMATCH")
    if _profile_digest(evaluation) != evaluation["evaluationSha256"]:
        return _invalid("MCP_RES_PROFILE_DIGEST_MISMATCH")
    claimed = sorted(evaluation["scope"]["claimedCheckIds"])
    observed = sorted(check["id"] for check in evaluation["checks"])
    registered = set(_profile_registered(manifest))
    if (
        len(set(observed)) != len(observed)
        or claimed != observed
        or any(check_id not in registered for check_id in claimed)
        or (
            evaluation["scope"]["claim"] == "FULL_PROFILE"
            and claimed != _profile_applicable(manifest, revision)
        )
    ):
        return _invalid("MCP_RES_PROFILE_COVERAGE_MISMATCH")
    scope = evaluation["scope"]
    if scope["targetKind"] == "REMOTE_HTTP" and (
        not scope["remoteOptIn"]
        or not scope.get("allowlistSha256")
        or not scope.get("reviewedTargetSha256")
        or scope.get("reviewedTargetSha256") != scope["targetSha256"]
    ):
        return _invalid("MCP_RES_PROFILE_REMOTE_TARGET_UNREVIEWED")
    for check in evaluation["checks"]:
        for branch, negative in ((check["positive"], False), (check["negativeControl"], True)):
            if not branch["propertyReached"]:
                return _invalid("MCP_RES_PROFILE_PROPERTY_NOT_REACHED")
            if (
                branch["observedOutcome"] == "NOT_OBSERVED"
                or branch["expectedOutcome"] != branch["observedOutcome"]
            ):
                return _invalid(
                    "MCP_RES_PROFILE_NEGATIVE_CONTROL_MISSING"
                    if negative
                    else "MCP_RES_PROFILE_OUTCOME_MISMATCH"
                )
            if branch["expectedReasonCode"] != branch["observedReasonCode"]:
                return _invalid("MCP_RES_PROFILE_WRONG_REASON")
    if evaluation["cleanup"]["required"] and not evaluation["cleanup"]["observed"]:
        return _invalid("MCP_RES_PROFILE_CLEANUP_INCOMPLETE")
    fixture_only = any(
        branch["source"] == "TEST_FIXTURE"
        for check in evaluation["checks"]
        for branch in (check["positive"], check["negativeControl"])
    )
    derived = "INCOMPLETE" if fixture_only else "PASS"
    if evaluation["result"] != derived:
        return _invalid(
            "MCP_RES_PROFILE_TEST_FIXTURE_OVERCLAIM"
            if fixture_only and evaluation["result"] == "PASS"
            else "MCP_RES_PROFILE_RESULT_MISMATCH"
        )
    return {
        "valid": True,
        "diagnostics": [],
        "schemaErrors": [],
        "result": derived,
        "profileStatus": manifest["status"],
        "claimScope": evaluation["scope"]["claim"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Second-implementation MCP-RES v0.2 Python validator"
    )
    parser.add_argument(
        "mode",
        choices=["validate", "attestation", "migration", "official", "profile", "canonicalize"],
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("--schemas", type=Path)
    parser.add_argument("--trust-policy", type=Path)
    parser.add_argument("--profiles", type=Path)
    parser.add_argument("--original-result", type=Path)
    parser.add_argument("--evaluated-at", default="2026-08-27T18:05:00.000Z")
    arguments = parser.parse_args()
    schemas_path = arguments.schemas or Path(__file__).resolve().parents[2] / "schemas"
    try:
        value = load_json(arguments.input)
        if arguments.mode == "canonicalize":
            material = canonicalize(value).encode("utf-8")
            result = {
                "canonicalBase64": base64.b64encode(material).decode("ascii"),
                "sha256": hashlib.sha256(material).hexdigest(),
            }
        else:
            schemas = SchemaSet(schemas_path)
            if arguments.mode == "validate":
                result = validate_core(value, schemas)
            elif arguments.mode == "attestation":
                policy = load_json(arguments.trust_policy) if arguments.trust_policy else None
                result = validate_attestation(value, schemas, policy, arguments.evaluated_at)
            elif arguments.mode == "migration":
                v01_path = schemas_path.parents[1] / "v0.1.0" / "schemas"
                result = validate_migration(value, schemas, SchemaSet(v01_path))
            elif arguments.mode == "official":
                result = validate_official(value, schemas, arguments.original_result)
            else:
                profile_path = arguments.profiles or schemas_path.parent / "profiles"
                result = validate_profile(value, schemas, profile_path)
        print(json.dumps(result, separators=(",", ":"), ensure_ascii=False))
        return 0 if result.get("valid", True) else 1
    except Exception as error:  # Fail closed at the CLI boundary.
        print(
            json.dumps(
                {"valid": False, "diagnostics": ["MCP_RES_INPUT_INVALID"], "message": str(error)},
                separators=(",", ":"),
            )
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
