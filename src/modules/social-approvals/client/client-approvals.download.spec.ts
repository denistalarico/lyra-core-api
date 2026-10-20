import { NotFoundException } from '@nestjs/common';
import { PassThrough } from 'node:stream';
import type { Response } from 'express';
import type { ClientAreaContext } from '../../client-area/client-area.types';
import { ClientAreaApprovalsController } from './client-approvals.controller';

describe('CA10 / R-23 deliverable download route', () => {
  const context = {
    tenantId: 't',
    workspaceId: 'w',
    agencyClientId: 'c',
    companyContextId: 'co',
    userId: 'u',
    permissions: new Set(['client_area.approvals.view']),
  } as unknown as ClientAreaContext;

  const build = (deliverable: () => Promise<unknown>) => {
    const body = new PassThrough();
    const files = {
      getPrivateAsset: jest.fn().mockResolvedValue({ body }),
    };
    const media = { resolveDeliverable: jest.fn(deliverable) };
    const controller = new ClientAreaApprovalsController(
      {} as never,
      {} as never,
      media as never,
      files as never,
    );
    const headers: Record<string, string> = {};
    const response = new PassThrough() as unknown as Response;
    (response as unknown as { setHeader: unknown }).setHeader = (
      name: string,
      value: string,
    ) => {
      headers[name] = value;
    };
    return { controller, media, files, headers, response, body };
  };

  it('streams the approved original as an attachment, scoped by the membership', async () => {
    const { controller, media, files, headers, response, body } = build(() =>
      Promise.resolve({
        media: { storagePath: 'private/a.png', mimeType: 'image/png' },
        fileName: 'post-v2.png',
      }),
    );
    await controller.download(context, 'approval-1', response);
    body.end();
    expect(media.resolveDeliverable).toHaveBeenCalledWith(
      {
        tenantId: 't',
        workspaceId: 'w',
        agencyClientId: 'c',
        companyContextId: 'co',
      },
      'approval-1',
    );
    expect(files.getPrivateAsset).toHaveBeenCalledWith('private/a.png');
    expect(headers).toEqual({
      'Content-Type': 'image/png',
      'Content-Disposition': 'attachment; filename="post-v2.png"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
  });

  it('opens no storage object when the deliverable is not available', async () => {
    const { controller, files, response } = build(() =>
      Promise.reject(new NotFoundException('Mídia não encontrada.')),
    );
    await expect(
      controller.download(context, 'approval-1', response),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(files.getPrivateAsset).not.toHaveBeenCalled();
  });
});
