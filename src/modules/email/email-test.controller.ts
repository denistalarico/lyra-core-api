import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsEmail } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import { EmailService } from './email.service';

class SendTestEmailDto {
  @IsEmail()
  to!: string;
}

@Controller('email')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class EmailTestController {
  constructor(private readonly emailService: EmailService) {}

  @Post('test')
  @RequirePermission('leadflow.settings.integrations.manage.admin')
  async sendTestEmail(@Body() dto: SendTestEmailDto) {
    await this.emailService.sendEmail({
      to: dto.to,
      subject: 'Teste Lyra SMTP',
      html: '<h1>Email funcionando 🚀</h1><p>SMTP do Lyra Suite configurado com sucesso.</p>',
      text: 'Email funcionando. SMTP do Lyra Suite configurado com sucesso.',
    });

    return { success: true };
  }
}
