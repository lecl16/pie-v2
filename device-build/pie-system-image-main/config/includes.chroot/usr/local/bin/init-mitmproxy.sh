#!/bin/bash
# Creates the student's mitmproxy CA at boot, before the desktop starts, and
# publishes its certificate where Firefox's enterprise policy installs it
# from (/usr/lib/firefox-esr/distribution/policies.json). Firefox then
# trusts the proxy on every start, with no profile, certutil or timing
# involved. The proxies themselves run as the student (inject-cert.sh,
# mitmproxy.desktop), so the CA lives in the student's ~/.mitmproxy.

USER_NAME="student"
CONF_DIR="/home/$USER_NAME/.mitmproxy"
CA_CERT="$CONF_DIR/mitmproxy-ca-cert.pem"
PUBLISHED_CA="/usr/local/share/pie/mitmproxy-ca-cert.pem"

if [ ! -s "$CA_CERT" ]; then
    # mitmdump writes its CA to the confdir as soon as it starts.
    runuser -u "$USER_NAME" -- mitmdump --listen-host 127.0.0.1 -p 18081 >/dev/null 2>&1 &
    PID=$!
    for _ in $(seq 1 60); do
        [ -s "$CA_CERT" ] && break
        sleep 0.5
    done
    kill "$PID" 2>/dev/null
    wait "$PID" 2>/dev/null
fi

if [ ! -s "$CA_CERT" ]; then
    echo "mitmproxy CA was not created at $CA_CERT" >&2
    exit 1
fi

install -D -m 0644 -o root -g root "$CA_CERT" "$PUBLISHED_CA"
echo "mitmproxy CA published at $PUBLISHED_CA"
