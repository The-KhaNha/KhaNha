# /api/* is never cached (a cached API answer could hand one user's data to another), /media/* comes from the bucket,
# and the domain stays detached, with no certificate requested, until domain_live. Mocked provider, no AWS.

mock_provider "aws" {
  # A mocked ARN is a random string, which the distribution refuses.
  mock_resource "aws_cloudfront_function" {
    defaults = { arn = "arn:aws:cloudfront::123456789012:function/test" }
  }
}

mock_provider "aws" {
  alias = "us_east_1"
  # The validation records read one option per host.
  mock_resource "aws_acm_certificate" {
    defaults = {
      arn = "arn:aws:acm:us-east-1:123456789012:certificate/test"
      domain_validation_options = [
        for host in ["example.test", "www.example.test", "staff.example.test", "admin.example.test"] :
        { domain_name = host, resource_record_name = "_x.${host}.", resource_record_type = "CNAME", resource_record_value = "_y.acm-validations.aws." }
      ]
    }
  }
}

variables {
  name                       = "khanha-test"
  domain                     = "example.test"
  vpc_id                     = "vpc-0123456789abcdef0"
  instance_arn               = "arn:aws:ec2:ap-south-1:123456789012:instance/i-0123456789abcdef0"
  instance_private_dns       = "ip-10-0-0-10.ap-south-1.compute.internal"
  host_security_group_id     = "sg-0123456789abcdef0"
  media_bucket               = "khanha-media-test-123456789012"
  media_bucket_arn           = "arn:aws:s3:::khanha-media-test-123456789012"
  media_regional_domain_name = "khanha-media-test-123456789012.s3.ap-south-1.amazonaws.com"
}

run "api_is_never_cached_and_media_comes_from_the_bucket" {
  command = apply

  assert {
    condition = alltrue([
      for b in aws_cloudfront_distribution.this.ordered_cache_behavior :
      b.cache_policy_id == "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" if b.path_pattern == "/api/*"
    ]) && length([for b in aws_cloudfront_distribution.this.ordered_cache_behavior : b if b.path_pattern == "/api/*"]) == 1
    error_message = "/api/* must use the CachingDisabled policy."
  }

  assert {
    condition = alltrue([
      for b in aws_cloudfront_distribution.this.ordered_cache_behavior :
      b.target_origin_id == "media" if b.path_pattern == "/media/*"
    ]) && length([for b in aws_cloudfront_distribution.this.ordered_cache_behavior : b if b.path_pattern == "/media/*"]) == 1
    error_message = "/media/* must come from the media bucket."
  }

  # www. must redirect on every path, /media/ and /api/ included.
  assert {
    condition = alltrue([
      for b in concat(aws_cloudfront_distribution.this.default_cache_behavior, aws_cloudfront_distribution.this.ordered_cache_behavior) :
      length([for f in b.function_association : f if f.event_type == "viewer-request"]) == 1
    ])
    error_message = "Every behaviour needs the viewer function (the www redirect)."
  }
}

run "the_domain_stays_detached_until_domain_live" {
  command = apply

  assert {
    condition     = length(aws_cloudfront_distribution.this.aliases) == 0 && length(aws_acm_certificate.this) == 0
    error_message = "With domain_live false there are no aliases and no certificate (it would fail validation)."
  }
}

run "domain_live_attaches_the_four_hosts" {
  command = apply

  variables {
    domain_live = true
  }

  assert {
    condition     = length(aws_cloudfront_distribution.this.aliases) == 4
    error_message = "domain_live attaches the apex, www., staff. and admin."
  }
}
