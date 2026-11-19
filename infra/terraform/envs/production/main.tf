# Production's root: the shared modules (../../modules/*) with production's names. The staging root passes its own.

locals {
  name        = "khanha-production"
  environment = "production"
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
  source          = "../../modules/iam"
  name            = "${local.name}-host"
  account_id      = var.account_id
  region          = var.region
  repository_arns = module.ecr.repository_arns
  # The release parameter the deploy role writes sits under this path (bootstrap/main.tf).
  parameter_path   = "/khanha/${local.environment}"
  secret_name      = "khanha/${local.environment}/app"
  log_group_prefix = "/khanha/${local.environment}"
  # Created by modules/media in PR 05; ends in the account ID because bucket names are global.
  media_bucket = "khanha-media-${local.environment}-${var.account_id}"
}
