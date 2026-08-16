import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  appointmentTemplateParameters,
  appointmentVariablesUsed,
  renderAppointmentMessage,
  type AppointmentMessageValues,
} from '../catalog/appointment-message-variables.catalog';

export interface AppointmentMessageScope {
  tenantId: string;
  workspaceId: string;
  appointmentId: string;
  /**
   * Whose settings name the business. A workspace holds one agency context plus
   * one per managed client, so "the public name" is only unambiguous once the
   * automation says which context it belongs to.
   */
  automationId: string;
}

export interface RenderedAppointmentMessage {
  /** The free-text body, variables resolved. Null when there was no text. */
  text: string | null;
  /**
   * Positional parameters for the WhatsApp template, in the order the variables
   * appear in the text — which is the order the operator is told to build the
   * template in.
   */
  templateParameters: string[];
  values: AppointmentMessageValues;
}

/** One row of everything a commitment message can say. */
interface AppointmentFacts {
  title: string | null;
  startAt: Date | null;
  timezone: string | null;
  locationText: string | null;
  videoUrl: string | null;
  contactFirstName: string | null;
  contactDisplayName: string | null;
  professionalName: string | null;
  businessName: string | null;
}

/**
 * Turns the configured copy into the message a lead actually receives.
 *
 * Two things make this a service rather than a formatting helper. The first is
 * that the values are read at *send* time: a reminder scheduled when the
 * commitment was booked may fire days later, and the title, the room or the
 * professional may have changed since — quoting the booking-time snapshot would
 * make the platform confidently wrong. The second is that the same values feed
 * two different transports: free text inside the 24-hour window, and positional
 * template parameters outside it. Deriving both from one resolution is what
 * keeps them from disagreeing.
 *
 * Everything is read in a single query. A commitment that has lost its contact
 * or its professional still produces a message — the variable resolves empty and
 * the sentence is tidied — because a reminder without the responsible's name is
 * still a useful reminder, and a refusal here would be a silent no-show.
 */
@Injectable()
export class LeadFlowAppointmentMessageService {
  private readonly logger = new Logger(LeadFlowAppointmentMessageService.name);

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  /**
   * Throws when the read itself fails. That is deliberate: a message whose
   * variables silently collapsed would go out mangled and can never be taken
   * back, while a transient database error is exactly what a retry is for.
   */
  async render(
    scope: AppointmentMessageScope,
    text: string | null,
  ): Promise<RenderedAppointmentMessage> {
    const used = appointmentVariablesUsed(text);
    // No variables means nothing to look up. The reminder of a workspace that
    // never touched the default copy must not pay for a join.
    if (used.length === 0) {
      return { text, templateParameters: [], values: {} };
    }

    const values = await this.resolve(scope);
    return {
      text: text ? renderAppointmentMessage(text, values) : null,
      templateParameters: appointmentTemplateParameters(used, values),
      values,
    };
  }

  async resolve(
    scope: AppointmentMessageScope,
  ): Promise<AppointmentMessageValues> {
    const facts = await this.facts(scope);
    if (!facts) return {};

    const values: AppointmentMessageValues = {};
    const firstName =
      facts.contactFirstName?.trim() ||
      facts.contactDisplayName?.trim().split(/\s+/)[0] ||
      null;
    if (firstName) values['contact.firstName'] = firstName;
    if (facts.title?.trim()) values['appointment.title'] = facts.title.trim();

    if (facts.startAt) {
      const zone = facts.timezone?.trim() || 'America/Sao_Paulo';
      values['appointment.date'] = formatInZone(facts.startAt, zone, {
        day: '2-digit',
        month: '2-digit',
      });
      values['appointment.time'] = formatInZone(facts.startAt, zone, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      values['appointment.weekday'] = formatInZone(facts.startAt, zone, {
        weekday: 'long',
      });
    }

    const location =
      facts.locationText?.trim() || facts.videoUrl?.trim() || null;
    if (location) values['appointment.location'] = location;
    if (facts.professionalName?.trim()) {
      values['appointment.professional'] = facts.professionalName.trim();
    }
    if (facts.businessName?.trim()) {
      values['business.name'] = facts.businessName.trim();
    }
    return values;
  }

  /**
   * The commitment and everything hanging off it, in one read.
   *
   * The contact is followed through the commitment first and the conversation
   * second, because a booking made from the Agency UI carries the CRM contact
   * while one made from a conversation may carry only the thread — the same
   * asymmetry the context loader already works around.
   */
  private async facts(
    scope: AppointmentMessageScope,
  ): Promise<AppointmentFacts | null> {
    const rows = await this.dataSource.query<
      Array<{
        title: string | null;
        start_at: Date | null;
        due_at: Date | null;
        timezone: string | null;
        location_text: string | null;
        video_url: string | null;
        contact_first_name: string | null;
        contact_display_name: string | null;
        professional_name: string | null;
        business_name: string | null;
      }>
    >(
      `SELECT item.title,
                item.start_at,
                item.due_at,
                item.timezone,
                item.location_text,
                item.video_url,
                contact.first_name  AS contact_first_name,
                contact.display_name AS contact_display_name,
                professional.display_name AS professional_name,
                COALESCE(
                  settings.company_context_published -> 'identity' ->> 'publicName',
                  settings.company_context_draft -> 'identity' ->> 'publicName'
                ) AS business_name
           FROM scheduled_items item
           LEFT JOIN inbox_conversations conversation
                  ON conversation.id = item.source_conversation_id
                 AND conversation.tenant_id = item.tenant_id
           LEFT JOIN contacts contact
                  ON contact.id = COALESCE(item.contact_id, conversation.contact_id)
                 AND contact.tenant_id = item.tenant_id
           LEFT JOIN user_profile professional
                  ON professional.user_id = item.assigned_user_id
                 AND professional.tenant_id = item.tenant_id
           LEFT JOIN leadflow_automations automation
                  ON automation.id = $4
                 AND automation.tenant_id = item.tenant_id
           LEFT JOIN leadflow_client_settings settings
                  ON settings.id = automation.settings_id
          WHERE item.id = $1
            AND item.tenant_id = $2
            AND item.workspace_id = $3
            AND item.deleted_at IS NULL
          LIMIT 1`,
      [
        scope.appointmentId,
        scope.tenantId,
        scope.workspaceId,
        scope.automationId,
      ],
    );

    // No row is not a failure: a commitment that was deleted between the timer
    // and the send resolves to nothing, and the sentence is tidied around the
    // gaps. A *failed read* is different and is left to propagate — see
    // `render`, whose caller turns it into a retry.
    const row = rows[0];
    if (!row) {
      this.logger.warn(
        `appointment_message_commitment_missing: ${scope.appointmentId}`,
      );
      return null;
    }
    return {
      title: row.title,
      startAt: row.start_at ?? row.due_at,
      timezone: row.timezone,
      locationText: row.location_text,
      videoUrl: row.video_url,
      contactFirstName: row.contact_first_name,
      contactDisplayName: row.contact_display_name,
      professionalName: row.professional_name,
      businessName: row.business_name,
    };
  }
}

function formatInZone(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', { ...options, timeZone }).format(
      date,
    );
  } catch {
    // An invalid zone stored on the commitment must not break the message.
    return new Intl.DateTimeFormat('pt-BR', {
      ...options,
      timeZone: 'UTC',
    }).format(date);
  }
}
