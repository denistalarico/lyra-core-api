---
systemKey: agents-channels-activation
slug: ligar-o-agente-aos-canais
title: 'Ligar o agente aos canais e regras de ativação'
summary: 'Na configuração do agente, aba Canais, ligue cada canal e escolha Quando ativar: toda conversa elegível, palavras-chave, anúncio confiável ou só quando alguém ativar. Comentários do Instagram e Facebook têm regra própria.'
categoryKey: leadflow
moduleKey: leadflow-agents
productKey: lyra-leadflow
trailKeys: [agentes-e-operations-room]
order: 12
version: 1
locale: pt-BR
status: published
isFeatured: false
searchable: true
estimatedMinutes: 6
tags: [canais, ativação, palavras-chave, anúncio, comentários, whatsapp, instagram, agente não responde]
---

Um agente ativo só conversa nos canais em que você o **ligar**, e só nas conversas que a **regra de ativação** permitir. Assim, o mesmo agente pode assumir todo o WhatsApp dedicado e, no Instagram, entrar só quando alguém escrever uma palavra-chave.

## Em resumo

- Fica na configuração do agente, aba **Canais**: **LeadFlow → Agentes → ⋮ ao lado do agente → Configurar → Canais**.
- O agente precisa estar **Ativo** para ser ligado a um canal.
- Cada canal tem a sua regra em **Quando ativar**; a regra geral do agente vale quando o canal não tem uma própria.
- Comentários de posts e anúncios (Instagram e Facebook) têm uma regra separada.

## Onde fica

1. Abra **LeadFlow → Agentes**.
2. Na lista ao lado da sala, clique em **⋮** (Opções) no agente e escolha **Configurar**.
3. Abra a aba **Canais**.

Só aparecem canais já conectados ao Inbox. Se a aba mostrar **Nenhum canal ativo**, conecte um canal primeiro em **LeadFlow → Configurações → Apps e integrações → Integrações**.

## As regras de ativação

| Opção em **Quando ativar** | O agente entra quando… | Bom para |
| --- | --- | --- |
| **Em toda nova conversa elegível** | qualquer conversa nova chega ao canal | Número de WhatsApp dedicado ao atendimento automático |
| **Quando identificar palavras-chave** | a mensagem tem uma das palavras ou frases cadastradas | Instagram, onde nem toda mensagem é comercial |
| **Quando vier de um anúncio confiável** | o lead chega por um anúncio identificado | Campanhas de clique para mensagem |
| **Somente quando alguém ativar** | uma pessoa da equipe aciona o agente na conversa | Canais em que a equipe atende primeiro |

Com **palavras-chave**, escolha também a **Forma de comparação**:

| Forma | Exemplo com a palavra "preço" |
| --- | --- |
| **Palavra exata** | Entra em "qual o preço?"; não entra em "precificação" |
| **Mensagem contém a frase** | Entra quando a frase aparece em qualquer parte da mensagem |

## Passo a passo

1. Na aba **Canais**, use a chave **Ligar canal** em cada canal desejado.
2. Defina a regra geral em **Quando ativar** (vale para os canais sem regra própria).
3. Para uma regra diferente em um canal, clique em **Configurar regra de ativação deste canal** e escolha a opção.
4. Se escolher palavras-chave, preencha **Palavras ou frases** e a **Forma de comparação**.
5. Salve.

## Comentários do Instagram e do Facebook

Em **Quando ativar em comentários** você decide se o agente responde comentários:

| Opção | Efeito |
| --- | --- |
| **Desligado** | O agente não age em comentários |
| **Palavras-chave** | Age quando o comentário tem uma das palavras ou frases |
| **Comentário em anúncio** | Age em comentários feitos em anúncios |

A **Resposta pública opcional** é o texto que o agente deixa no próprio comentário (por exemplo, "Te chamei no direct!") antes de continuar a conversa no privado.

> **Atenção:** o agente para de responder quando uma pessoa da equipe assume a conversa no Inbox. Isso evita duas respostas para o mesmo lead.

## Problemas comuns

| O que acontece | Causa provável | O que fazer |
| --- | --- | --- |
| "Ative o agente antes de ligá-lo a um canal" | Agente em **Rascunho** ou **Pausado** | Clique em **Ativar** no topo da configuração |
| "Nenhum canal ativo" | Nenhuma integração conectada ao Inbox | Conecte um canal em **Configurações → Apps e integrações** |
| O canal aparece como **Em atualização** | A conexão do canal está sendo renovada | Aguarde; se persistir, reconecte o canal |
| O agente não responde no Instagram | Regra por palavra-chave e a mensagem não tinha a palavra | Revise as palavras ou use **Em toda nova conversa elegível** |
| O agente respondeu um cliente antigo | **Quem este agente atende?** inclui clientes | Ajuste para **Apenas novos leads** na aba **Avatar** |

## Artigos relacionados

- [Handoff: quando o agente passa para uma pessoa](/help/articles/handoff-quando-o-agente-passa-para-uma-pessoa)
- [Pausar, ativar e excluir agentes](/help/articles/pausar-ativar-e-excluir-agentes)
- [Criar um agente a partir de um modelo](/help/articles/criar-um-agente-a-partir-de-um-modelo)
