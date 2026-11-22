output "domain_name" {
  description = "CloudFront's own hostname: where the app answers until domain_live."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "name_servers" {
  description = "Set these four at the registrar of the domain, then set domain_live."
  value       = aws_route53_zone.this.name_servers
}

output "distribution_id" {
  description = "For the CloudFront alarms (modules/observability)."
  value       = aws_cloudfront_distribution.this.id
}

output "certificate_arn" {
  description = "The domain's certificate, for the expiry alarm; null until domain_live."
  value       = one(aws_acm_certificate.this[*].arn)
}
