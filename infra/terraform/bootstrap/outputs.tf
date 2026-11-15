# The values the user copies into GitHub (infra/README.md "After the bootstrap"). None of them is secret.

output "state_bucket" {
  description = "Repository variable TF_STATE_BUCKET."
  value       = aws_s3_bucket.state.bucket
}

output "account_id" {
  description = "Repository variable AWS_ACCOUNT_ID."
  value       = local.account_id
}

output "role_arns" {
  description = "Each GitHub Environment's AWS_ROLE_ARN variable, keyed by Environment."
  value       = { for key, environment in local.roles : environment => aws_iam_role.github[key].arn }
}
