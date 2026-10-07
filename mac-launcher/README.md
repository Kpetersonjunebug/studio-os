# Studio OS Pilot macOS Launcher

`Studio OS Pilot.sh` is the source used by the double-clickable application bundle.

The launcher:

- reuses port 8000 when it is already serving this Studio OS project;
- starts `python3 -m http.server 8000 --bind 127.0.0.1` from this repository when the port is free;
- refuses to stop or replace an unrelated process using port 8000;
- opens `http://localhost:8000` in Safari;
- writes server output to `/tmp/studio-os-pilot-server.log`.

The project-local `Studio OS Pilot.app` contains the same launcher at
`Contents/MacOS/Studio OS Pilot`.

The app can be copied to the Desktop without moving or duplicating the Studio OS project.
