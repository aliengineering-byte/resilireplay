import { lstat, readFile } from "node:fs/promises";

export const SAFE_JSON_LIMITS = Object.freeze({
  maxBytes: 16 * 1024 * 1024,
  maxDepth: 128,
  maxNodes: 250_000,
  maxStringLength: 1_048_576,
});

export function parseInertJson(text, limits = SAFE_JSON_LIMITS) {
  let index = 0;
  let nodes = 0;
  function fail(message) {
    throw new Error(`MCP_RES_INPUT_INVALID: ${message} at byte ${index}`);
  }
  function whitespace() {
    while (/[\t\n\r ]/u.test(text[index] ?? "")) index += 1;
  }
  function string() {
    if (text[index] !== '"') fail("expected string");
    const start = index;
    index += 1;
    let escaped = false;
    while (index < text.length) {
      const character = text[index];
      if (!escaped && character === '"') {
        index += 1;
        const value = JSON.parse(text.slice(start, index));
        if (value.length > limits.maxStringLength) fail("string limit exceeded");
        if (
          [...value].some((character) => {
            const code = character.charCodeAt(0);
            return code >= 0xd800 && code <= 0xdfff;
          })
        )
          fail("lone surrogate rejected");
        return value;
      }
      if (!escaped && character === "\\") escaped = true;
      else escaped = false;
      if (character.charCodeAt(0) < 0x20) fail("unescaped control character");
      index += 1;
    }
    fail("unterminated string");
  }
  function value(depth) {
    if (depth > limits.maxDepth) fail("depth limit exceeded");
    nodes += 1;
    if (nodes > limits.maxNodes) fail("node limit exceeded");
    whitespace();
    if (text[index] === '"') return string();
    if (text[index] === "{") {
      index += 1;
      whitespace();
      const result = {};
      const keys = new Set();
      if (text[index] === "}") {
        index += 1;
        return result;
      }
      while (true) {
        whitespace();
        const key = string();
        if (keys.has(key)) fail(`duplicate key ${key}`);
        keys.add(key);
        whitespace();
        if (text[index] !== ":") fail("expected colon");
        index += 1;
        result[key] = value(depth + 1);
        whitespace();
        if (text[index] === "}") {
          index += 1;
          return result;
        }
        if (text[index] !== ",") fail("expected comma");
        index += 1;
      }
    }
    if (text[index] === "[") {
      index += 1;
      whitespace();
      const result = [];
      if (text[index] === "]") {
        index += 1;
        return result;
      }
      while (true) {
        result.push(value(depth + 1));
        whitespace();
        if (text[index] === "]") {
          index += 1;
          return result;
        }
        if (text[index] !== ",") fail("expected comma");
        index += 1;
      }
    }
    for (const [literal, output] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ]) {
      if (text.startsWith(literal, index)) {
        index += literal.length;
        return output;
      }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(index));
    if (!match) fail("invalid value");
    index += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) fail("non-finite number");
    if (!Number.isSafeInteger(number)) fail("non-safe integer or floating point rejected");
    return number;
  }
  const output = value(0);
  whitespace();
  if (index !== text.length) fail("trailing input");
  return output;
}

export async function readInertJson(path, limits = SAFE_JSON_LIMITS) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("MCP_RES_INPUT_INVALID: input must be a regular non-symlink file");
  }
  if (metadata.size > limits.maxBytes) {
    throw new Error("MCP_RES_INPUT_INVALID: byte limit exceeded");
  }
  const bytes = await readFile(path);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return parseInertJson(text, limits);
}
