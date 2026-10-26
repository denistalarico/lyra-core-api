---
systemKey: crm-pipelines-stages
slug: funis-etapas-crm
title: 'Funis e etapas do CRM'
summary: 'Configure o funil, ordene etapas, proteja ganhos e perdas e defina quais movimentos pessoas e agentes podem fazer.'
categoryKey: leadflow
moduleKey: leadflow-crm
productKey: lyra-leadflow
trailKeys: [primeiros-passos-leadflow, crm-e-funil]
order: 20
version: 1
locale: pt-BR
status: published
isFeatured: true
searchable: true
estimatedMinutes: 7
tags: [crm, funil, pipeline, etapas, transições]
---

O funil transforma o processo comercial em etapas visíveis. Configure-o em **LeadFlow → CRM → Configurações**.

## Partes da configuração

| Seção | O que controla |
| --- | --- |
| **Funil** | Nome, descrição, visibilidade e pessoas autorizadas |
| **Atributos do card** | Informações exibidas nos cards por padrão |
| **Etapas** | Ordem, nome, cor, probabilidade, papel e modo de operação |
| **Transições** | Movimentos permitidos, campos exigidos e atores autorizados |
| **Tags** | Marcadores usados para organizar oportunidades |

> **[Owner/manager]** Alterar estrutura do CRM afeta toda a equipe e os agentes ligados ao funil.

## Configurar o funil

1. Abra **CRM → Configurações → Funil**.
2. Selecione o funil existente ou crie um novo.
3. Informe nome, descrição e visibilidade.
4. Em **Etapas**, adicione as fases comerciais e arraste para ordenar.
5. Marque corretamente a etapa de entrada, a de ganho e a de perda.
6. Em **Transições**, escolha origem, destino, quem pode mover e quais campos são obrigatórios.
7. Salve cada alteração.

Etapas de entrada, ganho e perda são protegidas. Elas representam estados essenciais e não podem ser excluídas como uma etapa comum.

## Uma estrutura simples

| Etapa | Uso sugerido |
| --- | --- |
| Novo lead | Entrada de oportunidades |
| Qualificação | Confirmar necessidade e perfil |
| Proposta | Oferta enviada ou apresentada |
| Negociação | Ajustes antes da decisão |
| Ganho | Venda concluída |
| Perdido | Oportunidade encerrada sem venda |

## Problemas comuns

| O que acontece | O que conferir |
| --- | --- |
| Não consigo excluir uma etapa | Etapas de entrada, ganho e perda são protegidas |
| Um card não pode avançar | Regra de transição, ator permitido e campos obrigatórios |
| O agente não move oportunidades | Modo da etapa, permissão do agente e política de CRM do agente |
| O funil não aparece para alguém | Visibilidade e usuários autorizados |

