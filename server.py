"""Static BaseGrid server plus a bounded, read-only LastWarTools relay. No packages needed."""

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
UPSTREAM = "https://api.lastwar.tools"
MAX_RESPONSE = 2 * 1024 * 1024
ASSETS = {"/", "/index.html", "/styles.css", "/ui.js", "/placement.js", "/players.js",
          "/storage.js", "/import-ui.js", "/lastwar-api.js", "/roster-cache.js", "/reorder-ui.js",
          "/placement-messages.js", "/free-formation.js", "/tile-placement.js", "/grid-layout.js", "/map-zoom.js", "/lifebloom-zombie.png",
          "/battle.html", "/battle.css", "/battle-ui.js", "/battle-model.js", "/battle-render.js", "/battle-canyon.png", "/battle-desert.png"}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward an API key to a redirect destination.
        return None


def upstream_path(path):
    """Only the two documented read operations; callers cannot choose a host or query."""
    match = re.fullmatch(r"/api/lastwar/rankings/([1-9][0-9]{0,9})/alliances", path)
    if match:
        return f"/rankings/{match[1]}/alliances?limit=200"
    match = re.fullmatch(r"/api/lastwar/alliance/([a-fA-F0-9]{32})/members", path)
    if match:
        return f"/alliance/{match[1].lower()}/members?sort_by=power&descending=true"
    raise ValueError("Unsupported import request")


def fetch_upstream(path, api_key):
    """Key is only held for this request. Upstream error bodies are never relayed."""
    request = urllib.request.Request(UPSTREAM + path, headers={
        "X-API-Key": api_key, "Accept": "application/json", "User-Agent": "BaseGrid/1.0",
    })
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=90) as response:
            body = response.read(MAX_RESPONSE + 1)
            if len(body) > MAX_RESPONSE:
                return 502, {"error": "Upstream response is too large"}
            return 200, json.loads(body)
    except urllib.error.HTTPError as error:
        status = error.code if error.code in (401, 402, 403, 404, 422, 429, 503, 504) else 502
        error.close()
        return status, {"error": "LastWarTools request failed"}
    except TimeoutError:
        return 504, {"error": "Upstream request timed out"}
    except (urllib.error.URLError, OSError, ValueError):
        return 502, {"error": "Upstream service unavailable"}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def json_response(self, status, payload, *, head=False):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-BaseGrid-Relay", "1")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if not head:
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass  # The user may close the dialog during a queued request.

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path.startswith("/api/"):
            origin = self.headers.get("Origin")
            host = self.headers.get("Host", "")
            if self.headers.get("Sec-Fetch-Site") == "cross-site" or (origin and origin not in (f"http://{host}", f"https://{host}")):
                self.json_response(403, {"error": "Cross-origin requests are not accepted"})
                return
            try:
                if parsed.query:
                    raise ValueError("Query parameters are not accepted")
                path = upstream_path(parsed.path)
            except ValueError:
                self.json_response(404, {"error": "Unsupported import request"})
                return
            api_key = self.headers.get("X-API-Key", "").strip()
            if not api_key or len(api_key) > 1024:
                self.json_response(401, {"error": "An API key is required"})
                return
            status, payload = fetch_upstream(path, api_key)
            self.json_response(status, payload)
        elif parsed.path in ASSETS:
            super().do_GET()
        else:
            self.send_error(404)

    def do_HEAD(self):
        if urllib.parse.urlsplit(self.path).path in ASSETS:
            super().do_HEAD()
        else:
            self.send_error(404)

    def log_message(self, format, *args):
        # Don't log URLs or headers: credentials might be pasted in the wrong place.
        if len(args) > 1:
            print(f"{self.command} request: {args[1]}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"BaseGrid: http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
