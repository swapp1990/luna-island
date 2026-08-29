"""Client for the blender-mcp addon socket (localhost:9876).

Usage:
  py tools/blender_client.py ping
  py tools/blender_client.py info
  py tools/blender_client.py exec scripts/ph0_scaffold.py
  py tools/blender_client.py shot renders/preview.png [max_size]
Stdlib only. Protocol: one JSON object per message, newline-free.
"""
import json
import socket
import sys
import os

HOST, PORT = "127.0.0.1", 9876


def send_command(cmd_type, params=None, timeout=300):
    payload = json.dumps({"type": cmd_type, "params": params or {}})
    with socket.create_connection((HOST, PORT), timeout=timeout) as s:
        s.settimeout(timeout)
        s.sendall(payload.encode("utf-8"))
        buf = b""
        while True:
            try:
                chunk = s.recv(65536)
            except socket.timeout:
                break
            if not chunk:
                break
            buf += chunk
            try:
                json.loads(buf.decode("utf-8"))
                break
            except json.JSONDecodeError:
                continue
    if not buf:
        raise RuntimeError("no response from Blender")
    return json.loads(buf.decode("utf-8"))


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "ping"
    if cmd == "ping":
        print(json.dumps(send_command("ping"), indent=2))
    elif cmd == "info":
        print(json.dumps(send_command("get_scene_info"), indent=2))
    elif cmd == "exec":
        path = os.path.abspath(argv[2])
        code = open(path, encoding="utf-8").read()
        resp = send_command("execute_code", {"code": code})
        out = resp.get("result") or resp.get("message")
        print(f"[{resp.get('status')}] {out}")
        sys.exit(0 if resp.get("status") == "success" else 1)
    elif cmd == "shot":
        filepath = os.path.abspath(argv[2])
        max_size = int(argv[3]) if len(argv) > 3 else 1280
        print(json.dumps(send_command(
            "get_viewport_screenshot", {"filepath": filepath, "max_size": max_size}), indent=2))
    else:
        raise SystemExit(f"unknown command: {cmd}")


if __name__ == "__main__":
    main(sys.argv)
