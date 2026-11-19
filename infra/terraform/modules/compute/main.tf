# One host (ADR-007 as amended): Amazon Linux 2023 on arm64, docker and compose, nothing built on it. Its inputs and
# outputs are what an Auto Scaling group would take, so that swap stays inside this module when funding brings it.

data "aws_ssm_parameter" "ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

# The public address is for outbound traffic only (a NAT gateway would cost more than the whole budget); the security
# group admits nothing inbound but CloudFront (PR 05).
resource "aws_instance" "this" { # nosemgrep: terraform.aws.security.aws-ec2-has-public-ip.aws-ec2-has-public-ip
  ami                         = data.aws_ssm_parameter.ami.insecure_value
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = var.security_group_ids
  iam_instance_profile        = var.instance_profile_name
  associate_public_ip_address = true # outbound only: no NAT gateway (modules/network)
  user_data = templatefile("${path.module}/user-data.sh", {
    compose_version = var.compose_version
    compose_sha256  = var.compose_sha256
  })

  # T4g defaults to "unlimited", which bills sustained bursts; standard slows down instead (tests/credit.tftest.hcl).
  credit_specification {
    cpu_credits = "standard"
  }

  # IMDSv2 only. Two hops, so the containers (one bridge away) get the role's credentials for the media bucket.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  maintenance_options {
    auto_recovery = "default"
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = 16
    encrypted   = true
  }

  tags = { Name = var.name }

  # A newer AMI or boot script reaches the host when it is replaced (terraform apply -replace, infra/README.md), not
  # on every plan: the release parameter brings the app back on the new host by itself.
  lifecycle {
    ignore_changes = [ami, user_data]
  }
}

locals {
  host_files = ["compose.prod.yml", "render-env.sh", "apply-release.sh"]

  # The host files travel inside the document, so changing them changes the document, not the machine.
  commands = concat(
    [
      "cloud-init status --wait > /dev/null",
      "install -d -m 700 /opt/khanha",
    ],
    [for file in local.host_files : "echo ${base64encode(file("${var.host_dir}/${file}"))} | base64 -d > /opt/khanha/${file}"],
    [
      "chmod 700 /opt/khanha/*.sh",
      "/opt/khanha/apply-release.sh ${var.environment} ${var.image_prefix} '{{ webTag }}' '{{ serverTag }}'",
    ],
  )
}

# Run by the deploy workflow with candidate tags (PR 07), and once on a new host with none (below).
resource "aws_ssm_document" "deploy" {
  name            = var.deploy_document_name
  document_type   = "Command"
  document_format = "JSON"
  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Write the host files, then apply-release.sh: the candidate tags, or with none the release parameter's."
    parameters = {
      webTag    = { type = "String", default = "", allowedPattern = "^[A-Za-z0-9._-]{0,128}$" }
      serverTag = { type = "String", default = "", allowedPattern = "^[A-Za-z0-9._-]{0,128}$" }
    }
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "applyRelease"
      inputs = { runCommand = local.commands, timeoutSeconds = "900" }
    }]
  })
}

# Once, when the host first registers: a replaced machine comes up on the last release that passed without a deploy.
resource "aws_ssm_association" "boot" {
  name = aws_ssm_document.deploy.name

  targets {
    key    = "InstanceIds"
    values = [aws_instance.this.id]
  }
}
