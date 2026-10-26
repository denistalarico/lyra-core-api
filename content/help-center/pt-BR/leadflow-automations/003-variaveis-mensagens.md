---
systemKey: automations-message-variables
slug: variaveis-mensagens-automacoes
title: 'Variáveis nas mensagens (`{{contato.nome}}`)'
summary: 'Personalize mensagens automáticas com dados do contato e saiba como revisar variáveis ausentes antes de ligar a receita.'
categoryKey: leadflow
moduleKey: leadflow-automations
productKey: lyra-leadflow
trailKeys: [automacoes-e-followup]
order: 32
version: 1
locale: pt-BR
status: published
isFeatured: false
searchable: true
estimatedMinutes: 5
tags: [automações, variáveis, mensagens, contato, personalização]
---

Variáveis inserem dados do contexto em uma mensagem. Por exemplo, `{{contato.nome}}` usa o nome salvo no cadastro do contato.

## Onde editar

1. Abra **LeadFlow → Automações**.
2. Abra a receita desejada.
3. Na seção de configuração da mensagem, escreva o texto e insira as variáveis oferecidas pela tela.
4. Salve antes de ativar.

## Regras para uma mensagem segura

| Faça | Evite |
| --- | --- |
| Use apenas variáveis mostradas na configuração | Inventar nomes de variável |
| Escreva uma frase que continue compreensível | Depender de vários campos opcionais |
| Revise o cadastro usado no teste | Usar dados reais em documentação ou treinamento |
| Faça um teste controlado | Ligar para toda a base sem conferir o resultado |

Exemplo:

```text
Olá, {{contato.nome}}. Posso ajudar a retomar o assunto que conversamos?
```

> **Importante:** a variável não adivinha informação. Se o campo não estiver preenchido, a automação pode bloquear a publicação ou usar o comportamento de ausência definido pela receita.

## Checklist antes de ligar

- o texto continua educado em cada etapa;
- as variáveis vêm do seletor da tela;
- o contato de teste tem os dados necessários;
- o canal permite esse tipo de mensagem;
- não há segredo, informação interna ou dado de outra empresa no texto.

## Problemas comuns

| O que acontece | O que fazer |
| --- | --- |
| A variável aparece como texto literal | Insira novamente pelo seletor e confira as chaves duplas |
| O nome fica vazio | Complete o cadastro do contato ou simplifique a mensagem |
| A automação não publica | Resolva as variáveis ou dependências marcadas como pendentes |
| O texto ficou estranho | Teste com nomes curtos, longos e ausentes antes de ativar |

