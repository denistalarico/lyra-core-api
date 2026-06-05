import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { AgencyUserSecuritySettingsEntity } from '../../agency/entities/agency-auth.entities';
import { KnowledgeContext } from './knowledge-context';

@Injectable()
export class KnowledgeVaultReauthService {
  constructor(
    @InjectRepository(AgencyUserSecuritySettingsEntity, 'agency')
    private readonly securityRepository: Repository<AgencyUserSecuritySettingsEntity>,
  ) {}

  async verifyPassword(context: KnowledgeContext, password: string) {
    if (!context.tenantId || !context.userId) {
      throw new UnauthorizedException('Missing authentication context');
    }

    if (!password) {
      throw new ForbiddenException(
        'Password is required to reveal this secret',
      );
    }

    const security = await this.securityRepository.findOne({
      where: {
        tenantId: context.tenantId,
        userId: context.userId,
      },
    });

    if (!security?.passwordHash) {
      throw new ForbiddenException('User does not have a password configured');
    }

    const isValid = await argon2
      .verify(security.passwordHash, password)
      .catch(() => false);

    if (!isValid) {
      throw new ForbiddenException('Invalid password');
    }

    return true;
  }
}
