import { BadRequestException, ConflictException } from '@nestjs/common';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import {
  approvalRichBodyToText,
  sanitizeApprovalRichBody,
  SocialApprovalFeedbackService,
  type ApprovalFeedbackActions,
  type ApprovalFeedbackFile,
} from './social-approval-feedback.service';

const scope = { tenantId: 'tenant-a' } as CompanyAwareScope;
const file = (
  mimetype = 'audio/webm;codecs=opus',
  originalname = 'audio.webm',
): ApprovalFeedbackFile => ({
  originalname,
  mimetype,
  size: 4,
  buffer: Buffer.from('data'),
});

describe('SocialApprovalFeedbackService', () => {
  const files = {
    uploadPrivateBuffer: jest.fn((input: { path: string }) =>
      Promise.resolve({ path: input.path }),
    ),
    deleteObject: jest.fn(() => Promise.resolve()),
  };
  const service = new SocialApprovalFeedbackService(
    {} as never,
    files as never,
  );
  const actions = {
    approve: jest.fn(() => Promise.resolve()),
    changes: jest.fn(() => Promise.resolve()),
    comment: jest.fn(() => Promise.resolve()),
  } satisfies ApprovalFeedbackActions;
  const targets = { decide: ['a', 'b'], comment: ['a', 'b'] };

  beforeEach(() => jest.clearAllMocks());

  it('strips anything executable and keeps links safe', () => {
    const clean = sanitizeApprovalRichBody(
      '<p onclick="x()">Oi<script>alert(1)</script></p><a href="javascript:x()">a</a><a href="https://x.dev">b</a><img src=x>',
    );
    expect(clean).not.toMatch(/script|onclick|img|javascript/);
    expect(clean).toContain('href="https://x.dev"');
    expect(clean).toContain('rel="noopener noreferrer"');
  });

  it('derives the plain body readable by notifications', () => {
    expect(
      approvalRichBodyToText('<p>Um &amp; dois</p><ul><li>três</li></ul>'),
    ).toBe('Um & dois\ntrês');
  });

  it('plain approval needs no text and reaches every decidable step', async () => {
    await service.submit(scope, { decision: 'approve' }, [], targets, actions);
    expect(actions.approve.mock.calls).toEqual([['a'], ['b']]);
    expect(files.uploadPrivateBuffer).not.toHaveBeenCalled();
  });

  it('every other decision needs text or a file', async () => {
    await expect(
      service.submit(
        scope,
        { decision: 'approve_with_notes', richBody: '<p></p>' },
        [],
        targets,
        actions,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(actions.approve).not.toHaveBeenCalled();
  });

  it('an audio alone is enough, and both steps share one feedback', async () => {
    await service.submit(
      scope,
      { decision: 'reject' },
      [file()],
      targets,
      actions,
    );
    const [first, second] = actions.changes.mock.calls as unknown as Array<
      [
        string,
        { body: string; feedbackId: string; attachments: unknown[] },
        string,
      ]
    >;
    expect(first[1].body).toBe('Áudio enviado.');
    expect(first[2]).toBe('reject');
    expect(first[1].feedbackId).toBe(second[1].feedbackId);
    expect(first[1].attachments).toHaveLength(1);
    expect(files.uploadPrivateBuffer).toHaveBeenCalledTimes(1);
  });

  it('refuses an unsupported file before storing anything', async () => {
    await expect(
      service.submit(
        scope,
        { decision: 'revise', richBody: '<p>x</p>' },
        [file(), file('text/html', 'a.html')],
        targets,
        actions,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(files.uploadPrivateBuffer).not.toHaveBeenCalled();
  });

  it('approvalId narrows the server list and can never add to it', async () => {
    await expect(
      service.submit(
        scope,
        { decision: 'approve', approvalId: 'other' },
        [],
        targets,
        actions,
      ),
    ).rejects.toThrow(ConflictException);
    await service.submit(
      scope,
      { decision: 'approve', approvalId: 'b' },
      [],
      targets,
      actions,
    );
    expect(actions.approve.mock.calls).toEqual([['b']]);
  });

  it('a comment lands on one step only', async () => {
    await service.submit(
      scope,
      { decision: 'comment', richBody: '<p>x</p>' },
      [],
      targets,
      actions,
    );
    expect(actions.comment).toHaveBeenCalledTimes(1);
  });

  it('removes the files when nothing was decided, keeps them after a partial decision', async () => {
    actions.changes.mockRejectedValueOnce(new ConflictException());
    await expect(
      service.submit(scope, { decision: 'revise' }, [file()], targets, actions),
    ).rejects.toThrow(ConflictException);
    expect(files.deleteObject).toHaveBeenCalledTimes(1);

    files.deleteObject.mockClear();
    actions.changes
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ConflictException());
    await expect(
      service.submit(scope, { decision: 'revise' }, [file()], targets, actions),
    ).rejects.toThrow(ConflictException);
    expect(files.deleteObject).not.toHaveBeenCalled();
  });
});
