---
systemKey: client-area-module-levels
slug: niveis-por-modulo-na-area-do-cliente
title: 'Níveis por módulo (viewer, operator, manager)'
summary: 'Cada pessoa do cliente tem um nível por módulo: Sem acesso, Somente leitura (viewer), Operador (operator) ou Manager. A agência liga os módulos e define o nível padrão em Área do Cliente → Módulos e acessos. Ações com custo de IA ou mídia ficam desligadas até a agência permitir.'
categoryKey: area-do-cliente
moduleKey: client-area
productKey: lyra-agency
trailKeys: [area-do-cliente-para-agencias]
order: 3
version: 1
locale: pt-BR
status: published
isFeatured: false
searchable: true
estimatedMinutes: 6
tags: [níveis, viewer, operator, manager, somente leitura, operador, permissões do cliente, módulos e acessos, custo de ia]
---

Na Área do Cliente, o acesso não é "tudo ou nada". Para **cada módulo** você escolhe o que a pessoa pode fazer. Assim, o diretor do cliente pode aprovar conteúdos e ver o Analytics, enquanto a recepção só opera a agenda.

## Em resumo

- Quatro níveis: **Sem acesso**, **Somente leitura** (*viewer*), **Operador** (*operator*) e **Manager** (*manager*).
- A agência **liga os módulos** de cada empresa e define o **nível padrão do convite**.
- O responsável (*Owner*) tem **Manager** em todos os módulos ligados.
- **Ações com custo para a agência** (IA e mídia) ficam **desligadas por padrão**, mesmo para Manager.

## Os níveis

| Nível | Na tela | O que a pessoa pode fazer |
| --- | --- | --- |
| *none* | **Sem acesso** | Não vê o módulo |
| *viewer* | **Somente leitura** | Vê as informações, sem alterar |
| *operator* | **Operador** | Trabalha no dia a dia: responde, cria e atualiza itens |
| *manager* | **Manager** | Tudo do módulo, incluindo configurar e confirmar alterações |

## Níveis disponíveis em cada módulo

Nem todo módulo tem os quatro níveis:

| Módulo | Níveis possíveis |
| --- | --- |
| **Overview**, **Analytics**, **Configurações** | Somente leitura |
| **Mensagens com a agência**, **Aprovações (Entregas)** | Somente leitura ou Operador |
| **Projetos**, **Planner**, **Estúdio Criativo**, **Inbox**, **CRM**, **Agendamentos** | Somente leitura, Operador ou Manager |
| **Campanhas**, **Agentes** | Somente leitura ou Manager |
| **Faturas e contrato** | Exclusivo do responsável |

## Agentes e Operations Room

| Nível em **Agentes** | Na Operations Room |
| --- | --- |
| **Somente leitura** | Vê a sala, os agentes e os indicadores; usa os comandos de consulta do chat |
| **Manager** **[Owner/manager]** | Também configura, ativa, pausa, cria agentes e confirma propostas; conversa com o Orion usando IA, se **Geração com IA** estiver liberada |

## Passo a passo: ligar módulos e níveis padrão

1. Abra **Área do Cliente** e, no cartão do cliente, clique em **Módulos e acessos** (ou use a aba **Área do Cliente** na página do cliente).
2. Em **Módulos e nível padrão**, ligue cada módulo na coluna **Ligado**.
3. Em **Nível padrão do convite**, escolha o nível que novos convidados recebem.
4. Em **Ações com custo para a agência**, decida se libera **Geração com IA (Estúdio, Planner e Orion)** e **Gasto de mídia (impulsionamento)**.

## Passo a passo: mudar o nível de uma pessoa

1. Em **Usuários ativos**, abra os acessos da pessoa.
2. Ajuste o nível em cada módulo.
3. Salve. A mudança vale no próximo carregamento da Área do Cliente.

> **Importante:** módulos desligados pela agência aparecem bloqueados no editor, com o motivo. Ligar o módulo para a empresa vem antes de dar nível a alguém.

> **Atenção:** **Geração com IA** libera ações que geram custo para a sua agência: criação no Estúdio e no Planner e as respostas com IA do Orion. Ligue só para clientes em que isso faz parte do contrato.

## Problemas comuns

| O que acontece | Causa provável | O que fazer |
| --- | --- | --- |
| "Um dos módulos está desligado pela agência para esta empresa" | Nível dado a um módulo desligado | Ligue o módulo em **Módulos e nível padrão** |
| "Faturas e contrato são exclusivos do responsável" | Tentativa de dar o módulo a um membro | Só o responsável acessa; transfira o papel se necessário |
| Social ou LeadFlow aparecem com "Requer … ativo e aceite do responsável" | Produto inativo para a empresa ou sem aceite | Ative o produto e peça o aceite ao responsável |
| O cliente com Manager não consegue usar o Orion com IA | **Geração com IA** desligada | Ligue em **Ações com custo para a agência** |
| "Somente o responsável gerencia os acessos da empresa" | Um membro tentou mudar acessos pela Área do Cliente | Peça ao responsável ou à agência |

## Artigos relacionados

- [Convidar o cliente e definir o Owner](/help/articles/convidar-o-cliente-e-definir-o-responsavel)
- [Privacidade, permissões e limite mensal do Orion](/help/articles/privacidade-permissoes-e-limite-mensal-do-orion)
- [O que o cliente vê na Área do Cliente](/help/articles/o-que-o-cliente-ve-na-area-do-cliente)
