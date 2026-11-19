variable "name" {
  description = "Prefix for every resource's Name tag, e.g. khanha-production."
  type        = string
}

variable "cidr" {
  description = "The VPC's address range; each subnet takes a /24 of it."
  type        = string
  default     = "10.0.0.0/16"
}
