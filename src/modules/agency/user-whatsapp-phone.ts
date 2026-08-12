/**
 * O número de WhatsApp de um usuário da agência.
 *
 * Fonte única para qualquer entrega por WhatsApp dirigida a um membro da
 * equipe (hoje, a notificação de handoff do LeadFlow). A regra é a do perfil:
 * marcado "mesmo número do telefone", vale o telefone; desmarcado, vale o
 * número próprio — e, sem número próprio, não há WhatsApp, em vez de cair
 * silenciosamente no telefone que o usuário acabou de dizer que não é WhatsApp.
 */
export function resolveUserWhatsAppPhone(
  profile: {
    phone?: string | null;
    whatsappPhone?: string | null;
    whatsappSameAsPhone?: boolean | null;
  } | null,
): string | null {
  if (!profile) return null;

  // Perfis anteriores à coluna (ou nunca salvos desde então) chegam sem o
  // campo: o padrão histórico era usar o telefone, e ele é preservado.
  const sameAsPhone = profile.whatsappSameAsPhone ?? true;
  const candidate = sameAsPhone ? profile.phone : profile.whatsappPhone;
  const trimmed = candidate?.trim();

  return trimmed ? trimmed : null;
}
