import { parseDashboardLayout } from '../dashboard-layout.contract';
import {
  SOCIAL_CHANNEL_DEFAULT_SECTIONS,
  socialChannelDefaultLayout,
  type SocialChannelDefaultId,
} from './social-channel-default-layouts';

const CHANNELS: SocialChannelDefaultId[] = [
  'meta_ads',
  'instagram',
  'facebook',
];

describe('social channel default layouts', () => {
  it.each(CHANNELS)('%s passes the layout contract unchanged', (channel) => {
    const layout = socialChannelDefaultLayout(channel);

    expect(parseDashboardLayout(layout)).toEqual(layout);
    expect(layout.sections).toHaveLength(1);
    expect(layout.sections[0].id).toBe(`section-${channel}`);
    expect(layout.sections[0].channel).toBe(channel);
  });

  it('keeps the Visão Geral sections of 2026-10-26 as they were', () => {
    // Top-level cards per block, as read from the agency root (AN-11).
    expect(SOCIAL_CHANNEL_DEFAULT_SECTIONS.meta_ads.cards).toHaveLength(30);
    expect(SOCIAL_CHANNEL_DEFAULT_SECTIONS.instagram.cards).toHaveLength(21);
    expect(SOCIAL_CHANNEL_DEFAULT_SECTIONS.facebook.cards).toHaveLength(14);

    const groups = (channel: SocialChannelDefaultId) =>
      SOCIAL_CHANNEL_DEFAULT_SECTIONS[channel].cards.filter(
        (card) => card.kind === 'group',
      ).length;
    expect(groups('instagram')).toBe(3);
    expect(groups('facebook')).toBe(2);

    for (const channel of CHANNELS) {
      const { cards } = SOCIAL_CHANNEL_DEFAULT_SECTIONS[channel];
      expect(cards.some((card) => card.highlighted === true)).toBe(true);
    }
  });

  it('hands out a copy, so a seeded row never shares the default', () => {
    const layout = socialChannelDefaultLayout('meta_ads');
    layout.sections[0].cards.pop();

    expect(
      socialChannelDefaultLayout('meta_ads').sections[0].cards,
    ).toHaveLength(30);
  });
});
