#!/usr/bin/env python3
"""Launcher for the Laws Graphify Dashboard

Starts a local HTTP server on port 8000 and opens the browser to the interactive
legal cross-reference knowledge graph dashboard.
"""

import http.server
import os
import threading
import time
import webbrowser

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)


class ThreadingServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = True
    request_queue_size = 128


def open_browser():
    # Wait a second for the server to spin up
    time.sleep(1.5)
    url = f"http://localhost:{PORT}/web/"
    print(f"\n[Launcher] Opening browser to: {url}")
    webbrowser.open(url)


def run_server():
    with ThreadingServer(("", PORT), Handler) as httpd:
        print(f"\n[Server] Laws Graphify local server running at http://localhost:{PORT}/")
        print("[Server] Press Ctrl+C to stop the server.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[Server] Shutting down.")


if __name__ == "__main__":
    # Start browser thread
    threading.Thread(target=open_browser, daemon=True).start()
    # Start HTTP server
    run_server()
