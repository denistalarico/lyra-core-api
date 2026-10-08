import { ValidationPipe } from '@nestjs/common';
import { GenerateCreativeVideoDto } from './creative-video-generation.dto';

/** Same pipe options as `main.ts`. */
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});
const validate = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: GenerateCreativeVideoDto });

describe('GenerateCreativeVideoDto (CS4-B)', () => {
  it('accepts Lyra vocabulary for both modes', async () => {
    await expect(
      validate({
        mode: 'generative_reel',
        prompt: 'café',
        durationSeconds: 30,
        quality: 'high',
        audio: false,
        references: [
          {
            source: 'operator',
            id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
            kind: 'product',
          },
        ],
      }),
    ).resolves.toBeInstanceOf(GenerateCreativeVideoDto);
    await expect(
      validate({
        mode: 'ugc_avatar',
        script: 'Oi!',
        avatarId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        language: 'pt-BR',
      }),
    ).resolves.toBeInstanceOf(GenerateCreativeVideoDto);
  });

  it.each([
    'provider',
    'model',
    'resolution',
    'engine',
    'tenantId',
    'companyContextId',
    'agencyClientId',
    'storageUrl',
    'cost',
    'effectivePrompt',
    'providerAvatarId',
  ])('refuses `%s` from the client', async (field) => {
    await expect(
      validate({ mode: 'generative_reel', prompt: 'x', [field]: 'injected' }),
    ).rejects.toThrow();
  });

  it('refuses durations outside 5–30 s, unknown modes and non-vertical vocabularies', async () => {
    for (const body of [
      { mode: 'generative_reel', prompt: 'x', durationSeconds: 31 },
      { mode: 'generative_reel', prompt: 'x', durationSeconds: 4 },
      { mode: 'cinematic', prompt: 'x' },
      { mode: 'generative_reel', prompt: 'x', aspectRatio: '16:9' },
      { mode: 'generative_reel', prompt: 'x', quality: '4k' },
      { mode: 'ugc_avatar', script: 'x', language: 'Português' },
    ])
      await expect(validate(body)).rejects.toThrow();
  });
});
