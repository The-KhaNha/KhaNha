# The roles trust the repository's immutable OIDC subject (owner@id/name@id). The plain owner/name form is refused at
# plan time, instead of failing every workflow with "Not authorized to perform sts:AssumeRoleWithWebIdentity".

mock_provider "aws" {
  # A mocked document's json is a random string, which the role resources refuse as a policy.
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{}" }
  }
}

variables {
  alert_email = "alerts@example.com"
}

run "the_default_plans" {
  command = plan
}

run "owner_slash_name_is_refused" {
  command = plan

  variables {
    github_repository = "The-KhaNha/KhaNha"
  }

  expect_failures = [var.github_repository]
}
