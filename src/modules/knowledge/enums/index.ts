export enum AgencyKnowledgeArticleStatus {
  DRAFT = "draft",
  PUBLISHED = "published",
  IN_REVIEW = "in_review",
  ARCHIVED = "archived",
}

export enum AgencyKnowledgeArticleType {
  ARTICLE = "article",
  TUTORIAL = "tutorial",
  PROCESS = "process",
  DECISION = "decision",
  CHECKLIST = "checklist",
  ONBOARDING = "onboarding",
  USEFUL_LINK = "useful_link",
  OPEN_CREDENTIAL = "open_credential",
  INTERNAL_FAQ = "internal_faq",
  POLICY = "policy",
}

export enum AgencyKnowledgeArticleVisibility {
  INTERNAL = "internal",
  MANAGERS = "managers",
  RESTRICTED = "restricted",
  PRIVATE = "private",
}

export enum AgencyKnowledgeCommentStatus {
  ACTIVE = "active",
  RESOLVED = "resolved",
  ARCHIVED = "archived",
}

export enum AgencyKnowledgeReactionType {
  USEFUL = "useful",
  NOT_USEFUL = "not_useful",
  OUTDATED = "outdated",
  FAVORITE = "favorite",
  READ = "read",
}

export enum AgencyKnowledgeVaultStatus {
  ACTIVE = "active",
  ARCHIVED = "archived",
  REVOKED = "revoked",
}

export enum AgencyKnowledgeVaultServiceType {
  INSTAGRAM = "instagram",
  FACEBOOK = "facebook",
  META_BUSINESS = "meta_business",
  GOOGLE = "google",
  GOOGLE_ADS = "google_ads",
  GOOGLE_ANALYTICS = "google_analytics",
  GMAIL = "gmail",
  EMAIL = "email",
  HOSTING = "hosting",
  DOMAIN = "domain",
  WORDPRESS = "wordpress",
  CANVA = "canva",
  FIGMA = "figma",
  TIKTOK = "tiktok",
  LINKEDIN = "linkedin",
  WHATSAPP = "whatsapp",
  OTHER = "other",
}

export enum AgencyKnowledgeVaultPermissionRole {
  OWNER = "owner",
  ADMIN = "admin",
  MANAGER = "manager",
  MEMBER = "member",
  USER = "user",
}

export enum AgencyKnowledgeVaultAccessAction {
  CREATED = "created",
  UPDATED = "updated",
  REVEALED = "revealed",
  COPIED = "copied",
  PERMISSION_GRANTED = "permission_granted",
  PERMISSION_REMOVED = "permission_removed",
  ARCHIVED = "archived",
  FAILED_REVEAL_ATTEMPT = "failed_reveal_attempt",
}
