variable "account_id" {
  description = "The AWS account production lives in (the AWS_ACCOUNT_ID repository variable in CI)."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must be a 12-digit AWS account ID."
  }
}

variable "region" {
  description = "The region of the Supabase projects (D2)."
  type        = string
  default     = "ap-south-1"
}

# Public values (they reach every browser), so they live here rather than in a secret.
variable "supabase_url" {
  description = "The production Supabase project's URL, https://<ref>.supabase.co. Empty until the project exists."
  type        = string
  default     = ""
}

variable "supabase_publishable_key" {
  description = "The production project's publishable key (sb_publishable_...). Empty until the project exists."
  type        = string
  default     = ""
}
