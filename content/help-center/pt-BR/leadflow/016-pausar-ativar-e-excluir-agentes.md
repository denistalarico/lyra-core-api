---
systemKey: agents-pause-activate
slug: pausar-ativar-e-excluir-agentes
title: 'Pausar, ativar, arquivar e excluir agentes'
summary: 'Em LeadFlow → Agentes, use o menu ⋮ do agente para Pausar, Ativar ou Excluir agente. Pausar preserva tudo; a pausa com data volta sozinha. A exclusão é bloqueada se houver conversas em andamento.'
categoryKey: leadflow
moduleKey: leadflow-agents
productKey: lyra-leadflow
trailKeys: [agentes-e-operations-room]
order: 16
version: 1
locale: pt-BR
status: published
isFeatured: false
searchable: true
estimatedMinutes: 5
tags: [pausar agente, ativar agente, excluir agente, arquivar, pausa com data, desligar agente]
---

Você pode tirar um agente de operação a qualquer momento sem perder a configuração. Pausar é a forma mais segura; excluir é definitivo.

## Em resumo

- **Pausar**: o agente para de atender e mantém tudo configurado.
- **Pausar até uma data**: peça ao Orion na Operations Room; o agente volta a **Ativo** sozinho no horário marcado.
- **Ativar**: o agente volta a atender nos canais ligados.
- **Excluir agente**: retira o agente da operação e dos canais. É bloqueado se houver conversas em andamento.

## Onde fica

| Ação | Onde |
| --- | --- |
| Pausar / Ativar | Menu **⋮** do agente na lista da sala, botão no painel do agente ou botão no topo da configuração |
| Pausar até uma data | Chat da **Operations Room**, falando com o **Orion** |
| Excluir agente | Menu **⋮** do agente na lista da sala |

## Pausar ou ativar

1. Abra **LeadFlow → Agentes**.
2. Na lista ao lado da sala, clique em **⋮** no agente.
3. Escolha **Pausar** (agente ativo) ou **Ativar** (agente pausado ou em rascunho).

O status muda na hora na lista, na sala e na configuração do agente.

## Pausar até uma data

1. Na **Operations Room**, selecione o **Orion**.
2. Escreva, por exemplo: "pausa a Ana até segunda às 8h" ou "pausa o agente de recepção por 2 dias".
3. Confira o cartão da proposta e clique em **Revisar e confirmar**.

O agente aparece como **Pausado até** a data escolhida e volta a **Ativo** sozinho, em até um minuto depois do horário. Se quem confirmou a pausa é da equipe da agência, recebe uma notificação quando ela termina.

> **Dica:** a pausa com data aceita até 90 dias. Pausar ou ativar manualmente antes do fim cancela a data marcada.

## Excluir um agente

1. Clique em **⋮** no agente e escolha **Excluir agente**.
2. Leia o aviso: "O agente será retirado da operação e dos canais vinculados. A exclusão será bloqueada se houver conversas em andamento."
3. Confirme em **Excluir**.

> **Atenção:** prefira **Pausar** se houver chance de usar o agente de novo. A exclusão não pode ser desfeita.

## Arquivar

O arquivamento existe para agentes que saíram de operação, mas **não aparece no menu da sala nesta versão**. Para tirar um agente de operação sem perdê-lo, use **Pausar**.

## Agentes que não podem ser alterados

| Caso | O que acontece |
| --- | --- |
| Agente protegido | Não tem a opção **Excluir agente** |
| **Orion** | Não pode ser pausado, ativado, editado nem excluído: é o assistente da plataforma, não um agente |
| Acesso só de consulta | O menu **⋮** não mostra as ações |

> **Permissão:** pausar, ativar e excluir exigem permissão de gerenciar agentes. Na Área do Cliente, só o responsável pela empresa ou quem tem nível **Manager** em Agentes **[Owner/manager]**.

## Problemas comuns

| O que acontece | Causa provável | O que fazer |
| --- | --- | --- |
| "Seu nível de acesso não permite alterar este agente" | Acesso de consulta | Peça a quem gerencia os agentes |
| A exclusão foi recusada | Há conversas em andamento com o agente | Encerre ou transfira as conversas e tente de novo, ou apenas pause |
| "Para pausar até uma data, preciso do Orion" | O Orion está indisponível no momento | Pause sem data e reative depois |
| Ativei, mas o agente não responde | Nenhum canal ligado | Veja [Ligar o agente aos canais](/help/articles/ligar-o-agente-aos-canais) |

## Artigos relacionados

- [Operations Room: comandos, relatórios e alterações](/help/articles/operations-room-comandos-relatorios-e-alteracoes)
- [O que são os agentes e quais tipos existem](/help/articles/o-que-sao-os-agentes-do-leadflow)
