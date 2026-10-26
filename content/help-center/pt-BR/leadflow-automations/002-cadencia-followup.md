---
systemKey: automations-followup-cadence
slug: cadencia-followup
title: 'Cadência de follow-up (D0, D1, D3, D7)'
summary: 'Configure os intervalos de follow-up, os canais e as mensagens sem insistir depois de uma resposta ou de um opt-out.'
categoryKey: leadflow
moduleKey: leadflow-automations
productKey: lyra-leadflow
trailKeys: [automacoes-e-followup]
order: 31
version: 1
locale: pt-BR
status: published
isFeatured: false
searchable: true
estimatedMinutes: 6
tags: [follow-up, cadência, d0, d1, d3, d7]
---

A cadência organiza contatos depois que um lead para de responder. **D0, D1, D3 e D7** representam o dia inicial e os dias seguintes da sequência.

## Antes de ligar

- confirme quais canais podem receber follow-up;
- escreva mensagens adequadas a cada momento;
- confira o horário de atendimento;
- mantenha uma forma clara de interromper a sequência.

## Configurar

1. Abra **LeadFlow → Automações**.
2. Localize a receita de follow-up e abra a configuração.
3. Revise cada passo da cadência e o intervalo correspondente.
4. Escolha os canais permitidos.
5. Preencha ou revise as mensagens.
6. Salve e ligue a automação.

| Passo | Intenção recomendada |
| --- | --- |
| D0 | Retomar o contexto sem repetir toda a conversa |
| D1 | Lembrete curto com ajuda objetiva |
| D3 | Reforçar o benefício ou responder uma objeção comum |
| D7 | Encerrar a sequência com respeito e porta aberta |

> **Atenção:** uma resposta do contato, um handoff ou um opt-out deve interromper a insistência. Não use a cadência para contornar limites do canal.

Nos canais Meta, a janela de atendimento pode limitar mensagens livres. Quando necessário, use os templates de follow-up disponíveis em **Inbox → Configurações → Templates de follow-up**.

## Problemas comuns

| O que acontece | O que conferir |
| --- | --- |
| Nenhuma mensagem foi enviada | Automação ligada, canal ativo e execução liberada |
| A sequência parou | O contato respondeu, saiu da elegibilidade ou pediu interrupção |
| O canal recusou a mensagem | Janela do canal e template aplicável |
| O texto saiu incompleto | Variáveis usadas e dados existentes no contato |
| A mensagem caiu fora do horário | Horário de atendimento herdado ou personalizado |

