import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
} from '@nestjs/common';
import {
  ThreadsDeauthorizationService,
  ThreadsSignedRequestError,
} from './threads-deauthorization.service';

/**
 * Uninstall and data deletion callbacks registered on the Threads use case:
 * `https://api.lyrasuite.com/api/social/organic/webhook/threads/uninstall`
 * and `.../delete`. Public and unauthenticated by design: they are
 * authorized only by the `signed_request` HMAC with the Threads app secret,
 * which is why they live in their own controller, away from the JWT routes.
 */
@Controller('social/organic/webhook/threads')
export class ThreadsDeauthorizationController {
  constructor(
    private readonly deauthorization: ThreadsDeauthorizationService,
  ) {}

  @Post('uninstall')
  @HttpCode(200)
  async uninstall(@Body() body: { signed_request?: unknown }) {
    const userId = this.verify(body?.signed_request);
    await this.deauthorization.disconnectUser(userId);
    return { success: true };
  }

  @Post('delete')
  @HttpCode(200)
  async delete(@Body() body: { signed_request?: unknown }) {
    const userId = this.verify(body?.signed_request);
    await this.deauthorization.disconnectUser(userId);
    return this.deauthorization.deletionReceipt();
  }

  private verify(signedRequest: unknown): string {
    try {
      return this.deauthorization.verify(signedRequest);
    } catch (error) {
      if (error instanceof ThreadsSignedRequestError) {
        throw new BadRequestException('invalid_signed_request');
      }
      throw error;
    }
  }
}
