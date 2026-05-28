import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import {
  TeamAttendanceEntry,
  TeamMember,
  TeamMemberPresence,
} from '../entities';
import {
  CreateTeamAttendanceEntryDto,
  TeamKioskPunchDto,
  UpdateTeamMemberAccessCodeDto,
  UpdateTeamPresenceDto,
} from '../dto';
import {
  TeamAttendanceSource,
  TeamAttendanceType,
  TeamMemberStatus,
  TeamPresenceSource,
  TeamPresenceStatus,
} from '../enums';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

function hashPinCode(tenantId: string, workspaceId: string, pinCode: string) {
  return createHash('sha256')
    .update(`${tenantId}:${workspaceId}:${pinCode}`)
    .digest('hex');
}

@Injectable()
export class TeamAttendanceService {
  constructor(
    @InjectRepository(TeamMember, 'agency')
    private readonly memberRepository: Repository<TeamMember>,
    @InjectRepository(TeamMemberPresence, 'agency')
    private readonly presenceRepository: Repository<TeamMemberPresence>,
    @InjectRepository(TeamAttendanceEntry, 'agency')
    private readonly attendanceRepository: Repository<TeamAttendanceEntry>,
  ) {}

  async getPresence(ctx: RequestContext, memberId: string) {
    await this.findMember(ctx, memberId);
    return this.ensurePresence(ctx, memberId);
  }

  async updatePresence(ctx: RequestContext, memberId: string, dto: UpdateTeamPresenceDto) {
    await this.findMember(ctx, memberId);
    const presence = await this.ensurePresence(ctx, memberId);

    presence.status = dto.status;
    presence.statusMessage = dto.statusMessage ?? null;
    presence.source = TeamPresenceSource.Web;
    presence.lastSeenAt = new Date();
    presence.updatedById = ctx.userId || null;

    return this.presenceRepository.save(presence);
  }

  async listAttendanceEntries(ctx: RequestContext, memberId: string) {
    await this.findMember(ctx, memberId);

    return this.attendanceRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        memberId,
      },
      order: { occurredAt: 'DESC', createdAt: 'DESC' },
      take: 100,
    });
  }

  async createAttendanceEntry(
    ctx: RequestContext,
    memberId: string,
    dto: CreateTeamAttendanceEntryDto,
  ) {
    const member = await this.findMember(ctx, memberId);
    this.ensureAttendanceAllowed(member);

    const entry = await this.attendanceRepository.save(
      this.attendanceRepository.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        memberId,
        type: dto.type,
        source: TeamAttendanceSource.Web,
        occurredAt: new Date(),
        timezone: dto.timezone ?? member.timezone ?? null,
        note: dto.note ?? null,
        createdById: ctx.userId || null,
      }),
    );

    await this.syncPresenceFromAttendance(
      ctx,
      memberId,
      dto.type,
      TeamPresenceSource.Attendance,
    );

    return entry;
  }

  async updateMemberAccessCode(
    ctx: RequestContext,
    memberId: string,
    dto: UpdateTeamMemberAccessCodeDto,
  ) {
    const member = await this.findMember(ctx, memberId);

    if (dto.pinCode !== undefined) {
      member.pinCodeHash = dto.pinCode
        ? hashPinCode(ctx.tenantId, ctx.workspaceId, dto.pinCode)
        : null;
    }

    if (dto.barcodeValue !== undefined) {
      member.barcodeValue = dto.barcodeValue || null;
    }

    member.updatedById = ctx.userId || null;

    const saved = await this.memberRepository.save(member);

    return {
      id: saved.id,
      displayName: saved.displayName,
      hasPinCode: Boolean(saved.pinCodeHash),
      barcodeValue: saved.barcodeValue,
    };
  }

  async kioskPunch(ctx: RequestContext, dto: TeamKioskPunchDto) {
    if (!dto.pinCode && !dto.barcodeValue) {
      throw new BadRequestException('PIN code or barcode value is required');
    }

    const member = dto.barcodeValue
      ? await this.memberRepository.findOne({
          where: {
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            barcodeValue: dto.barcodeValue,
          },
        })
      : await this.memberRepository.findOne({
          where: {
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            pinCodeHash: hashPinCode(ctx.tenantId, ctx.workspaceId, dto.pinCode ?? ''),
          },
        });

    if (!member) {
      throw new NotFoundException('Team member not found for provided credential');
    }

    this.ensureAttendanceAllowed(member);

    const source = dto.barcodeValue
      ? TeamAttendanceSource.KioskBarcode
      : TeamAttendanceSource.KioskPin;

    const entry = await this.attendanceRepository.save(
      this.attendanceRepository.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        memberId: member.id,
        type: dto.type,
        source,
        occurredAt: new Date(),
        timezone: dto.timezone ?? member.timezone ?? null,
        note: dto.note ?? null,
        createdById: ctx.userId || null,
      }),
    );

    await this.syncPresenceFromAttendance(
      ctx,
      member.id,
      dto.type,
      TeamPresenceSource.Kiosk,
    );

    return {
      member: {
        id: member.id,
        displayName: member.displayName,
        workerType: member.workerType,
      },
      entry,
      message: this.attendanceMessage(dto.type),
    };
  }

  private ensureAttendanceAllowed(member: TeamMember) {
    if (!member.attendanceEnabled) {
      throw new BadRequestException('Attendance is not enabled for this team member');
    }

    if (member.status !== TeamMemberStatus.Active) {
      throw new BadRequestException('Only active team members can register attendance');
    }
  }

  private attendanceMessage(type: TeamAttendanceType) {
    const messages: Record<TeamAttendanceType, string> = {
      [TeamAttendanceType.CheckIn]: 'Check-in registered successfully.',
      [TeamAttendanceType.BreakStart]: 'Break start registered successfully.',
      [TeamAttendanceType.BreakEnd]: 'Break end registered successfully.',
      [TeamAttendanceType.CheckOut]: 'Check-out registered successfully.',
      [TeamAttendanceType.ManualAdjustment]: 'Manual adjustment registered successfully.',
    };

    return messages[type];
  }

  private async syncPresenceFromAttendance(
    ctx: RequestContext,
    memberId: string,
    type: TeamAttendanceType,
    source: TeamPresenceSource,
  ) {
    const presence = await this.ensurePresence(ctx, memberId);

    const nextStatusByType: Partial<Record<TeamAttendanceType, TeamPresenceStatus>> = {
      [TeamAttendanceType.CheckIn]: TeamPresenceStatus.Available,
      [TeamAttendanceType.BreakStart]: TeamPresenceStatus.OnBreak,
      [TeamAttendanceType.BreakEnd]: TeamPresenceStatus.Available,
      [TeamAttendanceType.CheckOut]: TeamPresenceStatus.Offline,
    };

    presence.status = nextStatusByType[type] ?? presence.status;
    presence.source = source;
    presence.lastSeenAt = new Date();
    presence.updatedById = ctx.userId || null;

    await this.presenceRepository.save(presence);
  }

  private async ensurePresence(ctx: RequestContext, memberId: string) {
    const existing = await this.presenceRepository.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        memberId,
      },
    });

    if (existing) return existing;

    return this.presenceRepository.save(
      this.presenceRepository.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        memberId,
        status: TeamPresenceStatus.Offline,
        source: TeamPresenceSource.System,
        lastSeenAt: null,
        updatedById: null,
      }),
    );
  }

  private async findMember(ctx: RequestContext, id: string) {
    const member = await this.memberRepository.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        id,
      },
    });

    if (!member) throw new NotFoundException('Team member not found');
    return member;
  }
}
