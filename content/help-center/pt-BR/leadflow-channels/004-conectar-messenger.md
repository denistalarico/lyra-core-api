---
systemKey: channel-messenger
slug: conectar-messenger
title: 'Conectar o Messenger'
summary: 'Conecte uma Página do Facebook ao Messenger, escolha o ativo correto e valide o recebimento de mensagens no LeadFlow.'
categoryKey: leadflow-canais
moduleKey: leadflow-channels
productKey: lyra-leadflow
trailKeys: [conectar-canais]
order: 4
version: 1
locale: pt-BR
status: published
isFeatured: false
searchable: true
estimatedMinutes: 5
tags: [messenger, facebook, página, meta, canal]
---

O Messenger conecta uma **Página do Facebook** ao Inbox do LeadFlow.

## Conectar a Página

1. Abra **LeadFlow → Inbox → Configurações → Apps & Integrações → Messenger → Configurar**.
2. Escolha **Conectar com Facebook**.
3. Autorize a conta na janela da Meta.
4. Em **Selecione uma Página**, escolha a Página marcada como **Disponível para mensagens**.
5. Clique em **Conectar**.
6. Quando a Página aparecer na lista, use **Testar conexão**.

> **[Owner/manager]** A conexão e o ciclo de vida do canal exigem acesso de gestão.

## Escolher a Página certa

| Estado mostrado | Significado |
| --- | --- |
| **Disponível para mensagens** | Pode ser conectada ao Messenger |
| **Sem acesso ao Messenger** | A conta usada não tem o acesso necessário àquela Página |

Depois, ligue o canal ao agente em **LeadFlow → Agentes → configurar agente → Canais**. Comentários do Facebook têm regra própria nessa aba.

## Administrar a conexão

Use **Renomear**, **Atualizar status**, **Testar conexão**, **Pausar/Retomar**, **Reconectar** e **Desconectar** conforme o estado exibido. Pausar é temporário; desconectar encerra o vínculo.

## Problemas comuns

| O que acontece | O que fazer |
| --- | --- |
| Nenhuma Página elegível aparece | Entre com uma conta que administre a Página e tenha acesso a mensagens |
| A sessão expirou | Feche a seleção e inicie a conexão novamente |
| O pop-up não abre | Permita pop-ups para o Lyra |
| O teste falha | Atualize o status e use **Reconectar** |
| A mensagem chega, mas o agente não entra | Revise a regra de ativação do canal no agente |

