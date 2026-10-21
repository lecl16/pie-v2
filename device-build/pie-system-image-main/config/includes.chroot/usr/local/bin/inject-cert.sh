#!/bin/bash
# Starts the filtering proxy Firefox uses (port 8081, see
# /usr/lib/firefox-esr/proxy.cfg). Firefox trusts its CA through the
# enterprise policy in /usr/lib/firefox-esr/distribution/policies.json; the
# CA is created at boot by init-mitmproxy.service. (The name is historical:
# this script used to add the CA to the Firefox profile with certutil, which
# depended on the profile existing in time.)

exec mitmdump -p 8081 -s /usr/local/bin/whitelist.py
