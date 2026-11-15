terraform {
  # 1.11: S3's native lock file (use_lockfile), so state needs no DynamoDB table.
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      app        = "food-pickup"
      managed-by = "terraform-bootstrap"
    }
  }
}
