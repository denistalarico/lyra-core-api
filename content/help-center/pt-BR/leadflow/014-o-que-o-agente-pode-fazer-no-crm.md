---
systemKey: agents-crm-behavior
slug: o-que-o-agente-pode-fazer-no-crm
title: 'O que o agente pode fazer no CRM'
summary: 'Na aba CRM/Leads do agente você permite que ele crie um lead ao identificar uma oportunidade e avance o estágio quando o lead estiver qualificado. Ele nunca exclui, nunca mexe em valores financeiros e só atua no funil configurado.'
categoryKey: leadflow
moduleKey: leadflow-agents
productKey: lyra-leadflow
trailKeys: [agentes-e-operations-room]
order: 14
version: 1
locale: pt-BR
status: published
isFeatured: false
searchable: true
estimatedMinutes: 4
tags: [crm, lead, oportunidade, estágio, pipeline, funil, agente no crm]
---

O agente pode trabalhar junto com o seu funil: registrar a oportunidade quando percebe interesse real e avançar a etapa quando o lead fica qualificado. Você decide o quanto ele pode fazer.

## Em resumo

- Fica em **LeadFlow → Agentes → ⋮ no agente → Configurar → CRM/Leads**.
- Duas permissões: **Criar um lead quando identificar uma oportunidade** e **Avançar o estágio quando o lead estiver qualificado**.
- O agente atua só no funil definido para ele e segue as transições de etapa publicadas no CRM.
- Ele nunca exclui oportunidades nem altera valores financeiros.

## As opções

| Opção | Ligada | Desligada |
| --- | --- | --- |
| **Criar um lead quando identificar uma oportunidade** | O agente cria a oportunidade no CRM com o contato e o resumo da conversa | A conversa fica só no Inbox; a equipe cria a oportunidade |
| **Avançar o estágio quando o lead estiver qualificado** | Quando as perguntas de qualificação são respondidas, a oportunidade vai para a próxima etapa | A etapa só muda pela equipe |

## Passo a passo

1. Abra a configuração do agente e a aba **CRM/Leads**.
2. Marque as opções desejadas.
3. Clique em **Salvar alterações**.

> **Dica:** comece com **Criar um lead** ligado e **Avançar o estágio** desligado. Depois de uma semana, confira no CRM se as oportunidades criadas fazem sentido e então ligue o avanço automático.

## O agente na Operations Room

Quando você pede uma alteração a um agente na **Operations Room** (por exemplo, "cria o contato Maria Silva" ou "move a oportunidade da Maria para Proposta"), ele só aceita o pedido se aquilo estiver dentro do que o tipo dele pode fazer:

| Pedido | Precisa que o agente possa… |
| --- | --- |
| Criar contato | capturar leads |
| Atualizar nome ou cargo de um contato | capturar leads ou qualificar |
| Mover oportunidade de etapa | atualizar a etapa, e só no funil dele |
| Criar compromisso | agendar |

Fora disso, o agente responde que o pedido não está no escopo dele. O **Orion** pode fazer esses pedidos com o limite das **suas** permissões. Toda alteração pedida no chat vira uma proposta que só vale depois que você confirma.

## Problemas comuns

| O que acontece | Causa provável | O que fazer |
| --- | --- | --- |
| O agente não cria oportunidades | Opção desligada ou conversa sem interesse claro | Ligue **Criar um lead** e revise as perguntas de qualificação |
| A oportunidade não avançou | A transição não é permitida no funil ou a opção está desligada | Confira as etapas em **CRM → Configurações** |
| "Não foi possível carregar os pipelines do CRM" | CRM sem funil para esta empresa | Crie o funil no CRM antes |
| O agente recusou mover uma oportunidade na sala | O funil da oportunidade não é o do agente | Peça ao Orion ou mova pelo CRM |

## Artigos relacionados

- [Handoff: quando o agente passa para uma pessoa](/help/articles/handoff-quando-o-agente-passa-para-uma-pessoa)
- [Operations Room: comandos, relatórios e alterações](/help/articles/operations-room-comandos-relatorios-e-alteracoes)
