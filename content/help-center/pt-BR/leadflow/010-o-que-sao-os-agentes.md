---
systemKey: agents-overview
slug: o-que-sao-os-agentes-do-leadflow
title: 'O que são os agentes e quais tipos existem'
summary: 'Agentes são assistentes de IA que atendem leads nos canais do LeadFlow com as informações do seu negócio. Há tipos como Recepção, Qualificação, Agendamento, Consultor comercial, Atendimento e Concierge. Ficam em LeadFlow → Agentes.'
categoryKey: leadflow
moduleKey: leadflow-agents
productKey: lyra-leadflow
trailKeys: [primeiros-passos-leadflow, agentes-e-operations-room]
order: 10
version: 1
locale: pt-BR
status: published
isFeatured: false
searchable: true
estimatedMinutes: 5
tags: [agentes, agente de ia, tipos de agente, recepção, qualificação, agendamento, status do agente]
---

Um **agente** é um assistente de IA que conversa com os seus leads nos canais do LeadFlow (WhatsApp, Instagram, Messenger, Webchat, SMS). Ele usa as informações do negócio que você confirmou, segue as regras que você definiu e chama uma pessoa da equipe quando precisa.

## Em resumo

- Ficam em **LeadFlow → Agentes**, na **Operations Room**: a sala onde a equipe de agentes aparece trabalhando, com a lista ao lado e o chat.
- Cada agente tem um **tipo** (a função dele), **canais** em que atende, regras de **CRM** e de **handoff**.
- Um agente só atende quando está **Ativo** e ligado a pelo menos um canal.
- O **Orion** também aparece na sala, mas **não é um agente**: é o assistente da plataforma e não atende leads.

## Tipos de agente

| Tipo | Função principal | Exemplo de uso |
| --- | --- | --- |
| **Recepção** | Recebe o contato, entende o pedido e encaminha | Primeiro atendimento no WhatsApp |
| **Qualificação** | Faz as perguntas que separam curiosos de compradores | Leads vindos de anúncio |
| **Agendamento** | Oferece horários e marca compromissos | Clínicas, consultorias, visitas |
| **Consultor comercial** | Apresenta ofertas, tira dúvidas e conduz à venda | Planos, pacotes, orçamentos |
| **Atendimento** | Responde dúvidas de quem já é cliente | Suporte e pós-venda |
| **Concierge** | Atendimento cuidadoso e personalizado | Hotelaria, eventos, alto padrão |
| **Customizado** | Função definida por você | Casos que não se encaixam acima |

Os modelos oferecidos em **Novo agente** dependem do **tipo de negócio** escolhido em **Configurações**. Um agente criado a partir de um modelo mostra a origem **Modelo Lyra**; um agente alterado a fundo vira **Personalizado**.

## Status do agente

| Status | O que significa | Atende leads? |
| --- | --- | --- |
| **Rascunho** | Recém-criado, ainda não ativado | Não |
| **Ativo** | Em operação nos canais ligados | Sim |
| **Pausado** | Fora de operação, com toda a configuração preservada | Não |
| **Pausado até 03/11, 08:00** | Pausa com data: volta a **Ativo** sozinho no horário indicado | Não, até a data |
| **Arquivado** | Retirado da operação | Não |

## Prontidão

Na configuração do agente, o indicador de prontidão mostra se falta algo: **Pronto**, **Quase pronto** ou **Incompleto**. Os motivos mais comuns de "Incompleto" são falta de canal ligado e informações do negócio não confirmadas.

## O que o agente faz e o que não faz

| Faz | Não faz |
| --- | --- |
| Responde com as informações confirmadas do negócio | Inventa preço, prazo ou condição que não está cadastrada |
| Faz perguntas de qualificação | Envia mensagens fora das regras de ativação do canal |
| Cria e avança oportunidades no CRM, se você permitir | Altera finanças, usuários ou permissões |
| Chama uma pessoa (handoff) quando precisa | Continua respondendo depois que a equipe assumiu a conversa |
| Se apresenta como assistente virtual, do jeito que você definir | Finge ser uma pessoa |

> **Nota:** o **Avatar 05** é reservado ao Orion. Os agentes usam os demais avatares.

## Problemas comuns

| O que acontece | Causa provável | O que fazer |
| --- | --- | --- |
| "Nenhum agente provisionado" | A empresa ainda não tem agentes | Use **Novo agente**; veja [Criar um agente a partir de um modelo](/help/articles/criar-um-agente-a-partir-de-um-modelo) |
| "Nenhum preset disponível para o Business Mode ativo" | Nenhum tipo de negócio escolhido, ou o tipo não tem modelos | Escolha o tipo em **Configurações → Visão geral** |
| Não vejo o botão **Novo agente** | O seu acesso não permite criar agentes | Peça ao administrador do LeadFlow |
| O agente está **Ativo** mas não responde | Nenhum canal ligado ou regra de ativação manual | Veja [Ligar o agente aos canais](/help/articles/ligar-o-agente-aos-canais) |

## Artigos relacionados

- [Criar um agente a partir de um modelo](/help/articles/criar-um-agente-a-partir-de-um-modelo)
- [Operations Room: comandos, relatórios e alterações](/help/articles/operations-room-comandos-relatorios-e-alteracoes)
- [O que o Orion faz (e o que não faz)](/help/articles/o-que-o-orion-faz)
