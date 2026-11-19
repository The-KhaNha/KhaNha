# The guard against the T4g default that bills: the host runs in standard CPU-credit mode, which slows down when its
# credits run out instead of charging for the burst. Runs in ci.yml's infra job, no AWS needed.

mock_provider "aws" {
  mock_data "aws_ssm_parameter" {
    defaults = { insecure_value = "ami-0123456789abcdef0" }
  }
}

variables {
  name                  = "khanha-test"
  environment           = "test"
  subnet_id             = "subnet-0123456789abcdef0"
  security_group_ids    = ["sg-0123456789abcdef0"]
  instance_profile_name = "khanha-test-host"
  image_prefix          = "123456789012.dkr.ecr.ap-south-1.amazonaws.com/khanha"
  deploy_document_name  = "khanha-test-deploy"
  host_dir              = "../../../host"
}

run "cpu_credits_are_standard" {
  command = plan

  assert {
    condition     = aws_instance.this.credit_specification[0].cpu_credits == "standard"
    error_message = "The host must use standard CPU credits: unlimited bills sustained bursts."
  }
}
