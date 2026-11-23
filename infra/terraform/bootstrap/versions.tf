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
      app        = "khanha"
      managed-by = "terraform-bootstrap"
    }
  }
}

# CloudFront's and ACM's metrics live in us-east-1, so their alarms and the topic they notify do too.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      app        = "khanha"
      managed-by = "terraform-bootstrap"
    }
  }
}
