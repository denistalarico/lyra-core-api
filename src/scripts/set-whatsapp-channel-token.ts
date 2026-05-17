import 'reflect-metadata';
import { AppDataSource } from '../database/typeorm.datasource';
import { InboxChannelEntity } from '../modules/inbox/entities/inbox-channel.entity';
import { SettingsCryptoService } from '../common/crypto/settings-crypto.service';

async function main() {
  const channelId = process.env.WA_CHANNEL_ID;
  const token = process.env.WA_ACCESS_TOKEN;

  if (!channelId) {
    throw new Error('WA_CHANNEL_ID is required.');
  }

  if (!token) {
    throw new Error('WA_ACCESS_TOKEN is required.');
  }

  await AppDataSource.initialize();

  const repo = AppDataSource.getRepository(InboxChannelEntity);
  const channel = await repo.findOne({
    where: {
      id: channelId,
    },
  });

  if (!channel) {
    throw new Error(`Channel not found: ${channelId}`);
  }

  const crypto = new SettingsCryptoService();
  channel.accessTokenEncrypted = crypto.encrypt(token);
  channel.metadata = {
    ...(channel.metadata ?? {}),
    tokenConfiguredAt: new Date().toISOString(),
    tokenConfiguredBy: 'set-whatsapp-channel-token-script',
  };

  await repo.save(channel);
  await AppDataSource.destroy();

  console.log(`Token encrypted and saved for channel ${channelId}`);
}

main().catch(async (error) => {
  console.error(error);
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
  process.exit(1);
});
