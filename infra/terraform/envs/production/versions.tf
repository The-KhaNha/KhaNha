terraform {
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # The bucket comes from the bootstrap's output, passed as -backend-config=bucket=... (the TF_STATE_BUCKET
  # variable in CI), so no account-specific name is written here.
  backend "s3" {
    key          = "production/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region
  # Refuses to plan or apply against any other account: the credentials could belong to the wrong one.
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = {
      app        = "khanha"
      env        = "production"
      managed-by = "terraform"
    }
  }
}

# CloudFront's certificate lives in us-east-1 (modules/cdn).
provider "aws" {
  alias               = "us_east_1"
  region              = "us-east-1"
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = {
      app        = "khanha"
      env        = "production"
      managed-by = "terraform"
    }
  }
}
