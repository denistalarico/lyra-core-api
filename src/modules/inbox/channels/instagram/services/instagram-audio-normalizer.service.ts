import { BadRequestException, Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import ffmpegStatic from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

const INSTAGRAM_PASSTHROUGH_AUDIO_MIME_TYPES = new Set([
  'audio/aac',
  'audio/mp4',
  'audio/mpeg',
]);

function baseMimeType(value: string) {
  return (value || '').toLowerCase().split(';')[0].trim();
}

@Injectable()
export class InstagramAudioNormalizerService {
  async normalize(file: Express.Multer.File): Promise<Express.Multer.File> {
    if (
      INSTAGRAM_PASSTHROUGH_AUDIO_MIME_TYPES.has(baseMimeType(file.mimetype))
    ) {
      return file;
    }

    const ffmpegPath =
      process.env.FFMPEG_PATH?.trim() ||
      ((ffmpegStatic as unknown as string | null) ?? '');
    if (!ffmpegPath) {
      throw new BadRequestException(
        'Conversão de áudio indisponível no servidor (ffmpeg não encontrado).',
      );
    }

    const directory = await mkdtemp(join(tmpdir(), 'lyra-instagram-audio-'));
    const inputPath = join(directory, `in-${randomUUID()}`);
    const outputPath = join(directory, `out-${randomUUID()}.m4a`);

    try {
      await writeFile(inputPath, file.buffer);
      await execFileAsync(ffmpegPath, [
        '-y',
        '-i',
        inputPath,
        '-vn',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-movflags',
        '+faststart',
        '-f',
        'mp4',
        outputPath,
      ]);
      const buffer = await readFile(outputPath);
      const baseName = file.originalname.replace(/\.[^.]+$/, '') || 'audio';
      return {
        ...file,
        buffer,
        size: buffer.length,
        mimetype: 'audio/mp4',
        originalname: `${baseName}.m4a`,
      };
    } catch {
      throw new BadRequestException(
        'Não foi possível converter o áudio para um formato aceito pelo Instagram.',
      );
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}
