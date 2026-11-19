output "instance_id" {
  value = aws_instance.this.id
}

output "deploy_document_name" {
  value = aws_ssm_document.deploy.name
}

output "instance_arn" {
  value = aws_instance.this.arn
}

output "private_dns" {
  value = aws_instance.this.private_dns
}
