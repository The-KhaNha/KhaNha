# Production's root: the shared modules (../../modules/*) with production's names. The staging root passes its own.

locals {
  name        = "khanha-production"
  environment = "production"
  domain      = "khanha.in" # D3
  # The customer, staff and admin hosts, in that order (D3, PR 05b).
  hosts = [local.domain, "staff.${local.domain}", "admin.${local.domain}"]
  # The release parameter the deploy role writes sits under this path (bootstrap/main.tf).
  parameter_path = "/khanha/${local.environment}"
  secret_name    = "khanha/${local.environment}/app"
  # Created by modules/media in PR 05; ends in the account ID because bucket names are global.
  media_bucket = "khanha-media-${local.environment}-${var.account_id}"
  # The log groups' prefix and the custom metrics' namespace (modules/observability); host-metrics.sh derives the
  # namespace from the environment the same way.
  log_group_prefix  = "/khanha/${local.environment}"
  metrics_namespace = "KhaNha/${local.environment}"
}

module "network" {
  source = "../../modules/network"
  name   = local.name
}

module "ecr" {
  source = "../../modules/ecr"
  # The bootstrap's deploy role pushes to repository/khanha/*; staging's get khanha/staging/* (P8 plan, Later).
  repositories = ["khanha/web", "khanha/server"]
}

module "iam" {
  source            = "../../modules/iam"
  name              = "${local.name}-host"
  account_id        = var.account_id
  region            = var.region
  repository_arns   = module.ecr.repository_arns
  parameter_path    = local.parameter_path
  secret_name       = local.secret_name
  log_group_prefix  = local.log_group_prefix
  metrics_namespace = local.metrics_namespace
  media_bucket      = local.media_bucket
}

module "secrets" {
  source         = "../../modules/secrets"
  parameter_path = local.parameter_path
  secret_name    = local.secret_name
  parameters = {
    APP_ENV = local.environment
    # Empty until the production Supabase project exists (a one-line PR then); an empty setting creates nothing.
    SUPABASE_URL             = var.supabase_url
    SUPABASE_PUBLISHABLE_KEY = var.supabase_publishable_key
    # The three hosts (D3, PR 05b): each is its own origin with its own sign-in, so CORS allows each.
    CLIENT_ORIGIN = join(",", [for host in local.hosts : "https://${host}"])
    # The web image hands these to the client (runtime-env.js), which picks the section by host.
    CUSTOMER_HOST = local.hosts[0]
    STAFF_HOST    = local.hosts[1]
    ADMIN_HOST    = local.hosts[2]
    # CloudFront, then the web container's nginx. Measured, not assumed, once CloudFront is in front (PR 05).
    TRUST_PROXY_HOPS = "2"
    LOG_LEVEL        = "info"
    MEDIA_BUCKET     = local.media_bucket
    AWS_REGION       = var.region
    # Where the browser posts the presigned upload form (the web image's CSP connect-src).
    MEDIA_UPLOAD_ORIGIN = "https://${module.media.regional_domain_name}"
  }
}

module "media" {
  source = "../../modules/media"
  bucket = local.media_bucket
  # The app's hosts (D3), plus CloudFront's own hostname for the dark period before domain_live.
  upload_origins = concat(
    [for host in local.hosts : "https://${host}"],
    ["https://${module.cdn.domain_name}"],
  )
}

module "cdn" {
  source = "../../modules/cdn"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
  name                       = local.name
  domain                     = local.domain
  domain_live                = var.domain_live
  vpc_id                     = module.network.vpc_id
  instance_arn               = module.compute.instance_arn
  instance_private_dns       = module.compute.private_dns
  host_security_group_id     = module.network.host_security_group_id
  media_bucket               = module.media.bucket
  media_bucket_arn           = module.media.arn
  media_regional_domain_name = module.media.regional_domain_name
}

module "compute" {
  source                = "../../modules/compute"
  name                  = local.name
  environment           = local.environment
  subnet_id             = module.network.public_subnet_ids[0]
  security_group_ids    = [module.network.host_security_group_id]
  instance_profile_name = module.iam.instance_profile_name
  # <account>.dkr.ecr.<region>.amazonaws.com/khanha, from the repositories themselves.
  image_prefix = dirname(module.ecr.repository_urls["khanha/web"])
  # The bootstrap's deploy role may run this document and no other.
  deploy_document_name = "khanha-deploy"
  host_dir             = "${path.module}/../../../host"
}

module "observability" {
  source = "../../modules/observability"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
  name             = local.name
  region           = var.region
  log_group_prefix = local.log_group_prefix
  namespace        = local.metrics_namespace
  instance_id      = module.compute.instance_id
  distribution_id  = module.cdn.distribution_id
  domain_live      = var.domain_live
  certificate_arn  = module.cdn.certificate_arn
}
