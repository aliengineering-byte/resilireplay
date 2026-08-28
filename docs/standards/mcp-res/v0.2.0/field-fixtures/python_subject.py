import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SUPPORTED = {"2025-11-25", "2026-07-28"}
TOKEN = "mcp-res-loopback-field-token"


def response_for(message):
    revision = str(message.get("protocolRevision"))
    if revision not in SUPPORTED:
        return {
            "id": message.get("id"),
            "error": {"code": -32602, "reason": "MCP_RES_PROTOCOL_REVISION_UNSUPPORTED"},
        }
    return {
        "id": message.get("id"),
        "result": {"protocolRevision": revision, "accepted": True},
    }


def run_stdio():
    for line in sys.stdin:
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            print("MCP_RES_STDIO_MALFORMED_OUTPUT", file=sys.stderr, flush=True)
            continue
        if message.get("method") == "shutdown":
            print(json.dumps({"id": message.get("id"), "result": "shutdown"}), flush=True)
            return
        print(json.dumps(response_for(message), separators=(",", ":")), flush=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        return

    def _authorized(self):
        if self.headers.get("Authorization") == f"Bearer {TOKEN}":
            return True
        body = json.dumps({"reason": "MCP_RES_HTTP_AUTH_REQUIRED"}).encode()
        self.send_response(401)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return False

    def do_POST(self):
        if not self._authorized():
            return
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "http://192.0.2.1/disallowed")
            self.end_headers()
            return
        if self.path == "/interrupt":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", "4096")
            self.end_headers()
            self.wfile.write(b"event: message\ndata: partial")
            self.wfile.flush()
            self.connection.shutdown(1)
            return
        if self.path == "/shutdown":
            self.send_response(204)
            self.end_headers()
            self.server.shutdown_requested = True
            return
        length = int(self.headers.get("Content-Length", "0"))
        message = json.loads(self.rfile.read(length))
        body_value = response_for(message)
        if self.headers.get("Accept") == "text/event-stream":
            body = f"event: message\ndata: {json.dumps(body_value, separators=(',', ':'))}\n\n".encode()
            content_type = "text/event-stream"
        else:
            body = json.dumps(body_value, separators=(",", ":")).encode()
            content_type = "application/json"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def run_http():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    server.timeout = 0.25
    server.shutdown_requested = False
    print(json.dumps({"port": server.server_address[1]}, separators=(",", ":")), flush=True)
    while not server.shutdown_requested:
        server.handle_request()
    server.server_close()


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in {"stdio", "http"}:
        print("usage: python_subject.py <stdio|http>", file=sys.stderr)
        raise SystemExit(2)
    run_stdio() if sys.argv[1] == "stdio" else run_http()
