# One VPC with two public subnets and no NAT gateway: a NAT gateway alone would cost more than the whole budget, so
# the host reaches the internet through its own public address (P8 plan, PR 02). No private subnets: nothing uses them
# until a load balancer returns.

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_region" "current" {}

# Flow logs would bill CloudWatch ingestion on every packet; out of the budget (ADR-011).
#trivy:ignore:AWS-0178
resource "aws_vpc" "this" {
  cidr_block           = var.cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = var.name }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = var.name }
}

# No public address by default: the instance asks for its own (PR 04), so nothing else launched here gets one.
resource "aws_subnet" "public" {
  count = 2

  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.cidr, 8, count.index)
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = { Name = "${var.name}-public-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-public" }
}

resource "aws_route" "internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  count = 2

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Free: S3 traffic (ECR's image layers, the media bucket) stays on AWS's network.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${data.aws_region.current.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public.id]

  tags = { Name = "${var.name}-s3" }
}

# The host's group. No inbound rule at all: nothing accepts SSH (Session Manager replaces it), and the one rule
# CloudFront needs is added by PR 05 with the origin form it proves (a VPC origin, or HTTPS on 443).
resource "aws_security_group" "host" {
  name        = "${var.name}-host"
  description = "The app host: inbound from CloudFront only (PR 05), outbound HTTPS"
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${var.name}-host" }
}

# Everything the host calls is HTTPS on the internet: ECR, SSM, Secrets Manager, CloudWatch, Supabase, the package
# repository. DNS and the time service are link-local and not filtered by security groups.
#trivy:ignore:AWS-0104
resource "aws_vpc_security_group_egress_rule" "https" {
  security_group_id = aws_security_group.host.id
  description       = "HTTPS to AWS APIs, Supabase and package repositories"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}
