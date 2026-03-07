#!/bin/bash
set -e

systemctl enable setup-wifi.service
chmod +x /usr/local/bin/setup-wifi.sh
