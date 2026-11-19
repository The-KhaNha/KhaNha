variable "name" {
  description = "Prefix for every resource's Name tag, e.g. khanha-production."
  type        = string
}

variable "cidr" {
  description = "The VPC's address range; each subnet takes a /24 of it."
  type        = string
  default     = "10.0.0.0/16"

  validation {
    condition     = can(cidrhost(var.cidr, 0)) && can(regex("/(1[6-9]|2[0-3])$", var.cidr))
    error_message = "cidr must be a valid IPv4 range between /16 and /23 so two /24 subnets fit."
  }
}
