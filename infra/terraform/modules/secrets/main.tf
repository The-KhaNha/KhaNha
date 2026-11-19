# The environment's configuration for the host (render-env.sh reads both): one String parameter per setting, and the
# container of the one secret. Terraform never holds the secret's value: the user sets it in the console
# (infra/README.md "Changing a secret"), and until then a deploy fails at render-env.sh instead of starting on a
# placeholder.

resource "aws_ssm_parameter" "this" {
  # A setting with no value yet (production's Supabase project before it exists) is simply not created.
  for_each = { for name, value in var.parameters : name => value if value != "" }

  name  = "${var.parameter_path}/${each.key}"
  type  = "String"
  value = each.value
}

# AWS-managed encryption: a customer-managed key would add $1 a month (ADR-011).
#trivy:ignore:AWS-0098
resource "aws_secretsmanager_secret" "app" {
  name                    = var.secret_name
  description             = "The app's secret keys as one JSON object, e.g. {\"SUPABASE_SECRET_KEY\": \"sb_secret_...\"}"
  recovery_window_in_days = 7
}
