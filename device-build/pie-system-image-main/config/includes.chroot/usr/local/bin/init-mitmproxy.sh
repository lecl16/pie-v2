#!/bin/bash

USER_NAME="student"
USER_HOME="/home/$USER_NAME"

echo "initialise mitmproxy..."
runuser -l "$USER_NAME" -c "mitmproxy --quit"

