#!/usr/bin/env python3
"""
server.py - Local development server for MythosTree.

Provides:
- Standard static file serving (HTML, CSS, JS, JSON, images).
- Direct file save endpoint (POST /api/save) that writes directly to data/characters.json.
- Automatic atomic writing and safety backup (characters.json.bak).
"""

import http.server
import json
import os
import sys

PORT = 8000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, 'data', 'characters.json')


class MythosRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_POST(self):
        if self.path == '/api/save':
            self.handle_save()
        else:
            self.send_error(404, "Endpoint not found")

    def handle_save(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length <= 0:
                raise ValueError("Empty request body")

            body = self.rfile.read(content_length)
            payload = json.loads(body.decode('utf-8'))

            if not isinstance(payload, list):
                raise ValueError("Payload must be a JSON array of character objects")

            # Ensure data directory exists
            os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)

            # Atomic write: write to temp file first
            temp_file = DATA_FILE + '.tmp'
            with open(temp_file, 'w', encoding='utf-8') as f:
                json.dump(payload, f, indent=2, ensure_ascii=False)
                f.write('\n')

            # Create a backup of the existing characters.json
            bak_file = DATA_FILE + '.bak'
            if os.path.exists(DATA_FILE):
                try:
                    if os.path.exists(bak_file):
                        os.remove(bak_file)
                    os.rename(DATA_FILE, bak_file)
                except Exception as bak_err:
                    print(f"[MythosTree] Notice: could not rotate .bak: {bak_err}")

            # Replace with new file
            os.replace(temp_file, DATA_FILE)

            response_data = {
                "status": "ok",
                "count": len(payload),
                "message": f"Saved {len(payload)} characters directly to data/characters.json"
            }
            resp_bytes = json.dumps(response_data).encode('utf-8')

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(resp_bytes)))
            self.end_headers()
            self.wfile.write(resp_bytes)
            print(f"[MythosTree] [OK] Successfully saved {len(payload)} characters directly to data/characters.json")

        except Exception as e:
            err_data = {"status": "error", "message": str(e)}
            err_bytes = json.dumps(err_data).encode('utf-8')
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(err_bytes)))
            self.end_headers()
            self.wfile.write(err_bytes)
            print(f"[MythosTree] [ERROR] Failed to save characters: {e}", file=sys.stderr)


def run_server(port=PORT):
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    try:
        server_address = ('', port)
        httpd = http.server.ThreadingHTTPServer(server_address, MythosRequestHandler)
    except OSError as e:
        print("=" * 64, file=sys.stderr)
        print(f"  [ERROR] Port {port} is already in use!", file=sys.stderr)
        print("  If another MythosTree server or python terminal is running,", file=sys.stderr)
        print("  please close it first, or press Ctrl+C in its window.", file=sys.stderr)
        print("=" * 64, file=sys.stderr)
        sys.exit(1)

    print("=" * 64)
    print(f"  MythosTree Server running at http://localhost:{port}")
    print(f"  Serving directory: {BASE_DIR}")
    print("  Direct file saving API active at: POST /api/save")
    print("  Press Ctrl+C to stop the server.")
    print("=" * 64)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[MythosTree] Shutting down server.")
        httpd.server_close()



if __name__ == '__main__':
    run_server()
