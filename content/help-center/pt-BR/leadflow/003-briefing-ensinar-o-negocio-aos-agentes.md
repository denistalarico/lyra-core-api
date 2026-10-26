---
systemKey: leadflow-briefing
slug: briefing-ensinar-o-negocio-aos-agentes
title: 'Briefing: ensinar o negócio para os agentes'
summary: 'Em LeadFlow → Configurações → Seu agente, adicione materiais do negócio (texto, URL ou arquivo), revise o que a IA encontrou, clique em Confirmar e preencher e depois em Salvar e aplicar ao agente.'
categoryKey: leadflow
moduleKey: leadflow
productKey: lyra-leadflow
trailKeys: [primeiros-passos-leadflow]
order: 3
version: 1
locale: pt-BR
status: published
isFeatured: false
searchable: true
estimatedMinutes: 6
tags: [briefing, materiais, fontes, site, pdf, informações do agente, treinar agente]
---

O **briefing** é como você ensina o seu negócio aos agentes sem preencher formulário campo a campo. Você envia materiais (o site, um PDF de serviços, um texto com as políticas), a IA lê, sugere as informações e **você confirma** o que entra.

## Em resumo

- Fica em **LeadFlow → Configurações → Seu agente**, no bloco **Materiais do negócio**.
- Aceita três tipos de fonte: **Texto**, **URL** e **Arquivo** (imagem, PDF, PPTX, DOC ou DOCX).
- A IA mostra **O que a IA encontrou**. Nada é aplicado sem a sua confirmação.
- Depois de confirmar, clique em **Salvar e aplicar ao agente** para as conversas passarem a usar as informações.

## Tipos de fonte

| Tipo | Quando usar | O que informar |
| --- | --- | --- |
| **Texto** | Políticas, descrição de serviços, perguntas frequentes | Cole o conteúdo no campo **Conteúdo** |
| **URL** | Site institucional, página de serviços | O **Endereço da página** |
| **Arquivo** | Apresentação, catálogo, tabela de serviços | Imagem, PDF, PPTX, DOC ou DOCX |

## Passo a passo

1. Abra **LeadFlow → Configurações → Seu agente**.
2. Em **Materiais do negócio → Adicionar fonte**, dê um **Nome** (por exemplo, *Site institucional*), escolha o **Tipo** e informe o conteúdo, o endereço ou o arquivo.
3. Clique em **Extrair informações** (ou **Buscar URL e extrair**, ou **Enviar e extrair informações**). A fonte aparece em **Fontes enviadas** com o status da leitura.
4. Quando a leitura terminar, revise **O que a IA encontrou**. Descarte o que estiver errado.
5. Clique em **Confirmar e preencher** (o botão mostra quantos campos serão preenchidos).
6. Confira os campos em **Informações do agente** e clique em **Salvar e aplicar ao agente**.

> **Dica:** comece pelo site e por um documento de serviços com preços. Esses dois materiais costumam preencher a maior parte das informações.

## Status da leitura

| Status | O que significa |
| --- | --- |
| **Na fila** | A fonte foi recebida e aguarda leitura |
| **Lendo conteúdo…** | A IA está extraindo as informações |
| **Leitura concluída** | As sugestões estão em **O que a IA encontrou** |
| **Falhou, será retentada** | Houve um erro temporário; o Lyra tenta de novo sozinho |
| **Falhou definitivamente** | Não foi possível ler; envie a fonte em outro formato |

## O que mandar (e o que evitar)

| Envie | Evite |
| --- | --- |
| Descrição de serviços e preços vigentes | Tabelas de preço antigas |
| Políticas de atendimento, troca, cancelamento | Dados pessoais de clientes |
| Perguntas frequentes e respostas oficiais | Senhas, contratos com valores confidenciais |
| Endereço, áreas atendidas, formas de pagamento | Conversas internas da equipe |

> **Atenção:** tudo o que você confirma pode ser dito pelo agente a qualquer lead. Não confirme informações internas ou que não devam ser públicas.

## Excluir uma fonte

Em **Fontes enviadas**, use **Excluir fonte**. A fonte sai da lista e as sugestões pendentes dela são descartadas. As informações que você já confirmou continuam nos campos; para mudá-las, edite o campo em **Informações do agente**.

## Problemas comuns

| O que acontece | Causa provável | O que fazer |
| --- | --- | --- |
| "Formato não permitido" | Arquivo fora da lista aceita | Envie imagem, PDF, PPTX, DOC ou DOCX |
| A fonte fica muito tempo **Na fila** | A leitura com IA está temporariamente indisponível | Aguarde e use o botão **Atualizar**; se persistir, fale com o suporte |
| "Nada para revisar no momento" | Nenhuma fonte com leitura concluída | Adicione uma fonte e aguarde a leitura |
| O agente ainda não usa a informação | Faltou salvar | Clique em **Salvar e aplicar ao agente** |

## Artigos relacionados

- [Configurar a empresa: tipo de negócio, ofertas e horário](/help/articles/configurar-a-empresa-no-leadflow)
- [O que são os agentes e quais tipos existem](/help/articles/o-que-sao-os-agentes-do-leadflow)
