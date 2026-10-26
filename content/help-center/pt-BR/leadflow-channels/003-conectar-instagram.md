---
systemKey: channel-instagram
slug: conectar-instagram
title: 'Conectar o Instagram (Direct e comentários)'
summary: 'Autorize uma conta profissional do Instagram, teste os webhooks e prepare Direct e comentários para o Inbox e os agentes.'
categoryKey: leadflow-canais
moduleKey: leadflow-channels
productKey: lyra-leadflow
trailKeys: [conectar-canais]
order: 3
version: 1
locale: pt-BR
status: published
isFeatured: false
searchable: true
estimatedMinutes: 5
tags: [instagram, direct, comentários, meta, oauth]
---

O Instagram leva mensagens do **Direct** e comentários compatíveis para o Inbox.

## Conectar a conta

1. Abra **LeadFlow → Inbox → Configurações → Apps & Integrações → Instagram → Configurar**.
2. Clique em **Conectar Instagram**.
3. Em **Escolha como sua conta profissional será conectada**, selecione **Continuar com Instagram**.
4. Autorize a conta profissional na janela aberta.
5. Volte ao Lyra e aguarde a confirmação.
6. Na conta conectada, use **Testar conexão**.

> **[Owner/manager]** Conectar e administrar a conta exige acesso de gestão. A opção **Continuar com Facebook** aparece como **Em breve**; use o login direto do Instagram nesta versão.

## Depois da conexão

| Na tela | Para que serve |
| --- | --- |
| **Renomear canal** | Nome interno da conta no Lyra |
| **Atualizar status** | Recarrega a situação da integração |
| **Testar conexão** | Confere a inscrição necessária para receber eventos |
| **Pausar / Retomar** | Suspende ou reabre o canal sem desconectar |
| **Desconectar** | Encerra o vínculo com a conta |

Para o agente responder, abra **LeadFlow → Agentes → configurar agente → Canais**, ligue o Instagram e escolha a regra para mensagens e comentários.

## Direct e comentários não são a mesma regra

No agente, mensagens privadas seguem **Quando ativar**. Comentários de posts ou anúncios seguem **Quando ativar em comentários** e podem ter uma resposta pública opcional antes da conversa privada.

## Problemas comuns

| O que acontece | O que fazer |
| --- | --- |
| O navegador bloqueia a conexão | Permita pop-ups e tente novamente |
| A conta não aparece | Confirme que é uma conta profissional e que você a administra |
| O teste cita webhooks ausentes | Reconecte para restaurar a inscrição |
| Direct chega, mas o agente não responde | Revise canal ligado, status do agente e regra de ativação |
| Comentários não disparam | Revise **Quando ativar em comentários** na configuração do agente |

