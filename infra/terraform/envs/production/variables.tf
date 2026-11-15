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
