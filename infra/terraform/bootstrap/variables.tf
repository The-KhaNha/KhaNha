variable "alert_email" {
  description = "Receives the budget alerts. Kept in the untracked terraform.tfvars, never committed."
  type        = string
  sensitive   = true
}

variable "github_repository" {
  # The repository uses GitHub's immutable OIDC subject, which carries the owner's and repository's numeric IDs, so a
  # renamed or re-created repository of the same name can never assume the roles. The plain "owner/name" fails with
  # "Not authorized to perform sts:AssumeRoleWithWebIdentity". The value is sub_claim_prefix without its "repo:":
  # gh api repos/The-KhaNha/KhaNha/actions/oidc/customization/sub
  description = "owner@id/name@id, as in the repository's immutable OIDC subject, whose GitHub Environments may assume the roles."
  type        = string
  default     = "The-KhaNha@333735276/KhaNha@1387235288"

  validation {
    condition     = can(regex("^[^/@]+@[0-9]+/[^/@]+@[0-9]+$", var.github_repository))
    error_message = "github_repository must be owner@id/name@id (the immutable OIDC subject), not owner/name."
  }
}

variable "region" {
  description = "The region of the Supabase projects (D2)."
  type        = string
  default     = "ap-south-1"
}

variable "monthly_budget_usd" {
  description = "The ceiling the budget alerts against (ADR-011)."
  type        = number
  default     = 35
}
