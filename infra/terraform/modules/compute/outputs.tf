output "instance_id" {
  value = aws_instance.this.id
}

output "deploy_document_name" {
  value = aws_ssm_document.deploy.name
}
