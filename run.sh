#!/usr/bin/env bash

set -euo pipefail

PORT=8080

npx http-server . -p "$PORT" -o /bears.html