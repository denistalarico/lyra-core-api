---
systemKey: operations-room-chat
slug: operations-room-comandos-relatorios-e-alteracoes
title: 'Operations Room: comandos, relatórios e alterações'
summary: 'A Operations Room fica em LeadFlow → Agentes. No chat você pede KPIs, conversas, handoffs e relatórios (ex.: /kpi, /relatorio) e propõe alterações como feriado ou vaga esgotada, que só valem depois de Revisar e confirmar.'
categoryKey: leadflow
moduleKey: leadflow-agents
productKey: lyra-leadflow
trailKeys: [agentes-e-operations-room]
order: 15
version: 1
locale: pt-BR
status: published
isFeatured: false
searchable: true
estimatedMinutes: 7
tags: [operations room, sala, chat, comandos, kpi, relatório, feriado, proposta, confirmar alteração]
---

A **Operations Room** é a sala da sua equipe de agentes. Você vê os agentes trabalhando, acompanha o status de cada um e conversa com eles por chat para consultar números ou avisar mudanças da operação, como um feriado ou uma agenda lotada.

## Em resumo

- Fica em **LeadFlow → Agentes** e também aparece na **Área do Cliente**, para clientes com acesso a Agentes.
- À direita, a lista mostra o **Orion** (sempre primeiro, com o selo **Assistente**) e os **Agentes configurados**.
- No chat, digite **/** para ver os atalhos ou escreva normalmente ("como estamos hoje?").
- Consultas respondem na hora. **Alterações viram proposta** e só valem depois de **Revisar e confirmar**.

## Conversar com um agente

1. Abra **LeadFlow → Agentes**.
2. Clique em um agente na lista (ou no personagem na sala). O chat passa a falar com ele.
3. Escreva no campo **Pergunte algo ou digite / para ver os atalhos**.
4. Para começar do zero, use **Limpar conversa**.

> **Nota:** a conversa fica guardada enquanto a aba do navegador estiver aberta. Ao fechar a aba, o histórico do chat recomeça. As alterações confirmadas ficam registradas no histórico operacional.

## Atalhos de consulta

| Atalho | O que mostra | Exemplo de frase |
| --- | --- | --- |
| `/kpi` | Resumo dos indicadores principais | "Mostre os KPIs de hoje" |
| `/conversas` | Conversas atendidas no período | "Quantas conversas tivemos hoje?" |
| `/agentes` | Ranking dos agentes por conversas e mensagens | "Quem trabalhou mais esta semana?" |
| `/handoffs` | Transferências para a equipe | "Quantos handoffs fizemos este mês?" |
| `/relatorio` | Resumo operacional e comercial | "Gere o relatório geral de hoje" |
| `/sobre` | Quem é o agente, o que faz e em quais canais atende | "O que você faz?" |
| `/ajuda` | Tudo o que a equipe entende | "O que vocês conseguem fazer?" |

Os períodos aceitos: hoje, ontem, anteontem, esta semana, semana passada, este mês, mês passado, últimos 7, 15, 30 ou 90 dias e um mês pelo nome ("em outubro").

## Atalhos de alteração

| Atalho | O que faz | Exemplo de frase |
| --- | --- | --- |
| `/feriado` | Registra um dia sem atendimento | "No próximo feriado não vamos abrir" |
| `/indisponivel` | Avisa que algo esgotou ou lotou (o nome muda com o tipo de negócio) | "As avaliações de sexta acabaram" |
| `/liberar-vaga` | Avisa que algo voltou a ficar disponível | "Liberou uma avaliação sexta às 15h" |
| `/preco`, `/desconto`, `/horario` | Organizam a proposta, mas **ainda não aplicam** a mudança | "Altere o plano Premium para R$ 299" |

Os atalhos `/indisponivel` e `/liberar-vaga` aparecem com o rótulo **Do seu modo**, porque dependem do tipo de negócio: em clínicas viram "Agenda clínica lotada", em restaurantes "Reservas esgotadas", no varejo "Produto sem estoque".

## Como uma alteração é confirmada

1. Você escreve o pedido (por exemplo, "dia 15 não vamos abrir").
2. O agente responde com um cartão de **proposta** e o que precisa ser validado.
3. Clique em **Revisar e confirmar** e confira os dados.
4. Responda **Confirmar esta alteração operacional?** confirmando.
5. O cartão muda para **Alteração confirmada**, com autor, horário e revisão registrados.

> **Permissão:** consultar está liberado para quem acessa Agentes. Propor e confirmar alterações exige permissão de configurar agentes. Na Área do Cliente, só o responsável pela empresa ou quem tem nível **Manager** em Agentes **[Owner/manager]**. Sem permissão, o cartão mostra "Você não tem permissão para confirmar esta alteração".

## Pausar ou ativar pelo chat

Com um agente selecionado, escreva "pausa você", "para de responder" ou "pode ativar". O agente mostra um cartão **Pausar agente** (ou **Ativar agente**) e só muda depois de **Revisar e confirmar**.

Para pausar **até uma data** ("pausa a Ana até segunda", "por 2 dias"), quem organiza a proposta é o **Orion**. Se o Orion estiver indisponível, o agente explica e oferece a pausa sem data.

## Quando ninguém entende o pedido

Se o pedido não for reconhecido, a sala mostra os **três atalhos mais próximos**. Quando a IA do Orion está disponível, ele assume e responde ao texto livre. Veja [O que o Orion faz (e o que não faz)](/help/articles/o-que-o-orion-faz).

## Problemas comuns

| O que acontece | Causa provável | O que fazer |
| --- | --- | --- |
| "Escolha um agente na sala para eu consultar o status e os canais dele" | Nenhum agente selecionado | Clique no agente na lista |
| "Seu nível de acesso não permite propor ou confirmar alterações" | Acesso só de consulta | Peça a quem configura os agentes |
| "Complete os dados pendentes para confirmar" | Falta data, horário ou recurso na proposta | Reescreva o pedido com a informação que falta |
| `/preco` não mudou o preço | Preço e horário ainda não são aplicados pelo chat | Altere em **Configurações → Seu agente** |
| A telemetria mostra **Indisponível** | Conexão em tempo real caiu | A sala continua sincronizando; recarregue se persistir |

## Artigos relacionados

- [Comandos e frases que a sala entende sem IA](/help/articles/comandos-e-frases-que-a-sala-entende)
- [Pausar, ativar e excluir agentes](/help/articles/pausar-ativar-e-excluir-agentes)
- [O que o agente pode fazer no CRM](/help/articles/o-que-o-agente-pode-fazer-no-crm)
