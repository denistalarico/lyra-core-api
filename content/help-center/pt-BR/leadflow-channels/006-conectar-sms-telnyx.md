---
systemKey: channel-sms
slug: conectar-sms-telnyx
title: 'Conectar SMS (Telnyx)'
summary: 'Conecte um número Telnyx com sua própria conta, configure os webhooks e trate HELP, STOP e retomada com segurança.'
categoryKey: leadflow-canais
moduleKey: leadflow-channels
productKey: lyra-leadflow
trailKeys: [conectar-canais]
order: 6
version: 1
locale: pt-BR
status: published
isFeatured: false
searchable: true
estimatedMinutes: 7
tags: [sms, telnyx, webhook, help, stop, byo]
---

O canal SMS usa a sua própria conta Telnyx (**BYO**). A chave é validada e armazenada protegida; depois de salvar, ela não volta a ser exibida.

## O que separar antes

- número no formato internacional, como `+5511999999999`;
- **Chave de API** da Telnyx;
- **Messaging profile ID** vinculado ao número;
- **Chave pública** usada para validar webhooks;
- texto opcional da resposta a **HELP**.

> **[Owner/manager]** Só quem administra canais deve inserir ou trocar essas credenciais. Nunca cole chaves em chats, artigos ou chamados.

## Conectar o número

1. Abra **LeadFlow → Inbox → Configurações → Apps & Integrações → SMS → Configurar**.
2. Clique em **Conectar número**.
3. Mantenha o provedor **Telnyx** selecionado.
4. Preencha **Número (E.164)**, **Nome do canal**, **Chave de API**, **Messaging profile ID** e **Chave pública (webhooks)**.
5. Revise a **Resposta ao HELP**.
6. Clique em **Conectar** e aguarde a validação.
7. Copie as URLs de webhook mostradas pelo Lyra para a configuração do número na Telnyx.
8. Use **Testar conexão**.

## Consentimento por SMS

As palavras de saída, como **STOP**, e de retomada são tratadas automaticamente. A resposta a **HELP** pode ser ajustada depois pela ação **Resposta ao HELP**.

## Problemas comuns

| O que acontece | O que fazer |
| --- | --- |
| A chave é recusada | Gere ou copie novamente a chave na Telnyx |
| O número é inválido | Use o formato E.164, começando por `+` e código do país |
| Mensagens não chegam ao Lyra | Confira as URLs de webhook e a chave pública |
| A tela diz que a URL pública não está configurada | Peça ao administrador técnico para configurar a URL pública da API |
| Um destinatário escreveu STOP | Respeite o opt-out; não tente contornar o bloqueio |

