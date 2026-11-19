# The edge (ADR-006, ADR-007 as amended): one distribution in front of the host and the media bucket. The host is a
# CloudFront VPC origin, so CloudFront reaches it inside the VPC and nothing on the internet can; /api/* is never
# cached; /media/* comes from the bucket, cached a year (its variants are immutable).

# --- The host ---------------------------------------------------------------------------------------------------

resource "aws_cloudfront_vpc_origin" "host" {
  vpc_origin_endpoint_config {
    name                   = var.name
    arn                    = var.instance_arn
    http_port              = 80
    https_port             = 443
    origin_protocol_policy = "http-only" # inside the VPC, from CloudFront's own interface
    origin_ssl_protocols {
      items    = ["TLSv1.2"]
      quantity = 1
    }
  }
}

# AWS creates this group for the VPC origin's interfaces. Admitting it, not CloudFront's public address range, means
# no other distribution can reach the host's public address.
data "aws_security_group" "vpc_origin" {
  filter {
    name   = "group-name"
    values = ["CloudFront-VPCOrigins-Service-SG"]
  }
  filter {
    name   = "vpc-id"
    values = [var.vpc_id]
  }
  depends_on = [aws_cloudfront_vpc_origin.host]
}

resource "aws_vpc_security_group_ingress_rule" "from_cloudfront" {
  security_group_id            = var.host_security_group_id
  description                  = "CloudFront VPC origin to the web container"
  ip_protocol                  = "tcp"
  from_port                    = 80
  to_port                      = 80
  referenced_security_group_id = data.aws_security_group.vpc_origin.id
}

# --- The media bucket -------------------------------------------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "media" {
  name                              = "${var.name}-media"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_s3_bucket_policy" "media" {
  bucket = var.media_bucket
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "CloudFrontReads"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${var.media_bucket_arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.this.arn } }
    }]
  })
}

# --- Functions (free inside CloudFront's allowance) -------------------------------------------------------------

# www.<domain> answers a 301 to the apex, same path and query.
resource "aws_cloudfront_function" "www" {
  name    = "${var.name}-www"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-JS
    function handler(event) {
      var request = event.request;
      if (request.headers.host && request.headers.host.value === 'www.${var.domain}') {
        var query = Object.keys(request.querystring).map(function (k) {
          var v = request.querystring[k];
          return v.value === '' ? k : k + '=' + v.value;
        }).join('&');
        return {
          statusCode: 301,
          statusDescription: 'Moved Permanently',
          headers: { location: { value: 'https://${var.domain}' + request.uri + (query ? '?' + query : '') } },
        };
      }
      return request;
    }
  JS
}

# The bucket's keys are stores/...; the app asks for /media/stores/....
resource "aws_cloudfront_function" "media" {
  name    = "${var.name}-media"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-JS
    function handler(event) {
      var request = event.request;
      request.uri = request.uri.replace(/^\/media\//, '/');
      return request;
    }
  JS
}

# --- The distribution -------------------------------------------------------------------------------------------

# AWS's managed policies, by their fixed IDs (CloudFront Developer Guide, "Use managed cache/origin request policies").
locals {
  cache_origin_headers = "83da9c7e-98b4-4e11-a168-04f0df8e2c65" # Managed-UseOriginCacheControlHeaders
  cache_disabled       = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled
  cache_optimized      = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized
  request_all_viewer   = "216adef6-5c7f-47e4-b989-5492eafa07d3" # Managed-AllViewer
}

# TLSv1 only while on CloudFront's default certificate, which fixes it anyway (viewer_certificate below).
# Access logs and the WAF (about $5 a month and up) are out of the budget (P8 plan; WAF in P9.3).
#trivy:ignore:AWS-0010
#trivy:ignore:AWS-0011
resource "aws_cloudfront_distribution" "this" { # nosemgrep: terraform.aws.security.aws-cloudfront-insecure-tls.aws-insecure-cloudfront-distribution-tls-version
  enabled         = true
  comment         = var.name
  http_version    = "http2and3"
  is_ipv6_enabled = true
  price_class     = "PriceClass_200" # includes India; PriceClass_100 is North America and Europe only
  aliases         = var.domain_live ? local.hosts : []

  origin {
    origin_id   = "host"
    domain_name = var.instance_private_dns
    vpc_origin_config {
      vpc_origin_id = aws_cloudfront_vpc_origin.host.id
    }
  }

  origin {
    origin_id                = "media"
    domain_name              = var.media_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.media.id
  }

  # The app: nginx's own Cache-Control decides (index.html uncached, /assets/ immutable).
  default_cache_behavior {
    target_origin_id         = "host"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = local.cache_origin_headers
    origin_request_policy_id = local.request_all_viewer
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.www.arn
    }
  }

  # Never cached: Authorization and every query string reach the API (tests/behaviours.tftest.hcl).
  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "host"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = local.cache_disabled
    origin_request_policy_id = local.request_all_viewer
  }

  ordered_cache_behavior {
    path_pattern           = "/media/*"
    target_origin_id       = "media"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = local.cache_optimized
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.media.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # CloudFront's own certificate until the domain is delegated (domain_live, dns.tf).
  viewer_certificate {
    cloudfront_default_certificate = !var.domain_live
    acm_certificate_arn            = var.domain_live ? aws_acm_certificate_validation.this[0].certificate_arn : null
    ssl_support_method             = var.domain_live ? "sni-only" : null
    # With CloudFront's default certificate AWS fixes the policy at TLSv1 whatever is set; only until domain_live.
    minimum_protocol_version = var.domain_live ? "TLSv1.2_2021" : "TLSv1"
  }
}
