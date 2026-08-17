import { InstagramAudioNormalizerService } from './instagram-audio-normalizer.service';

describe('InstagramAudioNormalizerService', () => {
  it('keeps an already compatible MP4/AAC upload unchanged', async () => {
    const service = new InstagramAudioNormalizerService();
    const file = {
      originalname: 'voice.m4a',
      mimetype: 'audio/mp4;codecs=mp4a.40.2',
      buffer: Buffer.from('audio'),
      size: 5,
    } as Express.Multer.File;

    await expect(service.normalize(file)).resolves.toBe(file);
  });
});
