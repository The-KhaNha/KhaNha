variable "name" {
  description = "The host's Name tag, e.g. khanha-production."
  type        = string
}

variable "environment" {
  description = "production or staging: picks the host's parameters, secret and release (render-env.sh)."
  type        = string
}

variable "instance_type" {
  description = "t4g.micro (D4); t4g.small is the next size up and still fits the budget."
  type        = string
  default     = "t4g.micro"
}

variable "subnet_id" {
  type = string
}

variable "security_group_ids" {
  type = list(string)
}

variable "instance_profile_name" {
  description = "From modules/iam."
  type        = string
}

variable "image_prefix" {
  description = "<registry>/<repository prefix> the host pulls from, e.g. <account>.dkr.ecr.<region>.amazonaws.com/khanha."
  type        = string
}

variable "deploy_document_name" {
  description = "The bootstrap's deploy role may run only this document: khanha-deploy for production."
  type        = string
}

variable "host_dir" {
  description = "The folder holding compose.prod.yml, render-env.sh and apply-release.sh (infra/host)."
  type        = string
}

variable "compose_version" {
  description = "The docker compose plugin release installed at first boot."
  type        = string
  default     = "v5.7.0"
}

variable "compose_sha256" {
  description = "docker-compose-linux-aarch64's checksum from that release's .sha256 file."
  type        = string
  default     = "15861535d14e26555736b49376c95e14bfd94285366c8446bfac7156a972e76f"
}
