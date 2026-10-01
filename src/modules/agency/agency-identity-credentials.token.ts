/**
 * DI token for `AgencyIdentityCredentialsService`.
 *
 * The service class sits at the top of an import chain that reaches `otplib`,
 * which ships ESM that Jest does not transform. Any module or spec that so
 * much as value-imports the class therefore has to mock `otplib`, even when
 * it only ever wanted the SMTP transport override.
 *
 * A token in its own file breaks that chain: a consumer imports this string,
 * declares the narrow port it actually needs, and the module wiring binds the
 * real service. Nothing about the runtime behaviour changes.
 */
export const AGENCY_IDENTITY_CREDENTIALS = 'AGENCY_IDENTITY_CREDENTIALS';
