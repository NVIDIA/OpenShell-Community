---
name: cursor-desktop
description: >
  Interact with the Cursor desktop IDE running inside the cursor-desktop OpenShell sandbox.
  Use this skill when the user wants to open a project in Cursor, edit files visually,
  run terminal commands from the Cursor integrated terminal, or access Cursor AI features
  through the browser-based noVNC UI. Trigger keywords: cursor, IDE, open project,
  cursor desktop, noVNC, visual editor, open in cursor.
---

# Cursor Desktop Sandbox

This sandbox runs the full Cursor Linux desktop application inside an OpenShell policy boundary
and delivers the UI through a browser via noVNC.

## Accessing the UI

The noVNC web interface is available on the forwarded port (default 6080).
Open `http://localhost:6080/index.html` in a browser after creating the sandbox with `--forward 6080`.

## Workspace

Projects should be placed under `/sandbox/workspace`. This directory is the default location
Cursor opens on startup and is writable by the `sandbox` user.

## Uploading a project

```bash
openshell upload ./my-project /sandbox/workspace/my-project
```

## Viewing logs

| Log file          | Contents                          |
|-------------------|-----------------------------------|
| `/tmp/cursor.log` | Cursor stdout / stderr            |
| `/tmp/openbox.log`| Desktop session output            |
| `/tmp/x11vnc.log` | VNC server output                 |
| `/tmp/novnc.log`  | noVNC web bridge output           |

## Running the smoke test

```bash
openshell sandbox exec cursor-desktop -- /sandbox/scripts/smoke-test.sh
```

## Policy iteration

Cursor is an Electron app and may call endpoints not yet in `policy.yaml` on first launch.
Collect denied events with `openshell logs` and add any missing hosts before switching from
`enforcement_mode: audit` to `enforce`.
