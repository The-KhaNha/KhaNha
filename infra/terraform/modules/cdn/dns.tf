# The domain, in two applies (the user, 19 November 2026). With domain_live false: only the zone, whose four name
# servers the user sets at the registrar. With domain_live true (a one-line PR once they answer): the certificate,
# validated through the zone, and the four hosts pointed at the distribution. A certificate requested before the
# delegation would fail validation after 72 hours, so it is not requested early.

locals {
  hosts = [var.domain, "www.${var.domain}", "staff.${var.domain}", "admin.${var.domain}"]
  validation = var.domain_live ? {
    for option in aws_acm_certificate.this[0].domain_validation_options : option.domain_name => option
  } : {}
}

resource "aws_route53_zone" "this" {
  name = var.domain
}

# CloudFront takes certificates from us-east-1 only.
resource "aws_acm_certificate" "this" {
  count    = var.domain_live ? 1 : 0
  provider = aws.us_east_1

  domain_name               = var.domain
  subject_alternative_names = slice(local.hosts, 1, length(local.hosts))
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Keyed by host, which is known when planning; the certificate's validation options are only known after it exists.
resource "aws_route53_record" "validation" {
  for_each = var.domain_live ? toset(local.hosts) : toset([])

  zone_id         = aws_route53_zone.this.zone_id
  name            = local.validation[each.key].resource_record_name
  type            = local.validation[each.key].resource_record_type
  records         = [local.validation[each.key].resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  count    = var.domain_live ? 1 : 0
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.this[0].arn
  validation_record_fqdns = [for record in aws_route53_record.validation : record.fqdn]
}

resource "aws_route53_record" "alias" {
  for_each = var.domain_live ? toset(flatten([for host in local.hosts : ["${host}/A", "${host}/AAAA"]])) : toset([])

  zone_id = aws_route53_zone.this.zone_id
  name    = split("/", each.key)[0]
  type    = split("/", each.key)[1]

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}
