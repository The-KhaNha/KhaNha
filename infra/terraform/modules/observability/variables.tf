variable "name" {
  description = "The prefix of the alarms, the dashboard and the saved queries, e.g. khanha-production."
  type        = string
}

variable "account_id" {
  type = string
}

variable "region" {
  description = "Where the host and its logs are (CloudFront's and ACM's metrics are always in us-east-1)."
  type        = string
}

variable "log_group_prefix" {
  description = "The log groups are <prefix>/api, /web and /worker; the same prefix the host role may write under."
  type        = string
}

variable "namespace" {
  description = "The custom metrics' namespace, KhaNha/<environment>; the host role may publish to it and no other."
  type        = string
}

variable "alert_topic_name" {
  description = "The SNS topic the bootstrap created in both regions; it holds the alert address."
  type        = string
  default     = "khanha-alerts"
}

variable "instance_id" {
  type = string
}

variable "distribution_id" {
  type = string
}

variable "domain_live" {
  description = "The certificate exists only once the domain is live (modules/cdn)."
  type        = bool
}

variable "certificate_arn" {
  description = "The domain's certificate; null until domain_live."
  type        = string
  default     = null
}
