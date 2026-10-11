"""Run the page locally with the real engine: python scripts/serve.py, then open http://localhost:8000.
Same UI and engine as on Qollab; only main.js is swapped for a shim that POSTs to /run,
where native Python plays the part of Qollab's Pyodide + built-in simulator."""

import http.server
import json
import sys
from functools import partial
from pathlib import Path

from qiskit.providers.basic_provider import BasicSimulator

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))  # so `engine` imports when run as scripts/serve.py

from engine import bridge  # noqa: E402

SHIM = b"""import { start } from './src/js/ui.js';
start({ run: (opts) => fetch('/run', { method: 'POST', body: JSON.stringify(opts) }).then((r) => r.json()) });
"""


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] == "/main.js":
            return self._send(SHIM, "text/javascript")
        super().do_GET()

    def do_POST(self):
        if self.path != "/run":
            return self.send_error(404)
        opts = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        try:
            out = bridge.run(BasicSimulator(), **opts).encode()
        except Exception as e:  # show engine errors in the page's status line, like on Qollab
            out = json.dumps({"error": f"{type(e).__name__}: {e}"}).encode()
        self._send(out, "application/json")

    def _send(self, body, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Steane Patterns on http://localhost:{port}")
    http.server.ThreadingHTTPServer(("", port), partial(Handler, directory=str(ROOT))).serve_forever()
