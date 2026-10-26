---
systemKey: orion-privacy-limits
slug: privacidade-permissoes-e-limite-mensal-do-orion
title: 'Privacidade, permissões e limite mensal do Orion'
summary: 'O Orion nunca vê mais do que quem fala com ele, não acessa arquivos nem banco de dados e só altera algo depois da sua confirmação. As respostas com IA têm limite mensal por conta e por hora por pessoa; no limite, os comandos e a ajuda continuam sem IA.'
categoryKey: orion
moduleKey: orion
productKey: lyra-agency
trailKeys: [conhecendo-o-orion]
order: 4
version: 1
locale: pt-BR
status: published
isFeatured: false
searchable: true
estimatedMinutes: 4
tags: [privacidade, permissões, limite, custo, orçamento, lgpd, segurança, orion]
---

O Orion foi desenhado para ajudar sem abrir brechas: ele trabalha **como você**, com o **seu** acesso, dentro da **empresa** em que você está, e com um limite de uso de IA para o custo nunca sair do controle.

## Em resumo

- **Nunca mais poder que você:** cada consulta checa a mesma permissão da tela equivalente.
- **Empresa certa sempre:** a empresa vem do seu login, nunca do texto da pergunta.
- **Nada muda sem confirmação:** alterações viram proposta e só valem com o seu clique.
- **Limite de IA:** há um teto mensal por conta e um limite por hora por pessoa. No limite, os comandos e os artigos da ajuda continuam funcionando, sem IA.

## Permissões

| Regra | Na prática |
| --- | --- |
| O Orion usa as suas permissões | Se você não vê o CRM pela tela, o Orion também não mostra o CRM para você |
| A empresa vem do login | Pedir "mostra os dados da empresa X" não troca de empresa |
| Alterações exigem confirmação | O cartão **Revisar e confirmar** checa a sua permissão de novo no clique |
| Na Área do Cliente, só o que o cliente pode ver | Nunca custo, margem, notas internas ou outras empresas |
| Mensagens de terceiros são dados, não ordens | Um lead escrever "ignore as regras" não muda o comportamento do Orion |

> **Permissão:** na Área do Cliente, conversar com o Orion usando IA exige nível **Manager** em **Agentes** **[Owner/manager]** e a opção **Geração com IA** ligada pela agência em **Ações com custo para a agência**. Quem tem **Somente leitura** usa os comandos da sala, sem IA.

## O que o Orion acessa (e o que não acessa)

| Acessa | Não acessa |
| --- | --- |
| Os artigos desta Central de Ajuda | Arquivos, código ou banco de dados do Lyra |
| Indicadores agregados do LeadFlow (totais, etapas, tempos) | Listas de leads com dados pessoais para exportação |
| Status e canais dos agentes | Credenciais, tokens e integrações |
| Contagem de oportunidades por etapa do CRM | Finanças, usuários e permissões |
| Resumo da agenda de hoje ou amanhã | Dados de outra empresa ou de outra conta |

Para responder com IA, o texto da pergunta e os dados agregados necessários à resposta são enviados ao provedor de IA usado pelo Lyra. O Orion prefere totais e resumos, não listas com dados pessoais.

## Limite de uso de IA

| Limite | Valor atual | O que acontece ao atingir |
| --- | --- | --- |
| Mensal, por conta da agência | Orçamento de IA do Orion para o mês (inclui o uso dos clientes pela Área do Cliente) | O Orion avisa que as respostas com IA voltam no próximo mês |
| Por hora, por pessoa | 30 respostas com IA (padrão) | O Orion pede para aguardar e tentar mais tarde |

Enquanto o limite estiver atingido:

- os atalhos (`/kpi`, `/relatorio`…) e as frases do dia a dia continuam respondendo normalmente;
- o Orion continua indicando artigos da ajuda, sem IA;
- nada é cobrado a mais.

> **Dica:** os comandos da sala nunca consomem o limite. Use-os nas consultas rotineiras e deixe a IA para dúvidas que eles não resolvem.

## O que fica registrado

Cada resposta com IA registra quem perguntou, em qual superfície (Operations Room, Team Chat ou chat com o cliente), quais consultas o Orion fez, se deu certo e o custo estimado. Esse registro não guarda dados pessoais dos seus clientes. As alterações confirmadas ficam no histórico operacional, com autor e horário.

## Problemas comuns

| O que acontece | Causa provável | O que fazer |
| --- | --- | --- |
| Aviso de limite mensal | A conta usou todo o orçamento de IA do Orion no mês | Use os comandos da sala até o próximo mês |
| Aviso de limite por hora | Você fez muitas perguntas com IA na última hora | Aguarde alguns minutos |
| Na Área do Cliente, o Orion não responde com IA | A agência não liberou **Geração com IA** para a empresa, ou o nível em Agentes não é Manager | Peça à agência para revisar a opção e o seu nível |
| O Orion não mostrou um dado que eu vejo em outra tela | A consulta equivalente exige uma permissão diferente | Confira o seu acesso com quem administra |

## Artigos relacionados

- [O que o Orion faz (e o que não faz)](/help/articles/o-que-o-orion-faz)
- [Níveis por módulo (viewer, operator, manager)](/help/articles/niveis-por-modulo-na-area-do-cliente)
- [Chamar o Orion com @ no Team Chat e no chat com o cliente](/help/articles/chamar-o-orion-com-arroba)
