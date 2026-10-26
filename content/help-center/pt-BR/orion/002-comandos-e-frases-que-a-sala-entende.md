---
systemKey: orion-commands
slug: comandos-e-frases-que-a-sala-entende
title: 'Comandos e frases que a sala entende sem IA'
summary: 'A Operations Room entende atalhos com / e frases comuns, como "como estamos?", "teve lead hoje?", "quem atendeu mais?", "pausa você" e "semana passada", sem usar IA e sem custo. O que não for entendido vai para o Orion com IA, quando disponível.'
categoryKey: orion
moduleKey: orion
productKey: lyra-agency
trailKeys: [conhecendo-o-orion]
order: 2
version: 1
locale: pt-BR
status: published
isFeatured: false
searchable: true
estimatedMinutes: 5
tags: [comandos, atalhos, frases, sem ia, vocabulário, período, operations room, orion]
---

A Operations Room tenta entender o seu pedido **antes** de usar IA. Atalhos com `/` e frases comuns do dia a dia são respondidos na hora, **sem custo** e mesmo quando o limite mensal de IA já foi atingido.

## Em resumo

- Digite **/** no chat para ver todos os atalhos, ou escreva do seu jeito.
- A sala reconhece sinônimos: "como estamos?", "números de hoje" e "/kpi" levam à mesma resposta.
- Datas também são entendidas: "ontem", "semana passada", "últimos 15 dias", "em outubro".
- Se a frase não for reconhecida, a sala sugere os **três atalhos mais próximos**; com a IA disponível, o **Orion** responde ao texto livre.

## Frases que a sala entende

| Você quer | Frases que funcionam | Atalho |
| --- | --- | --- |
| Visão geral dos números | "como estamos?", "como estão as coisas?", "resultados", "resumo do dia", "painel" | `/kpi` |
| Volume de conversas | "teve lead hoje?", "entrou lead?", "chegou alguém?", "quantas pessoas?", "atendimentos" | `/conversas` |
| Desempenho dos agentes | "quem atendeu mais?", "melhor agente", "ranking", "produtividade" | `/agentes` |
| Transferências para a equipe | "passou para humano", "pediu atendente", "escalou", "encaminhou para a equipe" | `/handoffs` |
| Relatório | "relatório", "resumo da semana", "fechamento do mês", "me manda um resumo" | `/relatorio` |
| Dia fechado | "não vamos abrir", "feriado", "recesso", "não teremos expediente" | `/feriado` |
| Algo esgotou | "acabou", "esgotou", "lotou", "sem estoque", "sem vaga" | `/indisponivel` |
| Algo voltou | "voltou", "chegou", "liberou", "reabriu", "tem vaga de novo" | `/liberar-vaga` |
| Conhecer o agente | "quem é você?", "o que você faz?", "quais canais você atende?" | `/sobre` |
| Ajuda | "ajuda", "comandos", "o que dá pra fazer?", "não sei usar" | `/ajuda` |

## Conversa do dia a dia

| Você escreve | A sala responde |
| --- | --- |
| "bom dia", "oi", "olá" | Cumprimenta pelo seu nome e sugere dois atalhos |
| "obrigado", "valeu", "show" | Uma resposta curta |
| "você está ativo?", "está pausado?" | O status e os canais do agente selecionado |
| "pausa você", "para de responder", "pode ativar" | Um cartão para confirmar a pausa ou a ativação |

> **Nota:** pedir ao **Orion** para se pausar ou se ativar é recusado: ele é o assistente da plataforma e está sempre disponível.

## Períodos reconhecidos

| Você escreve | Período usado |
| --- | --- |
| "hoje", "ontem", "anteontem" | O dia indicado |
| "esta semana", "semana passada" | A semana indicada |
| "este mês", "mês passado" | O mês indicado |
| "últimos 7 dias" (também 15, 30 ou 90) | Os últimos N dias até agora |
| "em outubro" | A ocorrência mais recente do mês citado |

Sem período na frase, a sala usa **hoje**.

## Quando a frase não é entendida

1. A sala responde: "ainda não entendi esse pedido com segurança" e mostra as três opções mais próximas.
2. Se a IA do Orion estiver disponível, o pedido segue para ele, que responde em texto livre com o selo **Resposta com IA**.
3. Se a IA estiver indisponível ou o limite tiver sido atingido, os atalhos e as frases desta página continuam funcionando normalmente.

> **Dica:** para economizar o limite de IA da conta, prefira os atalhos e as frases desta tabela nas consultas do dia a dia. Deixe o texto livre para dúvidas sobre o Lyra e perguntas mais elaboradas.

## Problemas comuns

| O que acontece | Causa provável | O que fazer |
| --- | --- | --- |
| Pedi números de "dezembro" e veio o ano passado | A sala usa a ocorrência mais recente do mês, e ele ainda não chegou neste ano | Use "mês passado" ou "últimos 30 dias" |
| A sala sugeriu atalhos em vez de responder | A frase não bateu com nenhum grupo com segurança | Use um dos atalhos sugeridos |
| "Escolha o agente que você quer pausar ou ativar" | Nenhum agente selecionado | Clique no agente na lista antes de pedir |

## Artigos relacionados

- [Operations Room: comandos, relatórios e alterações](/help/articles/operations-room-comandos-relatorios-e-alteracoes)
- [O que o Orion faz (e o que não faz)](/help/articles/o-que-o-orion-faz)
