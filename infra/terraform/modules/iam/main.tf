# The host's instance role: pull its images, take Session Manager and deploy commands, write its own logs and metrics, read its own
# parameters and secret, use the media bucket. Every grant is scoped to this environment's names, so a staging host
# can never read production's secret. tests/scoping.tftest.hcl is the guard.

locals {
  arn_prefix = "arn:aws"
  ssm_arn    = "${local.arn_prefix}:ssm:${var.region}:${var.account_id}"

  policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrLogin"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid      = "EcrPull"
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
        Resource = var.repository_arns
      },
      {
        # AmazonSSMManagedInstanceCore without its parameter reads, which cover every parameter in the account.
        Sid    = "SessionManagerAndRunCommand"
        Effect = "Allow"
        Action = [
          "ec2messages:AcknowledgeMessage",
          "ec2messages:DeleteMessage",
          "ec2messages:FailMessage",
          "ec2messages:GetEndpoint",
          "ec2messages:GetMessages",
          "ec2messages:SendReply",
          "ssm:DescribeAssociation",
          "ssm:DescribeDocument",
          "ssm:GetDocument",
          "ssm:ListAssociations",
          "ssm:ListInstanceAssociations",
          "ssm:PutComplianceItems",
          "ssm:UpdateAssociationStatus",
          "ssm:UpdateInstanceAssociationStatus",
          "ssm:UpdateInstanceInformation",
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
        ]
        Resource = "*"
      },
      {
        Sid      = "OwnParameters"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
        Resource = ["${local.ssm_arn}:parameter${var.parameter_path}", "${local.ssm_arn}:parameter${var.parameter_path}/*"]
      },
      {
        # Secrets Manager appends six random characters to a secret's ARN.
        Sid      = "OwnSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = "${local.arn_prefix}:secretsmanager:${var.region}:${var.account_id}:secret:${var.secret_name}-??????"
      },
      {
        Sid      = "OwnLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${local.arn_prefix}:logs:${var.region}:${var.account_id}:log-group:${var.log_group_prefix}/*:*"
      },
      {
        # The host's memory and swap (infra/host/host-metrics.sh). PutMetricData takes no resource; the condition keeps
        # it to this environment's namespace.
        Sid       = "OwnMetrics"
        Effect    = "Allow"
        Action    = ["cloudwatch:PutMetricData"]
        Resource  = "*"
        Condition = { StringEquals = { "cloudwatch:namespace" = var.metrics_namespace } }
      },
      {
        Sid      = "MediaObjects"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:PutObjectTagging", "s3:DeleteObject"]
        Resource = "${local.arn_prefix}:s3:::${var.media_bucket}/*"
      },
      {
        # Without it a missing object reads as 403 instead of 404.
        Sid      = "MediaList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = "${local.arn_prefix}:s3:::${var.media_bucket}"
      },
    ]
  }
}

resource "aws_iam_role" "host" {
  name = var.name
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "host" {
  name   = "host"
  role   = aws_iam_role.host.id
  policy = jsonencode(local.policy)
}

resource "aws_iam_instance_profile" "host" {
  name = var.name
  role = aws_iam_role.host.name
}
