# Logs, metrics and alarms (P8 PR 08), inside CloudWatch's free allowances: 10 alarms, 10 custom metrics, 3
# dashboards and 5 GB of logs a month. This module uses 9 alarms, 8 custom metrics (5 from the logs below, 1 for dead
# letters, 2 from the host's timer) and 1 dashboard. Adding an alarm or a metric starts billing past those counts.

locals {
  services = toset(["api", "web", "worker"])

  # The "Process metrics" line (server/src/utils/processMetrics.ts) and the fields each metric reads.
  # server/test/logging.safe.test.ts reads these locals: renaming a field in the code without here fails it, so a
  # rename can never silently blind an alarm.
  metrics_message     = "Process metrics"
  dead_letter_message = "Job dead-lettered"
  api_line_fields = {
    ApiRequests = "requests"
    Api5xx      = "serverErrors"
    ApiP95Ms    = "p95Ms"
  }
  worker_line_fields = {
    QueueDepth          = "queueDepth"
    OldestMessageAgeSec = "oldestAgeSec"
  }

  line_metrics = merge(
    { for metric, field in local.api_line_fields : metric => { service = "api", field = field } },
    { for metric, field in local.worker_line_fields : metric => { service = "worker", field = field } },
  )

  # The bootstrap's topics (it holds the address; infra/README.md "Alarms"). Named, not looked up, so a plan never
  # depends on the bootstrap having been applied: until it is, the alarms still change state but email nobody.
  alarm_actions           = ["arn:aws:sns:${var.region}:${var.account_id}:${var.alert_topic_name}"]
  alarm_actions_us_east_1 = ["arn:aws:sns:us-east-1:${var.account_id}:${var.alert_topic_name}"]
  instance                = { InstanceId = var.instance_id }
}

# --- Logs ------------------------------------------------------------------------------------------------------------

# compose.prod.yml's awslogs driver writes here; the host role may write to these and create none (modules/iam).
# Declined on purpose: AWS-0017, a customer-managed key ($1 a month, ADR-011); CloudWatch encrypts logs at rest anyway.
#trivy:ignore:AWS-0017
resource "aws_cloudwatch_log_group" "service" {
  for_each          = local.services
  name              = "${var.log_group_prefix}/${each.key}"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_metric_filter" "line" {
  for_each       = local.line_metrics
  name           = each.key
  log_group_name = aws_cloudwatch_log_group.service[each.value.service].name
  # The comparison also skips a line without the field: p95Ms in a window with no requests, the queue totals when the
  # database did not answer. A gap, never a false zero.
  pattern = "{ $.msg = \"${local.metrics_message}\" && $.${each.value.field} >= 0 }"

  metric_transformation {
    name      = each.key
    namespace = var.namespace
    value     = "$.${each.value.field}"
  }
}

resource "aws_cloudwatch_log_metric_filter" "dead_letters" {
  name           = "DeadLetters"
  log_group_name = aws_cloudwatch_log_group.service["worker"].name
  pattern        = "{ $.msg = \"${local.dead_letter_message}\" }"

  metric_transformation {
    name      = "DeadLetters"
    namespace = var.namespace
    value     = "1"
  }
}

# --- Alarms ----------------------------------------------------------------------------------------------------------
# Each one emails when it fires and again when it recovers. Missing data is never a breach: a quiet hour has no
# lines, and the host being down is the status check's and CloudFront's to say.

