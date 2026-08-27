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
const BASE64_CHARACTER = /^[A-Za-z0-9+/_-]$/u;

function* base64CandidateRanges(value: string): Generator<readonly [number, number]> {
  let index = 0;
  while (index < value.length) {
    if (!BASE64_CHARACTER.test(value[index]!)) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < value.length && BASE64_CHARACTER.test(value[index]!)) index += 1;
    const alphabetLength = index - start;
    let end = index;
    while (end < value.length && value[end] === "=" && end - index < 2) end += 1;
    const hasExcessPadding = value[end] === "=";
    if (alphabetLength >= 16 && end - start <= MAX_ENCODED_CANDIDATE_LENGTH && !hasExcessPadding) {
      yield [start, end];
    }
    index = Math.max(end, index + 1);
  }
}

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
  for (const [start, end] of base64CandidateRanges(value)) {
    if (decodedBase64ContainsSecret(value.slice(start, end))) return true;
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
  const replacements: string[] = [];
  let cursor = 0;
  for (const [start, end] of base64CandidateRanges(sanitized)) {
    const candidate = sanitized.slice(start, end);
    if (!decodedBase64ContainsSecret(candidate)) continue;
    replacements.push(sanitized.slice(cursor, start), REDACTED);
    cursor = end;
  }
  if (replacements.length > 0) {
    replacements.push(sanitized.slice(cursor));
    sanitized = replacements.join("");
  }
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
