#!/usr/bin/env bash
# Runs the khanha-deploy document on production's host and waits for it (P8 PR 07, deploy-production.yml). With two
# tags they are the candidate; with none the host applies the release parameter's tags (the undo). The host returns
# to the parameter's release by itself when the candidate never becomes ready, so a failure here leaves it there.
# Usage: scripts/ci/deploy-host.sh [<web-tag> <server-tag>]
set -euo pipefail

hosts=$(aws ec2 describe-instances \
  --filters Name=tag:app,Values=khanha Name=tag:env,Values=production Name=instance-state-name,Values=running \
  --query 'Reservations[].Instances[].InstanceId' --output text)
read -r -a ids <<<"$hosts"
if [ "${#ids[@]}" -ne 1 ]; then
  echo "deploy-host: expected one running production host, found: ${hosts:-none}" >&2
  exit 1
fi
host=${ids[0]}

params=()
comment="apply the release parameter"
if [ $# -eq 2 ]; then
  params=(--parameters "webTag=$1,serverTag=$2")
  comment="deploy $1 $2"
fi
# Delivery is bounded (--timeout-seconds) and so is execution (the document's 900 s), so after both the command can
# no longer change the host: only then may a caller start the undo.
delivery_s=600
command=$(aws ssm send-command --document-name khanha-deploy --instance-ids "$host" "${params[@]}" \
  --timeout-seconds "$delivery_s" --comment "$comment" --query Command.CommandId --output text)
echo "deploy-host: command $command on $host"

# Until the agent has the command its invocation does not exist yet. Any other error (throttling, a network blip) is
# retried until the deadline: giving up early could leave the command still changing the host under the undo.
wait_s=$((delivery_s + 900 + 60))
deadline=$((SECONDS + wait_s))
while :; do
  if ! status=$(aws ssm get-command-invocation --command-id "$command" --instance-id "$host" \
    --query Status --output text 2>&1); then
    case $status in
      *InvocationDoesNotExist*) ;;
      *) echo "deploy-host: cannot read the command's status yet: $status" >&2 ;;
    esac
    status=Pending
  fi
  case $status in Pending | InProgress | Delayed) ;; *) break ;; esac
  if [ "$SECONDS" -ge "$deadline" ]; then
    status="still $status after ${wait_s}s"
    break
  fi
  sleep 10
done

aws ssm get-command-invocation --command-id "$command" --instance-id "$host" \
  --query '[StandardOutputContent, StandardErrorContent]' --output text || true
if [ "$status" != Success ]; then
  echo "deploy-host: the command ended $status" >&2
  exit 1
fi
