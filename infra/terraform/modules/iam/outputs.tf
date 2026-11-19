output "instance_profile_name" {
  value = aws_iam_instance_profile.host.name
}

output "role_arn" {
  value = aws_iam_role.host.arn
}
