variable "parameter_path" {
  description = "The environment's Parameter Store path, e.g. /khanha/production (the instance role reads under it)."
  type        = string
}

variable "parameters" {
  description = "Upper-case setting name => value, written to the host's environment. Not secret: plans are public."
  type        = map(string)

  validation {
    condition     = alltrue([for name in keys(var.parameters) : can(regex("^[A-Z][A-Z0-9_]*$", name))])
    error_message = "Parameter names must be upper-case environment variable names; render-env.sh skips any other."
  }
}

variable "secret_name" {
  description = "The environment's one secret, e.g. khanha/production/app."
  type        = string
}
