const REDACTED = "[REDACTED]";
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

function sanitizeString(value: string): string {
  return TOKEN_PATTERNS.reduce((current, pattern) => current.replace(pattern, REDACTED), value);
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
  const text = JSON.stringify(value);
  return TOKEN_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}
