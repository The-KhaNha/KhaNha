# Read by the later PRs' modules and by the deploy workflow. None of them is secret (plans are public).

output "vpc_id" {
  value = module.network.vpc_id
}

output "public_subnet_ids" {
  value = module.network.public_subnet_ids
}

output "host_security_group_id" {
  value = module.network.host_security_group_id
}

output "repository_urls" {
  value = module.ecr.repository_urls
}

output "instance_profile_name" {
  value = module.iam.instance_profile_name
}

output "instance_id" {
  value = module.compute.instance_id
}

output "cloudfront_domain" {
  description = "Where the app answers until domain_live."
  value       = module.cdn.domain_name
}

output "name_servers" {
  description = "Set these at the registrar of khanha.in, then set domain_live."
  value       = module.cdn.name_servers
}
