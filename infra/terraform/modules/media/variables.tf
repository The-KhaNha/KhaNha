variable "bucket" {
  description = "The bucket's name, e.g. khanha-media-production-<account-id> (the instance role is scoped to it)."
  type        = string
}

variable "upload_origins" {
  description = "The app's origins, whose pages post upload forms to the bucket (CORS)."
  type        = list(string)
}
