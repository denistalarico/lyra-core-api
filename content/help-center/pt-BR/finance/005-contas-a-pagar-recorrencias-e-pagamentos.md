---
systemKey: finance-bills-recurrences-payments
slug: contas-a-pagar-recorrencias-e-pagamentos
title: "Como registrar contas a pagar, recorrências e pagamentos"
summary: "Como lançar despesas, automatizar contas que se repetem e dar baixa nos pagamentos — alocando ao cliente certo."
categoryKey: finance
moduleKey: finance
productKey: lyra-agency
trailKeys: [primeiros-passos-no-finance, team-e-pagamentos]
order: 5
version: 1
locale: pt-BR
status: published
isFeatured: false
searchable: true
estimatedMinutes: 6
---

## Conta a pagar (bill)

Registre cada despesa como uma conta a pagar, com fornecedor, vencimento, categoria de despesa e — sempre que for custo de um cliente — o **centro de custo do cliente**. Essa alocação é o que transforma a despesa em **custo direto** daquele cliente.

## Recorrências

Para despesas que se repetem (ferramentas, mídia mensal), use **recorrências**: o Lyra gera as contas futuras de forma idempotente, normalmente como *rascunho*, para você revisar antes de confirmar. Assim você não esquece de lançar e não duplica.

## Pagamento (baixa)

Ao pagar, registre o **pagamento** e dê **baixa** na conta. Isso gera o lançamento de saída e movimenta a conta bancária. Estornos revertem o lançamento de forma controlada.

## Boas práticas de alocação

- Custo que é claramente de um cliente → centro de custo daquele cliente.
- Custo geral da agência (sem cliente) → deixe sem centro de custo de cliente; ele entra como despesa, não como custo direto.
