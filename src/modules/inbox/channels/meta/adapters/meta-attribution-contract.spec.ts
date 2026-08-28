import { InstagramMetaAdapter } from './instagram-meta.adapter';
import { MessengerMetaAdapter } from './messenger-meta.adapter';
import { WhatsAppMetaAdapter } from './whatsapp-meta.adapter';
import { readAttributionObservation } from '../../types/inbound-attribution-observation';

/**
 * What each Meta channel actually reports about how a message arrived.
 *
 * The three channels are asserted together on purpose. The gap between them is
 * a fact about Meta's contract, not an oversight in the adapters, and a test
 * that only covered WhatsApp would let a future change quietly invent a
 * referral for Instagram or Messenger to make a dashboard look complete.
 */
describe('Meta inbound attribution contract', () => {
  const channel = {
    id: 'channel-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
  };

  describe('WhatsApp', () => {
    const resolver = {
      findWhatsAppChannelByPhoneNumberId: jest.fn().mockResolvedValue(channel),
    };
    const adapter = new WhatsAppMetaAdapter(resolver as never);

    const payload = (referral?: Record<string, unknown>) => ({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'phone-1' },
                contacts: [{ wa_id: '5511999990000', profile: { name: 'Ana' } }],
                messages: [
                  {
                    from: '5511999990000',
                    id: 'wamid.1',
                    timestamp: '1787000000',
                    type: 'text',
                    text: { body: 'Oi' },
                    ...(referral ? { referral } : {}),
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    it('normalizes source_id, ctwa_clid and source_type into the shared shape', async () => {
      const { messages } = await adapter.normalize(
        payload({
          source_id: '120210000000000000',
          source_type: 'ad',
          ctwa_clid: 'ARAaBbCcDd',
          headline: 'Promoção',
          body: 'Fale conosco',
          source_url: 'https://fb.me/x',
        }) as never,
      );

      expect(readAttributionObservation(messages[0].metadata)).toEqual({
        adId: '120210000000000000',
        clickId: 'ARAaBbCcDd',
        sourceType: 'ad',
      });
    });

    // The headline, body and thumbnail are ad creative. They are retrievable
    // from the ad hierarchy by the id that is kept, and holding them in the
    // Inbox forever buys no query.
    it('drops the ad creative Meta sends alongside the identifiers', async () => {
      const { messages } = await adapter.normalize(
        payload({
          source_id: 'ad-1',
          source_type: 'ad',
          ctwa_clid: 'clid-1',
          headline: 'Compre agora',
          body: 'Texto do anúncio',
          source_url: 'https://fb.me/promo',
        }) as never,
      );

      const serialized = JSON.stringify(messages[0].metadata);
      expect(serialized).not.toContain('Compre agora');
      expect(serialized).not.toContain('Texto do anúncio');
      expect(serialized).not.toContain('fb.me');
    });

    it('reports no observation for a message that arrived without a referral', async () => {
      const { messages } = await adapter.normalize(payload() as never);

      expect(messages[0].metadata?.referral).toBeNull();
      expect(readAttributionObservation(messages[0].metadata)).toBeNull();
    });

    /**
     * The activation policy has read `metadata.referralTrusted` and
     * `metadata.referral` since before this table existed. Persisting the
     * observation must not change what it sees.
     */
    it('still hands the activation policy the flags it has always read', async () => {
      const { messages } = await adapter.normalize(
        payload({
          source_id: 'ad-1',
          source_type: 'ad',
          ctwa_clid: 'clid-1',
        }) as never,
      );

      expect(messages[0].metadata?.referralTrusted).toBe(true);
      expect(messages[0].metadata?.referral).toEqual({
        adId: 'ad-1',
        sourceType: 'ad',
        clickId: 'clid-1',
      });
    });
  });

  /**
   * Instagram messaging webhooks carry sender, recipient, message, reaction and
   * read. There is no referral, no ad id and no click id in the payload type
   * this project supports, so no observation can be produced — and none is
   * invented. The model is ready for one if Meta starts sending it; the gap is
   * Meta's, and it is documented here rather than papered over.
   */
  describe('Instagram', () => {
    const resolver = {
      findInstagramChannelByAccountId: jest.fn().mockResolvedValue({
        ...channel,
        accessTokenEncrypted: null,
        metadata: {},
      }),
    };
    const graph = { fetchUserProfile: jest.fn().mockResolvedValue(null) };
    const crypto = { decrypt: jest.fn().mockReturnValue(null) };
    const adapter = new InstagramMetaAdapter(
      resolver as never,
      graph as never,
      crypto as never,
    );

    it('produces no attribution observation, because the payload carries none', async () => {
      const { messages } = await adapter.normalize({
        object: 'instagram',
        entry: [
          {
            id: 'ig-account-1',
            time: 1787000000,
            messaging: [
              {
                sender: { id: 'igsid-1' },
                recipient: { id: 'ig-account-1' },
                timestamp: 1787000000000,
                message: { mid: 'ig-mid-1', text: 'Oi' },
              },
            ],
          },
        ],
      } as never);

      expect(messages).toHaveLength(1);
      expect(readAttributionObservation(messages[0].metadata)).toBeNull();
    });
  });

  /**
   * Messenger is the same story: `messaging` events expose message, delivery,
   * read and reaction. Meta does define an ad-referral shape for Messenger, but
   * this project's supported payload type does not carry it and no adapter
   * reads it — so the honest state is no observation, not a guess.
   */
  describe('Messenger', () => {
    const resolver = {
      findFacebookMessengerChannelByPageId: jest.fn().mockResolvedValue({
        ...channel,
        accessTokenEncrypted: null,
        metadata: {},
      }),
    };
    const graph = { fetchUserProfile: jest.fn().mockResolvedValue(null) };
    const crypto = { decrypt: jest.fn().mockReturnValue(null) };
    const adapter = new MessengerMetaAdapter(
      resolver as never,
      graph as never,
      crypto as never,
    );

    it('produces no attribution observation, because the payload carries none', async () => {
      const { messages } = await adapter.normalize({
        object: 'page',
        entry: [
          {
            id: 'page-1',
            time: 1787000000,
            messaging: [
              {
                sender: { id: 'psid-1' },
                recipient: { id: 'page-1' },
                timestamp: 1787000000000,
                message: { mid: 'mid-1', text: 'Oi' },
              },
            ],
          },
        ],
      } as never);

      expect(messages).toHaveLength(1);
      expect(readAttributionObservation(messages[0].metadata)).toBeNull();
    });
  });
});
