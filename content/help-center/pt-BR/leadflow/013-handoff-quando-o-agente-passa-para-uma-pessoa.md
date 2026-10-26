---
systemKey: agents-handoff
slug: handoff-quando-o-agente-passa-para-uma-pessoa
title: 'Handoff: quando o agente passa para uma pessoa'
summary: 'Handoff é a transferência da conversa do agente para a equipe. Na aba Handoff do agente você escolhe quem é avisado; o Lyra notifica no app e, se a pessoa tiver WhatsApp no perfil, também no WhatsApp.'
categoryKey: leadflow
moduleKey: leadflow-agents
productKey: lyra-leadflow
trailKeys: [agentes-e-operations-room]
order: 13
version: 1
locale: pt-BR
status: published
isFeatured: false
searchable: true
estimatedMinutes: 5
tags: [handoff, transferência, atendente humano, notificação, whatsapp, responsável]
---

**Handoff** é o momento em que o agente para de responder e passa a conversa para uma pessoa da equipe. Ele preserva o contexto para que ninguém precise perguntar tudo de novo ao lead.

## Em resumo

- O agente faz handoff quando o lead pede uma pessoa ou quando o assunto sai do que ele pode resolver.
- Na aba **Handoff** do agente você escolhe **quem é avisado**.
- O aviso chega no app e, para quem tem **WhatsApp no perfil**, também no WhatsApp.
- Depois do handoff, a conversa fica com a equipe. O agente só volta a responder se alguém devolver a conversa a ele no Inbox.

## Onde fica

**LeadFlow → Agentes → ⋮ no agente → Configurar → Handoff** (o painel se chama **Transferência para uma pessoa**).

## Quem recebe o aviso

O Lyra procura o destinatário nesta ordem e para no primeiro que encontrar:

| Ordem | Quem | Onde se define |
| --- | --- | --- |
| 1 | As pessoas marcadas no handoff do agente | Aba **Handoff** do agente |
| 2 | O responsável pela conversa | Inbox, ao atribuir a conversa |
| 3 | O responsável padrão do canal | Configuração do canal |
| 4 | Os administradores do workspace | Automático |

Quem saiu da equipe deixa de receber avisos, mesmo que continue marcado.

## Passo a passo

1. Abra a aba **Handoff** do agente.
2. Marque as pessoas que devem ser avisadas. Cada nome mostra o cargo, quando houver.
3. Confira o resumo abaixo da lista: **Perfil de destino**, **Tempo esperado** e, se a transferência de oportunidade estiver ligada, **Pipeline humano** e **Estágio humano**.
4. Clique em **Salvar alterações**.

> **Dica:** para receber o aviso também no WhatsApp, cada pessoa informa o número em **Configurações → Perfil**. Sem número, o Lyra mostra "recebe apenas a notificação no app".

## O resumo do handoff

| Campo | O que significa |
| --- | --- |
| **Perfil de destino** | Para qual time a conversa vai: Responsável pelo contato, Equipe do Inbox, Equipe comercial ou Equipe de atendimento |
| **Tempo esperado** | Em quantos minutos a equipe deve assumir |
| **Pipeline humano / Estágio humano** | Para onde a oportunidade vai no CRM quando a equipe assume |

Cada valor mostra se vem do padrão do tipo de negócio (selo com a origem) ou se foi **Personalizado** neste agente.

## Problemas comuns

| O que acontece | Causa provável | O que fazer |
| --- | --- | --- |
| "Nenhum membro ativo disponível neste workspace" | Não há outros usuários ativos | Convide a equipe em **Configurações** da agência |
| Ninguém foi avisado pelo WhatsApp | As pessoas não têm WhatsApp no perfil | Peça para cada uma preencher em **Configurações → Perfil** |
| O agente faz handoff demais | Faltam informações para ele responder sozinho | Envie mais materiais no [briefing](/help/articles/briefing-ensinar-o-negocio-aos-agentes) |
| **Pipeline/estágio humano** mostra "Transferência de oportunidade desativada" | O agente não move a oportunidade no handoff | Normal; a conversa continua sendo transferida |

## Artigos relacionados

- [O que o agente pode fazer no CRM](/help/articles/o-que-o-agente-pode-fazer-no-crm)
- [Ligar o agente aos canais e regras de ativação](/help/articles/ligar-o-agente-aos-canais)
- [Como ler o Analytics do LeadFlow](/help/articles/como-ler-o-analytics-do-leadflow)
