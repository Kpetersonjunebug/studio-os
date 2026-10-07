#!/bin/zsh

project_path="/Users/kevicat/canvas-apps/studio-os-web-test"
studio_url="http://localhost:8000"
probe_url="${studio_url}/index.html"
expected_title='<title>Studio OS V2.5 - Today</title>'
server_log="/tmp/studio-os-pilot-server.log"

is_studio_server() {
    /usr/bin/curl -fsS --max-time 2 "$probe_url" 2>/dev/null | /usr/bin/grep -Fq "$expected_title"
}

if ! is_studio_server; then
    if /usr/sbin/lsof -nP -iTCP:8000 -sTCP:LISTEN 2>/dev/null | /usr/bin/grep -q .; then
        /usr/bin/osascript -e 'display dialog "Port 8000 is already being used by another application.\n\nStudio OS Pilot did not start or stop any process." buttons {"OK"} default button "OK" with icon caution'
        exit 1
    fi

    cd "$project_path" || exit 1
    /usr/bin/nohup /usr/bin/python3 -m http.server 8000 --bind 127.0.0.1 > "$server_log" 2>&1 &!

    studio_started=false
    for attempt in {1..20}; do
        /bin/sleep 0.25
        if is_studio_server; then
            studio_started=true
            break
        fi
    done

    if [[ "$studio_started" != true ]]; then
        /usr/bin/osascript -e 'display dialog "Studio OS Pilot could not start its local server.\n\nSee /tmp/studio-os-pilot-server.log for details." buttons {"OK"} default button "OK" with icon caution'
        exit 1
    fi
fi

launch_version=$(/bin/date +%s)
/usr/bin/open -a Safari "${studio_url}/?launch=${launch_version}"