resource "aws_cloudwatch_metric_alarm" "api_5xx_rate" {
  alarm_name          = "${var.name}-api-5xx-rate"
  alarm_description   = "More than 2% of API requests answered 5xx over five minutes (docs/DEPLOYMENT.md \"Alarms\")."
  comparison_operator = "GreaterThanThreshold"
  threshold           = 2
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  metric_query {
    id          = "rate"
    expression  = "IF(requests > 0, 100 * errors / requests, 0)"
    label       = "API 5xx %"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      namespace   = var.namespace
      metric_name = "Api5xx"
      period      = 300
      stat        = "Sum"
    }
  }

  metric_query {
    id = "requests"
    metric {
      namespace   = var.namespace
      metric_name = "ApiRequests"
      period      = 300
      stat        = "Sum"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "api_p95" {
  alarm_name          = "${var.name}-api-p95"
  alarm_description   = "The API's p95 above 1 s for ten minutes."
  namespace           = var.namespace
  metric_name         = "ApiP95Ms"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = 1000
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "dead_letter" {
  alarm_name          = "${var.name}-dead-letter"
  alarm_description   = "A job was dead-lettered (docs/JOBS.md \"Runbook\")."
  namespace           = var.namespace
  metric_name         = "DeadLetters"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "queue_age" {
  alarm_name          = "${var.name}-queue-age"
  alarm_description   = "A queued message is older than five minutes: the worker is down or behind (docs/JOBS.md \"Runbook\")."
  namespace           = var.namespace
  metric_name         = "OldestMessageAgeSec"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 300
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "host_status" {
  alarm_name          = "${var.name}-host-status"
  alarm_description   = "The host failed its status check for two minutes (auto-recovery may already be acting)."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed"
  dimensions          = local.instance
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "host_memory" {
  alarm_name          = "${var.name}-host-memory"
  alarm_description   = "The host's used memory above 85% for ten minutes (infra/host/host-metrics.sh)."
  namespace           = var.namespace
  metric_name         = "HostMemoryUsedPercent"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = 85
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "cpu_credits" {
  alarm_name          = "${var.name}-cpu-credits"
  alarm_description   = "Fewer than 30 CPU credits left: with standard credits an empty balance throttles the host."
  namespace           = "AWS/EC2"
  metric_name         = "CPUCreditBalance"
  dimensions          = local.instance
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "LessThanThreshold"
  threshold           = 30
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# CloudFront's own view: it sees the host or the API being down, which the API's own metrics cannot.
resource "aws_cloudwatch_metric_alarm" "cloudfront_5xx" {
  provider            = aws.us_east_1
  alarm_name          = "${var.name}-cloudfront-5xx"
  alarm_description   = "More than 5% of CloudFront's responses were 5xx over five minutes."
  namespace           = "AWS/CloudFront"
  metric_name         = "5xxErrorRate"
  dimensions          = { DistributionId = var.distribution_id, Region = "Global" }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 5
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions_us_east_1
  ok_actions          = local.alarm_actions_us_east_1
}

# ACM renews a DNS-validated certificate by itself; this says when it has not.
resource "aws_cloudwatch_metric_alarm" "certificate_expiry" {
  count               = var.domain_live ? 1 : 0
  provider            = aws.us_east_1
  alarm_name          = "${var.name}-certificate-expiry"
  alarm_description   = "The domain's certificate expires within 21 days: renewal has failed."
  namespace           = "AWS/CertificateManager"
  metric_name         = "DaysToExpiry"
  dimensions          = { CertificateArn = var.certificate_arn }
  statistic           = "Minimum"
  period              = 86400
  evaluation_periods  = 1
  comparison_operator = "LessThanThreshold"
  threshold           = 21
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions_us_east_1
  ok_actions          = local.alarm_actions_us_east_1
}

# --- The dashboard and the saved queries -----------------------------------------------------------------------------

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = var.name
  dashboard_body = jsonencode({
    widgets = [
      for i, widget in [
        { title = "API requests and 5xx", region = var.region, stat = "Sum", metrics = [
          [var.namespace, "ApiRequests"], [var.namespace, "Api5xx"],
        ] },
        { title = "API p95 (ms)", region = var.region, stat = "Maximum", metrics = [[var.namespace, "ApiP95Ms"]] },
        { title = "Queue depth, oldest message (s), dead letters", region = var.region, stat = "Maximum", metrics = [
          [var.namespace, "QueueDepth"], [var.namespace, "OldestMessageAgeSec"], [var.namespace, "DeadLetters", { stat = "Sum" }],
        ] },
        { title = "Host memory and swap used (%)", region = var.region, stat = "Maximum", metrics = [
          [var.namespace, "HostMemoryUsedPercent"], [var.namespace, "HostSwapUsedPercent"],
        ] },
        { title = "Host CPU (%) and credit balance", region = var.region, stat = "Average", metrics = [
          ["AWS/EC2", "CPUUtilization", "InstanceId", var.instance_id],
          ["AWS/EC2", "CPUCreditBalance", "InstanceId", var.instance_id, { yAxis = "right" }],
        ] },
        { title = "CloudFront requests and 5xx (%)", region = "us-east-1", stat = "Sum", metrics = [
          ["AWS/CloudFront", "Requests", "DistributionId", var.distribution_id, "Region", "Global"],
          ["AWS/CloudFront", "5xxErrorRate", "DistributionId", var.distribution_id, "Region", "Global", { stat = "Average", yAxis = "right" }],
        ] },
        ] : {
        type       = "metric"
        x          = (i % 2) * 12
        y          = floor(i / 2) * 6
        width      = 12
        height     = 6
        properties = merge(widget, { view = "timeSeries", period = 300 })
      }
    ]
  })
}

locals {
  queries = {
    "errors-by-code" = {
      groups = ["api"]
      query  = <<-EOT
        fields @timestamp, status, code, route, msg
        | filter level >= 40
        | stats count(*) as n by status, code, route
        | sort n desc
      EOT
    }
    # Successful reads are logged at debug, below production's level: this ranks writes and failed requests.
    "slowest-routes" = {
      groups = ["api"]
      query  = <<-EOT
        filter ispresent(responseTime)
        | stats pct(responseTime, 95) as p95, count(*) as n by req.method, req.url
        | sort p95 desc
        | limit 25
      EOT
    }
    # Replace REQUEST_ID: the API's access line carries it as req.id, a job's lines as requestId.
    "one-request" = {
      groups = ["api", "worker"]
      query  = <<-EOT
        fields @timestamp, @log, level, msg
        | filter req.id = "REQUEST_ID" or requestId = "REQUEST_ID"
        | sort @timestamp asc
      EOT
    }
    "dead-letters" = {
      groups = ["worker"]
      query  = <<-EOT
        fields @timestamp, queue, eventType, eventId, requestId, attempt, err.message
        | filter msg = "${local.dead_letter_message}"
        | sort @timestamp desc
      EOT
    }
  }
}

resource "aws_cloudwatch_query_definition" "this" {
  for_each        = local.queries
  name            = "${var.name}/${each.key}"
  log_group_names = [for service in each.value.groups : aws_cloudwatch_log_group.service[service].name]
  query_string    = each.value.query
}
