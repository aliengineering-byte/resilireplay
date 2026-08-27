const REDACTED = "[REDACTED]";
const MAX_ENCODED_CANDIDATE_LENGTH = 4_096;
const SENSITIVE_KEY =
  /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|private[_-]?key|client[_-]?secret)$|(?:^|[_-])(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|private[_-]?key|client[_-]?secret)(?:$|[_-])/i;
const TOKEN_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\bBearer%20[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\bBasic\s+[A-Za-z0-9+/]{16,}={0,2}\b/gi,
  /\bbase64:[A-Za-z0-9+/]{16,}={0,2}\b/gi,
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk%2D[A-Za-z0-9_-]{16,}\b/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
];
const BASE64_CANDIDATE = /(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{16,}={0,2}(?![A-Za-z0-9+/_=-])/gu;

function matchesTokenPattern(value: string): boolean {
  return TOKEN_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

function decodedBase64ContainsSecret(value: string): boolean {
  if (value.length > MAX_ENCODED_CANDIDATE_LENGTH || value.length % 4 === 1) return false;
  try {
    const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
    const unpadded = normalized.replace(/=+$/u, "");
    const padded = unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, "=");
    const decoded = Buffer.from(padded, "base64");
    if (decoded.length === 0 || decoded.toString("base64").replace(/=+$/u, "") !== unpadded) {
      return false;
    }
    const text = decoded.toString("utf8");
    if (text.includes("\uFFFD")) return false;
    return matchesTokenPattern(text);
  } catch {
    return false;
  }
}

function encodedValueContainsSecret(value: string): boolean {
  BASE64_CANDIDATE.lastIndex = 0;
  for (const match of value.matchAll(BASE64_CANDIDATE)) {
    if (decodedBase64ContainsSecret(match[0])) return true;
  }
  if (!value.includes("%")) return false;
  try {
    const decoded = decodeURIComponent(value);
    return decoded !== value && matchesTokenPattern(decoded);
  } catch {
    return false;
  }
}

function sanitizeString(value: string): string {
  let sanitized = TOKEN_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, REDACTED),
    value,
  );
  BASE64_CANDIDATE.lastIndex = 0;
  sanitized = sanitized.replace(BASE64_CANDIDATE, (candidate) =>
    decodedBase64ContainsSecret(candidate) ? REDACTED : candidate,
  );
  if (sanitized.includes("%")) {
    try {
      const decoded = decodeURIComponent(sanitized);
      if (decoded !== sanitized && matchesTokenPattern(decoded)) return REDACTED;
    } catch {
      // Malformed percent escapes are inert text and remain available for diagnostics.
    }
  }
  return sanitized;
}

function visit(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return sanitizeString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) {
    const output = value.map((entry) => visit(entry, seen));
    seen.delete(value);
    return output;
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY.test(key) ? REDACTED : visit(entry, seen);
  }
  seen.delete(value);
  return output;
}

export function sanitize<T>(value: T): T {
  return visit(value, new WeakSet<object>()) as T;
}

export function containsLikelySecret(value: unknown): boolean {
  const seen = new WeakSet<object>();
  const visitForSecret = (current: unknown): boolean => {
    if (typeof current === "string") {
      return matchesTokenPattern(current) || encodedValueContainsSecret(current);
    }
    if (typeof current !== "object" || current === null) return false;
    if (seen.has(current)) return false;
    seen.add(current);
    if (Array.isArray(current)) return current.some(visitForSecret);
    return Object.entries(current).some(
      ([key, entry]) => (SENSITIVE_KEY.test(key) && entry !== REDACTED) || visitForSecret(entry),
    );
  };
  return visitForSecret(value);
}
