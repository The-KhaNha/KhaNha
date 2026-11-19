# Production's root: the shared modules (../../modules/*) with production's names. The staging root passes its own.

locals {
  name        = "khanha-production"
  environment = "production"
  # The release parameter the deploy role writes sits under this path (bootstrap/main.tf).
  parameter_path = "/khanha/${local.environment}"
  secret_name    = "khanha/${local.environment}/app"
  # Created by modules/media in PR 05; ends in the account ID because bucket names are global.
  media_bucket = "khanha-media-${local.environment}-${var.account_id}"
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
  source           = "../../modules/iam"
  name             = "${local.name}-host"
  account_id       = var.account_id
  region           = var.region
  repository_arns  = module.ecr.repository_arns
  parameter_path   = local.parameter_path
  secret_name      = local.secret_name
  log_group_prefix = "/khanha/${local.environment}"
  media_bucket     = local.media_bucket
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
    # PR 05b turns this into the three hosts' list.
    CLIENT_ORIGIN = "https://khanha.in"
    # CloudFront, then the web container's nginx. Measured, not assumed, once CloudFront is in front (PR 05).
    TRUST_PROXY_HOPS = "2"
    LOG_LEVEL        = "info"
    MEDIA_BUCKET     = local.media_bucket
    AWS_REGION       = var.region
  }
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
