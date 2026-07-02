---
systemKey: finance-clients-team-overview
slug: como-finance-clients-team-trabalham-juntos
title: "Como o Finance, Clients e Team trabalham juntos no Lyra Agency"
summary: "Entenda como os módulos Finance, Clients e Team se conectam para calcular receita, custos, mão de obra e rentabilidade dos clientes."
categoryKey: primeiros-passos
moduleKey: finance
productKey: lyra-agency
trailKeys: [primeiros-passos-no-finance, rentabilidade-de-clientes]
order: 1
version: 1
locale: pt-BR
status: published
isFeatured: true
searchable: true
estimatedMinutes: 7
---

## Visão geral

O Lyra Agency calcula a rentabilidade dos clientes conectando informações de três módulos principais:

1. **Finance**, onde ficam faturas, contas a pagar, pagamentos, categorias, centros de custo, lançamentos e DRE.
2. **Clients**, onde ficam os clientes, projetos, atividades e a aba de rentabilidade.
3. **Team**, onde ficam os colaboradores, contractors, freelancers, custo por hora e registros de tempo.

Quando esses módulos são usados corretamente, o Lyra consegue responder perguntas como:

- Qual cliente gera mais receita?
- Qual cliente consome mais tempo da equipe?
- Qual cliente tem maior custo direto?
- Qual cliente parece bom no faturamento, mas ruim na margem?
- Quanto a agência lucrou no período?
- Quais despesas estão afetando a DRE?

## A lógica principal

A rentabilidade do cliente depende de três blocos:

```text
Receita
- Custo direto
- Mão de obra
= Lucro direto
```

A partir disso, o Lyra calcula:

```text
Margem direta = Lucro direto ÷ Receita × 100
```

Exemplo:

```text
Receita do cliente: R$ 2.000
Custo direto: R$ 300
Mão de obra: R$ 500

Lucro direto:
R$ 2.000 - R$ 300 - R$ 500 = R$ 1.200

Margem direta:
R$ 1.200 ÷ R$ 2.000 × 100 = 60%
```

## O papel do Finance

O Finance é a base dos documentos e lançamentos financeiros.

É nele que você registra:

- faturas de clientes;
- contas a pagar;
- pagamentos;
- recebimentos;
- recorrências;
- contas bancárias;
- categorias;
- centros de custo;
- plano de contas;
- diários;
- lançamentos;
- relatórios;
- DRE Gerencial.

Quando uma fatura é confirmada, o Lyra reconhece a receita.

Quando uma conta a pagar é confirmada, o Lyra reconhece o custo ou despesa.

Quando um pagamento é registrado, o Lyra baixa o valor em aberto.

Na maioria dos casos, o usuário não precisa criar lançamentos manualmente. O sistema gera os lançamentos a partir dos documentos financeiros.

## O papel do Clients

O módulo Clients centraliza a visão de cada cliente.

Nele você acompanha:

- dados do cliente;
- contratos;
- projetos;
- tarefas;
- atividades;
- faturas;
- custos;
- horas consumidas;
- rentabilidade.

Para medir corretamente a rentabilidade, cada cliente deve ter um **centro de custo** próprio.

Exemplo:

```text
Cliente: Reino das Crianças
Centro de custo: Cliente — Reino das Crianças
```

Esse centro de custo permite que o Lyra identifique quais receitas e custos pertencem àquele cliente.

## O papel do Team

O Team controla os custos da equipe.

Nele você configura:

- custo por hora;
- custo mensal;
- horas contratadas;
- tipo de vínculo;
- dados de pagamento;
- competências;
- benefícios;
- descontos;
- bônus;
- regras financeiras.

Essas informações são usadas de duas formas:

1. para gerar contas a pagar de colaboradores, contractors e freelancers;
2. para calcular a mão de obra consumida pelos clientes.

Exemplo:

```text
Membro: Ana
Custo por hora: R$ 50
Tempo registrado em tarefa do Cliente X: 4 horas

Mão de obra do Cliente X:
4 × R$ 50 = R$ 200
```

## Como a receita entra na rentabilidade

A receita vem das faturas confirmadas do cliente.

Exemplo:

```text
Cliente: Orenda Biotech
Fatura confirmada: R$ 2.500
```

Essa fatura entra como receita do cliente no período correspondente.

Faturas em rascunho não entram nos relatórios de receita.

## Como o custo direto entra na rentabilidade

Custo direto é o gasto claramente relacionado a um cliente.

Exemplos:

- freelancer contratado para um cliente;
- ferramenta exclusiva de um cliente;
- hospedagem exclusiva de um cliente;
- produção audiovisual de um projeto específico;
- compra feita para atender um cliente específico.

Para o custo entrar na rentabilidade do cliente, a conta a pagar deve estar vinculada ao centro de custo do cliente.

Exemplo:

```text
Conta a pagar: Freelancer de design
Centro de custo: Cliente — Reino das Crianças
```

Nesse caso, o valor entra como custo direto do cliente Reino das Crianças.

## Como a mão de obra entra na rentabilidade

A mão de obra vem do tempo registrado em tarefas e projetos.

O cálculo é:

```text
Tempo registrado × Custo por hora do membro
```

Exemplo:

```text
Responsável: João
Custo por hora: R$ 40
Tempo registrado: 3 horas

Mão de obra:
3 × R$ 40 = R$ 120
```

Para isso funcionar:

- a tarefa precisa estar vinculada ao cliente ou ao projeto do cliente;
- o membro precisa ter custo por hora ou custo mensal configurado;
- o tempo precisa ser registrado corretamente.

## Custos compartilhados não entram automaticamente no cliente

Custos usados por vários clientes não devem ser lançados diretamente em um cliente específico.

Exemplos:

- ChatGPT;
- Canva;
- Adobe;
- Google Workspace;
- internet;
- VPS;
- ferramentas internas;
- softwares usados pela agência inteira.

Esses custos devem ser registrados em centros internos, como:

```text
Tecnologia e Sistemas
Operação Interna
Administrativo
Marketing da Agência
```

Eles podem ser analisados futuramente como overhead, mas não entram automaticamente como custo direto de um cliente.

## Checklist para a rentabilidade funcionar

Antes de confiar nos números de rentabilidade, confira:

- o cliente tem centro de custo vinculado;
- as faturas estão confirmadas;
- as contas a pagar têm categoria e centro de custo;
- custos diretos usam o centro de custo do cliente;
- custos compartilhados usam centros internos;
- membros têm custo por hora ou custo mensal configurado;
- tarefas estão vinculadas ao cliente ou projeto do cliente;
- o tempo foi registrado corretamente.

## Resumo

O Finance registra documentos e lançamentos.

O Clients mostra a visão consolidada por cliente.

O Team calcula custos de equipe e mão de obra.

Quando os três módulos estão configurados corretamente, o Lyra consegue mostrar uma rentabilidade muito mais próxima da realidade operacional da agência.
