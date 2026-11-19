#!/bin/bash
# Writes the environment for compose.prod.yml (P8 PR 04): Parameter Store's /khanha/<environment>/* into params.env,
# and the keys of the one secret khanha/<environment>/app into secret.env, both on tmpfs and readable by root only.
# Only upper-case names become variables, so the release parameter (/khanha/<environment>/release) is left out.
# Usage: render-env.sh <environment>
# pipefail: a failed aws call must fail the script, not leave an empty file behind.
set -euo pipefail

environment=${1:?usage: render-env.sh <environment>}
out=${ENV_DIR:-/run/khanha}

umask 077
mkdir -p "$out"

aws ssm get-parameters-by-path --path "/khanha/$environment" --with-decryption \
  --query 'Parameters[].[Name,Value]' --output text |
  awk -F '\t' '{ name = $1; sub(/.*\//, "", name); if (name ~ /^[A-Z][A-Z0-9_]*$/) print name "=" $2 }' \
    >"$out/params.env.new"

# The secret is a JSON object of KEY: value. A value with a line break would corrupt the file, so it is refused.
aws secretsmanager get-secret-value --secret-id "khanha/$environment/app" --query SecretString --output text |
  python3 -c '
import json, sys
for key, value in json.load(sys.stdin).items():
    if "\n" in str(value):
        sys.exit(f"render-env: {key} contains a line break")
    print(f"{key}={value}")
' >"$out/secret.env.new"

mv "$out/params.env.new" "$out/params.env"
mv "$out/secret.env.new" "$out/secret.env"
echo "render-env: wrote $out/params.env and $out/secret.env"
