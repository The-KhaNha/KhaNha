variable "alert_email" {
  description = "Receives the budget alerts. Kept in the untracked terraform.tfvars, never committed."
  type        = string
  sensitive   = true
}

variable "github_repository" {
  description = "owner/name of the repository whose GitHub Environments may assume the roles."
  type        = string
  default     = "The-KhaNha/KhaNha"
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
