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
  description = "The production Supabase project's URL (created 21 November 2026)."
  type        = string
  default     = "https://eysxljhpzyuzntemrojv.supabase.co"
}

variable "supabase_publishable_key" {
  description = "The production project's publishable key (public: every browser gets it)."
  type        = string
  default     = "sb_publishable_Y7EHGcTmrplcYKBD-G9T6A_IRYKT7PF"
}

variable "domain_live" {
  description = "True once the registrar of khanha.in points at the zone's four name servers (delegated 20 November 2026)."
  type        = bool
  default     = true
}
