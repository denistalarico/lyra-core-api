---
systemKey: automations-webhooks
slug: webhooks-saida-automacoes
title: 'Webhooks de saída'
summary: 'Envie eventos de uma automação para um sistema externo com URL, método, campos e política de tentativa controlados.'
categoryKey: leadflow
moduleKey: leadflow-automations
productKey: lyra-leadflow
trailKeys: [automacoes-e-followup]
order: 34
version: 1
locale: pt-BR
status: published
isFeatured: false
searchable: true
estimatedMinutes: 6
tags: [webhook, integração, automações, url, retry]
---

Um webhook de saída avisa um sistema externo quando a automação executa um evento configurado.

## Antes de configurar

Peça ao responsável pelo sistema externo:

- uma URL HTTPS própria para receber o evento;
- o método esperado;
- quais campos podem ser enviados;
- como o destino responde em caso de sucesso;
- uma credencial exclusiva, quando necessária.

> **[Owner/manager]** Webhooks podem enviar dados para fora do Lyra. Use somente destinos aprovados pela empresa e envie o mínimo necessário.

## Configurar

1. Abra **LeadFlow → Automações** e entre na receita.
2. Abra a seção **Webhook**.
3. Ative o webhook.
4. Informe URL e método.
5. Selecione eventos e campos do payload.
6. Configure tentativas e intervalo de nova tentativa quando oferecidos.
7. Informe o segredo somente no campo próprio.
8. Salve e faça um teste controlado.

## O que revisar

| Item | Regra prática |
| --- | --- |
| URL | HTTPS e ambiente correto |
| Campos | Somente o necessário para a integração |
| Segredo | Nunca em mensagem, nome, URL ou documentação |
| Tentativas | Suficientes para falhas transitórias, sem criar tempestade |
| Resposta | O destino deve responder no formato esperado |

## Problemas comuns

| O que acontece | O que fazer |
| --- | --- |
| O webhook falha sempre | Confirme URL, método e resposta do destino |
| Recebe eventos duplicados | O consumidor deve tratar repetições com segurança |
| O segredo não aparece depois | Comportamento esperado; preencha novamente apenas para trocar |
| Muitos retries | Corrija o destino e desligue temporariamente a automação se necessário |
| O campo desejado não existe | Envie apenas os campos oferecidos; não coloque dados extras em texto livre |

