#!/usr/bin/env python3
"""Local native MCP acceptance. Copy the pairing token in the isolated app first.

No provider calls. Only mutate a blank canvas (or our uniquely marked fixture).
The token stays in process memory and is never included in output or reports.
"""
import argparse
import json
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--endpoint", required=True)
parser.add_argument("--canvas", action="store_true")
parser.add_argument("--wait-canvas", action="store_true")
parser.add_argument("--wait-undo", action="store_true")
parser.add_argument("--existing-fixture", action="store_true")
parser.add_argument("--expect-fixture", action="store_true")
args = parser.parse_args()
parsed = urllib.parse.urlparse(args.endpoint)
if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.path != "/mcp" or parsed.query:
    raise SystemExit("Only an explicit loopback MCP endpoint is accepted")
token = subprocess.check_output(["/usr/bin/pbpaste"]).decode().strip()
if not re.fullmatch(r"[0-9a-f]{64}", token):
    raise SystemExit("Copy the isolated app pairing token before running this check")
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
sequence = 0
checks = []


def rpc(method, params=None, authenticated=True, notification=False):
    global sequence
    sequence += 1
    payload = {"jsonrpc": "2.0", "method": method}
    if not notification:
        payload["id"] = sequence
    if params is not None:
        payload["params"] = params
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18"}
    if authenticated:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(args.endpoint, json.dumps(payload).encode(), headers)
    try:
        with opener.open(request, timeout=15) as response:
            data = response.read()
            if notification:
                assert response.status == 202 and not data
                return None
            value = json.loads(data)
    except urllib.error.HTTPError as error:
        if not authenticated and error.code == 401:
            return None
        raise RuntimeError("MCP HTTP request rejected: " + str(error.code)) from None
    if not authenticated:
        raise RuntimeError("Unauthenticated request unexpectedly accepted")
    if "error" in value:
        raise RuntimeError("MCP error code: " + str(value["error"].get("code")))
    return value["result"]


def call(name, arguments=None):
    result = rpc("tools/call", {"name": name, "arguments": arguments or {}})
    if result.get("isError"):
        raise RuntimeError("Tool failed: " + name)
    text = result["content"][0]["text"]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


rpc("ping", authenticated=False)
checks.append("unauthenticated_401")
initialized = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "OpenTu native acceptance", "version": "1"}})
assert initialized["protocolVersion"] == "2025-06-18"
rpc("notifications/initialized", notification=True)
assert rpc("ping") == {}
tools = rpc("tools/list")["tools"]
assert len(tools) == 9
checks += ["initialize", "empty_202_notification", "ping", "nine_tools"]
if args.wait_canvas:
    deadline = time.monotonic() + 50
    while True:
        try:
            canvas = call("opentu_get_canvas")
            break
        except RuntimeError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(1)
else:
    canvas = call("opentu_get_canvas")
checks.append("renderer_canvas_snapshot")
models = call("opentu_list_models")
assert isinstance(models["models"], list)
checks.append("renderer_model_list")
marker = "SYNTHETIC OpenTu MCP acceptance 2026-11-17"
if args.expect_fixture:
    assert len(canvas["elements"]) == 1 and marker in json.dumps(canvas["elements"][0])
    checks.append("persisted_fixture_restored")
if args.canvas:
    if canvas["elements"] and not args.existing_fixture:
        raise RuntimeError("Canvas must be empty; existing work will not be modified")
    if not canvas["elements"]:
        call("opentu_insert_to_canvas", {"items": [{"type": "text", "content": marker}]})
    canvas = call("opentu_get_canvas")
    assert len(canvas["elements"]) == 1
    element = canvas["elements"][0]
    assert marker in json.dumps(element)
    checks.append("insert_text_and_read_back")
    plan = {"version": 1, "boardId": canvas["boardId"], "revision": canvas["revision"], "status": "ready", "actions": [{"op": "move", "ids": [element["id"]], "dx": 40, "dy": 30}]}
    call("opentu_apply_canvas_edit", {"plan": plan})
    after = call("opentu_get_canvas")
    assert after["revision"] != canvas["revision"]
    checks.append("reversible_move_and_revision_change")
    stale = rpc("tools/call", {"name": "opentu_apply_canvas_edit", "arguments": {"plan": plan}})
    assert stale.get("isError") is True
    assert call("opentu_get_canvas")["revision"] == after["revision"]
    checks.append("stale_revision_rejected_without_mutation")
    if args.wait_undo:
        print(json.dumps({"awaitingUndo": True, "completedChecks": checks}), flush=True)
        deadline = time.monotonic() + 180
        while call("opentu_get_canvas")["revision"] != canvas["revision"]:
            if time.monotonic() >= deadline:
                raise RuntimeError("Timed out waiting for canvas undo")
            time.sleep(1)
        checks.append("native_keyboard_undo_restores_revision")
print(json.dumps({"checks": checks, "toolCount": len(tools), "modelCount": len(models["models"]), "canvasElements": len(call("opentu_get_canvas")["elements"]), "targetChatGPTClientTested": False}, indent=2))
