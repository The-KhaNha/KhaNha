# The alarms plan without the bootstrap having been applied (their topics are named, not looked up) and each one
# emails on firing and on recovery, in its own region. Runs in ci.yml's infra job, no AWS needed.

mock_provider "aws" {}

mock_provider "aws" {
  alias = "us_east_1"
}

variables {
  name             = "khanha-staging"
  account_id       = "123456789012"
  region           = "ap-south-1"
  log_group_prefix = "/khanha/staging"
  namespace        = "KhaNha/staging"
  instance_id      = "i-0123456789abcdef0"
  distribution_id  = "E123EXAMPLE"
  domain_live      = true
  certificate_arn  = "arn:aws:acm:us-east-1:123456789012:certificate/example"
}

run "each_alarm_notifies_its_own_regions_topic_on_firing_and_recovery" {
  command = plan

  assert {
    condition = alltrue([
      for alarm in [
        aws_cloudwatch_metric_alarm.api_5xx_rate, aws_cloudwatch_metric_alarm.api_p95,
        aws_cloudwatch_metric_alarm.dead_letter, aws_cloudwatch_metric_alarm.queue_age,
        aws_cloudwatch_metric_alarm.host_status, aws_cloudwatch_metric_alarm.host_memory,
        aws_cloudwatch_metric_alarm.cpu_credits,
      ] : alarm.alarm_actions == toset(["arn:aws:sns:ap-south-1:123456789012:khanha-alerts"]) && alarm.ok_actions == alarm.alarm_actions
    ])
    error_message = "A regional alarm does not email the ap-south-1 topic on both firing and recovery."
  }

  assert {
    condition = alltrue([
      for alarm in [aws_cloudwatch_metric_alarm.cloudfront_5xx, aws_cloudwatch_metric_alarm.certificate_expiry[0]] :
      alarm.alarm_actions == toset(["arn:aws:sns:us-east-1:123456789012:khanha-alerts"]) && alarm.ok_actions == alarm.alarm_actions
    ])
    error_message = "A us-east-1 alarm does not email the us-east-1 topic on both firing and recovery."
  }
}

run "no_certificate_alarm_before_the_domain_is_live" {
  command = plan

  variables {
    domain_live     = false
    certificate_arn = null
  }

  assert {
    condition     = length(aws_cloudwatch_metric_alarm.certificate_expiry) == 0
    error_message = "The certificate alarm exists before the certificate does."
  }
}
