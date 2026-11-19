# The media bucket (ADR-006): private, versioned, read only by CloudFront (modules/cdn writes that policy), written by
# the host's role and by browsers through the API's presigned form (hence CORS for the app's origins).

# Access logs and a customer-managed key are out of the budget (ADR-011); CloudFront is the only reader.
#trivy:ignore:AWS-0089
resource "aws_s3_bucket" "this" {
  bucket = var.bucket
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket                  = aws_s3_bucket.this.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id
  versioning_configuration {
    status = "Enabled"
  }
}

#trivy:ignore:AWS-0132
resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  # The backstop for P3's sweep: an original the API's upload form tagged stage=original, never processed or swept.
  # (Originals sit at stores/<store>/uploads/, which a prefix filter cannot match.)
  rule {
    id     = "unprocessed-originals"
    status = "Enabled"
    filter {
      tag {
        key   = "stage"
        value = "original"
      }
    }
    expiration {
      days = 1
    }
  }

  rule {
    id     = "old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  depends_on = [aws_s3_bucket_versioning.this]
}

# The browser posts the presigned form straight to the bucket from the app's pages.
resource "aws_s3_bucket_cors_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  cors_rule {
    allowed_methods = ["POST"]
    allowed_origins = var.upload_origins
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}
