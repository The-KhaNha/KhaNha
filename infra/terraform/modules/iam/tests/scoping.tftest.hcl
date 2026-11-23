# The instance role reads only its own environment's parameters, secret, logs and media, and publishes metrics only to
# its own namespace: nothing that reads data is
# granted on "*" (AmazonSSMManagedInstanceCore does that for every parameter in the account), and a staging role
# names nothing of production's. Runs in ci.yml's infra job, no AWS needed.

mock_provider "aws" {}

variables {
  name              = "khanha-staging-host"
  account_id        = "123456789012"
  region            = "ap-south-1"
  repository_arns   = ["arn:aws:ecr:ap-south-1:123456789012:repository/khanha/staging/web"]
  parameter_path    = "/khanha/staging"
  secret_name       = "khanha/staging/app"
  log_group_prefix  = "/khanha/staging"
  metrics_namespace = "KhaNha/staging"
  media_bucket      = "khanha-media-staging-123456789012"
}

run "nothing_that_reads_data_is_granted_on_everything" {
  command = plan

  assert {
    condition = alltrue([
      for statement in jsondecode(aws_iam_role_policy.host.policy).Statement :
      !contains(flatten([statement.Resource]), "*") || alltrue([
        for action in statement.Action :
        length(regexall("^(ssm:GetParameter|secretsmanager:|s3:|logs:|kms:)", action)) == 0
      ])
    ])
    error_message = "A data-reading action is granted on \"*\": scope it to this environment's names."
  }
}

run "a_staging_role_names_nothing_of_production" {
  command = plan

  assert {
    condition     = length(regexall("production", aws_iam_role_policy.host.policy)) == 0
    error_message = "The staging role's policy names production: a name is hard-coded in the module."
  }
}

run "metrics_go_to_the_environments_namespace_only" {
  command = plan

  assert {
    condition = alltrue([
      for statement in jsondecode(aws_iam_role_policy.host.policy).Statement :
      try(statement.Condition.StringEquals["cloudwatch:namespace"], "") == "KhaNha/staging"
      if length([for action in flatten([statement.Action]) : action if startswith(action, "cloudwatch:")]) > 0
    ])
    error_message = "A CloudWatch grant is not held to the environment's namespace: any metric could be forged."
  }
}
