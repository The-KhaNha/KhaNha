#!/bin/bash
# Publishes the host's used memory and swap, in percent, to CloudWatch (P8 PR 08); khanha-host-metrics@<environment>
# .timer runs it every five minutes, and the host-memory alarm reads it (modules/observability). No CloudWatch agent:
# it would itself take memory on a 1 GB host. Used is what the kernel cannot hand out, MemTotal - MemAvailable, which
# is `free`'s "used" column.
# Usage: host-metrics.sh <environment>    (MEMINFO points the test at a fixture)
set -euo pipefail

environment=${1:?usage: host-metrics.sh <environment>}

read -r memory swap < <(awk '
  /^MemTotal:/ { total = $2 } /^MemAvailable:/ { available = $2 }
  /^SwapTotal:/ { swap_total = $2 } /^SwapFree:/ { swap_free = $2 }
  END {
    swap = swap_total > 0 ? 100 * (swap_total - swap_free) / swap_total : 0
    printf "%.1f %.1f\n", 100 * (total - available) / total, swap
  }
' "${MEMINFO:-/proc/meminfo}")

# The host role may publish to this namespace only (modules/iam).
aws cloudwatch put-metric-data --namespace "KhaNha/$environment" --metric-data \
  "MetricName=HostMemoryUsedPercent,Value=$memory,Unit=Percent" \
  "MetricName=HostSwapUsedPercent,Value=$swap,Unit=Percent"
