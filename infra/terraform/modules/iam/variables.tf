variable "name" {
  description = "The role's and instance profile's name, e.g. khanha-production-host."
  type        = string
}

variable "account_id" {
  type = string
}

variable "region" {
  type = string
}

variable "repository_arns" {
  description = "The ECR repositories the host pulls from (modules/ecr)."
  type        = list(string)
}

variable "parameter_path" {
  description = "The environment's Parameter Store path, e.g. /khanha/production (no trailing slash)."
  type        = string

  validation {
    condition     = can(regex("^/[a-z0-9-]+(/[a-z0-9-]+)+$", var.parameter_path))
    error_message = "parameter_path must start with / and name at least the app and the environment, with no trailing slash."
  }
}

variable "secret_name" {
  description = "The environment's one secret, e.g. khanha/production/app."
  type        = string
}

variable "log_group_prefix" {
  description = "The prefix of the environment's log groups, e.g. /khanha/production."
  type        = string
}

variable "media_bucket" {
  description = "The media bucket's name (created by modules/media in PR 05)."
  type        = string
}

variable "metrics_namespace" {
  description = "The only CloudWatch namespace the host may publish to, e.g. KhaNha/production."
  type        = string
}
