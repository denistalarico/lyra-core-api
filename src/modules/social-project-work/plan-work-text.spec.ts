import { DEFAULT_SOCIAL_PLANNER_SETTINGS as D } from '../social-planner/social-planner.defaults';
import {
  channelsText,
  itemSubtaskDescription,
  itemTaskDescription,
  itemTaskTitle,
  planTaskDescription,
} from './plan-work-text';

const labels = {
  formats: D.creativeFormats,
  types: D.contentTypes,
  objectives: D.objectives,
};
const item = {
  title: 'Seleção de presentes',
  theme: 'Natal',
  plannedDate: '2026-12-05',
  creativeFormat: 'carousel',
  funnelStage: 'discovery',
  contentType: 'promotion',
  objective: 'engagement',
  cta: 'Compre já',
};
const destinations = [
  { channel: 'instagram', placement: 'feed' },
  { channel: 'facebook', placement: 'feed' },
  { channel: 'instagram', placement: 'story' },
];

describe('plan work text (E5)', () => {
  it('names a task by the post day and the plan', () => {
    expect(itemTaskTitle(item, 'Plano de Dezembro')).toBe(
      '05/12 · Plano de Dezembro',
    );
    expect(itemTaskTitle({ ...item, plannedDate: null }, 'Plano')).toBe(
      'Plano',
    );
    expect(itemTaskTitle(item, '  ')).toBe('05/12 · Seleção de presentes');
  });

  it('describes a task per item one field per line, with catalog labels', () => {
    expect(itemTaskDescription(item, destinations, labels)).toBe(
      [
        'Data: 05/12/2026',
        'Tema: Natal',
        'Conteúdo: Seleção de presentes',
        'Canais: Instagram · Feed, Facebook · Feed, Instagram · Story',
        'Formato: Carrossel',
        'Funil: Descoberta',
        'Tipo: Divulgação',
        'Objetivo: Engajamento',
        'CTA: Compre já',
      ].join('\n'),
    );
    const empty = itemTaskDescription(
      { ...item, theme: null, cta: ' ', creativeFormat: 'custom_key' },
      [],
      labels,
    );
    expect(empty).toContain('Tema: —');
    expect(empty).toContain('Canais: —');
    expect(empty).toContain('CTA: —');
    expect(empty).toContain('Formato: custom_key');
  });

  it('describes the plan task with its period and direction', () => {
    expect(
      planTaskDescription({
        title: 'Plano',
        periodStart: '2026-12-01',
        periodEnd: '2026-12-31',
        primaryObjective: 'Engajamento',
        strategyMode: 'always_on',
      }),
    ).toBe(
      [
        'Início: 01/12/2026',
        'Fim: 31/12/2026',
        'Objetivo principal: Engajamento',
        'Modo estratégico: Posts para Redes Sociais',
      ].join('\n'),
    );
  });

  it('puts a subtask on one line, skipping what is empty', () => {
    expect(itemSubtaskDescription(item, destinations, labels)).toBe(
      '05/12 · Natal · Instagram · Feed, Facebook · Feed, Instagram · Story · Carrossel · Descoberta · Divulgação · Compre já',
    );
    expect(
      itemSubtaskDescription(
        { ...item, theme: null, cta: null, funnelStage: null },
        [],
        labels,
      ),
    ).toBe('05/12 · Carrossel · Divulgação');
  });

  it('lists each channel and placement once', () => {
    expect(
      channelsText([
        { channel: 'instagram', placement: 'reel' },
        { channel: 'instagram', placement: 'reels' },
        { channel: 'x', placement: 'post' },
      ]),
    ).toBe('Instagram · Reels, x · Post');
  });
});
