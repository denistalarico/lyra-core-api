import { IsISO8601 } from 'class-validator';

/**
 * Moves a publication that has not started running yet (E6).
 *
 * `scheduledAt` is required and absolute. An ISO-8601 instant carries its own
 * offset, so this contract never has to guess a timezone — which is the point:
 * §3 forbids a silent UTC fallback, and a naive local string would force one
 * here. `availableAt` is not accepted and never will be; it is queue mechanics
 * that the service derives, and letting a caller set it would be a way to hand
 * the worker a row it may lease before the operator's own scheduled time.
 *
 * There is no `reason` field. Nothing in this campaign reads one, and an
 * unread free-text column on an execution record is a place for operator notes
 * to accumulate outside any retention policy.
 */
export class RescheduleSocialPublicationDto {
  @IsISO8601()
  scheduledAt!: string;
}
