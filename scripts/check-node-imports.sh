#!/usr/bin/env bash
set -euo pipefail

if grep -rE "from ['\"]node:" lib \
    --include='*.ts' \
    --exclude-dir=node \
    --exclude-dir=node_modules; then
    echo "" >&2
    echo "error: node: imports found outside lib/node/" >&2
    echo "       move the file to lib/node/ or remove the import" >&2
    exit 1
fi