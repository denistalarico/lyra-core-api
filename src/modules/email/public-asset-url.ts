/**
 * Uploads são servidos em `/api/assets/…`, relativo à API. Fora do app (num
 * e-mail) a URL precisa ser absoluta; sem origem pública configurada, não há
 * como exibir a imagem e o retorno é `null`.
 */
export function publicAssetUrl(url: string | null | undefined): string | null {
  const value = url?.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (!value.startsWith('/api/')) return null;
  const publicApi =
    process.env.API_PUBLIC_URL?.trim() ||
    process.env.AGENCY_PUBLIC_API_URL?.trim() ||
    process.env.META_WEBHOOK_CALLBACK_URL?.trim();
  if (!publicApi) return null;
  try {
    return `${new URL(publicApi).origin}${value}`;
  } catch {
    return null;
  }
}
