const DEV_ONLY_EMAIL_DOMAIN = "@example.test";

/**
 * Addresses in the reserved `.test` domain are exclusively for the isolated
 * development database. Refuse them in production even if one is inserted
 * there accidentally.
 */
export function isDevOnlyAgencyLoginBlocked(
  email: string,
  environment = process.env.NODE_ENV,
): boolean {
  return (
    environment === "production" &&
    email.trim().toLowerCase().endsWith(DEV_ONLY_EMAIL_DOMAIN)
  );
}
