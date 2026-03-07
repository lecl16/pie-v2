#!/bin/bash
set -e

systemctl enable init-firefox.service
chmod +x /usr/local/bin/init-firefox.sh

sleep 10

systemctl enable init-mitmproxy.service
chmod +x /usr/local/bin/init-mitmproxy.sh
