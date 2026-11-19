variable "name" {
  description = "Prefix for names, e.g. khanha-production."
  type        = string
}

variable "domain" {
  description = "The apex the app is served on (D3): the apex, www., staff. and admin. of it."
  type        = string
}

variable "domain_live" {
  description = "false until the registrar points at the zone's name servers; then true attaches the certificate and the hosts."
  type        = bool
  default     = false
}

variable "vpc_id" {
  type = string
}

variable "instance_arn" {
  description = "The host (modules/compute), CloudFront's VPC origin."
  type        = string
}

variable "instance_private_dns" {
  type = string
}

variable "host_security_group_id" {
  description = "The host's group (modules/network), which gains its one inbound rule here."
  type        = string
}

variable "media_bucket" {
  type = string
}

variable "media_bucket_arn" {
  type = string
}

variable "media_regional_domain_name" {
  type = string
}
