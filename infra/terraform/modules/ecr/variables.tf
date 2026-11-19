variable "repositories" {
  description = "Repository names. Production's are khanha/web and khanha/server; staging gives its own, so its merges never evict a release image."
  type        = list(string)
}

variable "keep_images" {
  description = "Images kept per repository; older ones expire."
  type        = number
  default     = 10
}
