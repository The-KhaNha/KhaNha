# The environment's image repositories. Tags are immutable, so a tag always names the image that was smoke-tested;
# a workflow that builds an image first looks for its tag and reuses it (PR 07), so a retried run does not fail.

resource "aws_ecr_repository" "this" {
  for_each = toset(var.repositories)

  name                 = each.key
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "keep_newest" {
  for_each = aws_ecr_repository.this

  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the newest ${var.keep_images} images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = var.keep_images
      }
      action = { type = "expire" }
    }]
  })
}
