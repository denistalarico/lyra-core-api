---
systemKey: finance-glossary
slug: glossario-financeiro
title: 'Glossário financeiro: plano de contas, diário, categoria, centro de custo e competência'
summary: 'Os termos essenciais do Finance explicados em linguagem direta, para você entender os relatórios sem ser contador.'
categoryKey: finance
moduleKey: finance
productKey: lyra-agency
trailKeys: [relatorios-financeiros]
order: 1
version: 1
locale: pt-BR
status: published
isFeatured: true
searchable: true
estimatedMinutes: 7
---

## Por que entender estes conceitos

Você não precisa ser contador para usar o Finance do Lyra Agency.

Mas alguns conceitos ajudam muito a configurar o sistema corretamente e evitar relatórios distorcidos.

Os principais são:

- plano de contas;
- diário;
- categoria;
- centro de custo;
- conta bancária;
- competência;
- lançamento;
- DRE Gerencial.

## Plano de contas

O plano de contas é a estrutura que organiza as contas financeiras e contábeis da empresa.

Ele responde à pergunta:

```text
Que tipo de valor é este?
```

Exemplos:

- Banco;
- Clientes a receber;
- Fornecedores a pagar;
- Receita de gestão de tráfego;
- Receita de social media;
- Freelancer de design;
- Softwares;
- Impostos;
- Despesas administrativas.

O plano de contas é usado para organizar os lançamentos e gerar relatórios como a DRE Gerencial.

## Tipos comuns de contas

### Ativo

Representa dinheiro, bens e valores a receber.

Exemplos:

- banco;
- caixa;
- aplicações;
- clientes a receber;
- saldo em provedores de pagamento.

### Passivo

Representa obrigações a pagar.

Exemplos:

- fornecedores a pagar;
- impostos a pagar;
- salários a pagar;
- cartão de crédito a pagar;
- valores de clientes sob responsabilidade da agência.

### Patrimônio líquido

Representa capital, lucros acumulados, aportes e distribuição de resultados.

Exemplos:

- capital social;
- aportes dos sócios;
- lucros acumulados;
- distribuição de lucros.

### Receita

Representa o que a empresa ganha com vendas e serviços.

Exemplos:

- receita de gestão de tráfego;
- receita de social media;
- receita de criação de sites;
- receita de consultoria;
- receita de assinatura.

### Custo

Representa gastos diretamente ligados à entrega do serviço.

Exemplos:

- freelancer contratado para cliente;
- produção externa;
- hospedagem exclusiva de cliente;
- ferramenta exclusiva de cliente.

### Despesa

Representa gastos da estrutura da empresa.

Exemplos:

- contabilidade;
- softwares internos;
- internet;
- marketing da própria agência;
- tarifas bancárias;
- ferramentas usadas por vários clientes.

## Diário

O diário indica a origem ou o tipo de registro financeiro.

Ele responde à pergunta:

```text
Em qual grupo de lançamentos este movimento entra?
```

Exemplos de diários:

- Vendas;
- Compras;
- Banco;
- Caixa;
- Cartão de Crédito;
- Folha / Team;
- Ajustes Gerais.

Exemplos práticos:

```text
Fatura de cliente → Diário de Vendas
Conta a pagar → Diário de Compras
Pagamento bancário → Diário de Banco
Pagamento de colaborador → Diário de Folha / Team
```

Na maioria dos casos, o usuário não precisa pensar muito no diário. O Lyra pode sugerir o diário de acordo com o documento.

## Categoria financeira

A categoria é uma classificação prática usada pelo usuário.

Ela responde à pergunta:

```text
O que é este valor?
```

Exemplos de categorias de receita:

- Gestão de tráfego pago;
- Gestão de redes sociais;
- Criação de site;
- Consultoria;
- Setup inicial;
- Assinatura de software.

Exemplos de categorias de custo:

- Freelancer de design;
- Freelancer de tráfego;
- Hospedagem de cliente;
- Produção audiovisual terceirizada;
- Ferramenta exclusiva de cliente.

Exemplos de categorias de despesa:

- Ferramentas de inteligência artificial;
- Softwares de design;
- Contabilidade;
- Internet;
- Tarifas bancárias;
- Marketing da agência.

A categoria normalmente aponta para uma conta do plano de contas.

Por isso, ao escolher a categoria correta, o Lyra consegue gerar lançamentos e relatórios com mais precisão.

## Centro de custo

O centro de custo indica onde o valor foi gerado ou consumido.

Ele responde à pergunta:

```text
Para quem ou para qual área este valor pertence?
```

Exemplos:

- Cliente — Orenda Biotech;
- Cliente — Reino das Crianças;
- Projeto — Campanha AtendeClin;
- Tecnologia e Sistemas;
- Administração Geral;
- Marketing da Agência;
- Criação e Conteúdo.

O centro de custo é essencial para calcular rentabilidade.

Exemplo:

```text
Conta a pagar: Freelancer de design
Categoria: Freelancer de design
Centro de custo: Cliente — Reino das Crianças
```

Nesse caso, o valor entra como custo direto do cliente Reino das Crianças.

## Conta bancária

A conta bancária representa onde o dinheiro entra ou sai.

Exemplos:

- Banco Inter PJ;
- Nubank PJ;
- Mercado Pago;
- Stripe;
- Caixa;
- Cartão Empresarial.

A conta bancária é usada principalmente em pagamentos e recebimentos.

Exemplo:

```text
Fatura recebida pelo Banco Inter PJ
Conta a pagar paga pelo Cartão Empresarial
```

Atenção: a conta bancária pessoal de um colaborador não deve ser cadastrada como conta bancária da empresa. Ela deve ficar nos dados de pagamento do membro, dentro do Team.

## Competência

Competência indica a qual período financeiro uma receita, custo ou despesa pertence.

Ela responde à pergunta:

```text
Este valor pertence a qual mês?
```

Exemplo:

```text
Serviço prestado em julho
Pagamento recebido em agosto
Competência: julho
```

A competência é importante para relatórios gerenciais, rentabilidade e DRE.

Sem competência, o Lyra pode usar a data de emissão, vencimento ou criação como fallback.

## Lançamento financeiro

O lançamento é o registro técnico que alimenta os relatórios.

Exemplo de fatura confirmada:

```text
Débito: Clientes a receber
Crédito: Receita de serviços
```

Exemplo de conta a pagar:

```text
Débito: Despesa ou custo
Crédito: Fornecedores a pagar
```

Exemplo de pagamento:

```text
Débito: Fornecedores a pagar
Crédito: Banco
```

Na maioria dos casos, o usuário não cria lançamentos manualmente. O Lyra gera automaticamente quando faturas, contas e pagamentos são confirmados.

## DRE Gerencial

A DRE Gerencial mostra o resultado da empresa em um período.

Ela responde à pergunta:

```text
A operação deu lucro ou prejuízo?
```

Estrutura simplificada:

```text
Receita
- Custos
= Lucro Bruto

Lucro Bruto
- Despesas Operacionais
= Resultado Operacional

Resultado Operacional
+/- Resultado Financeiro
= Resultado Líquido Gerencial
```

A DRE do Lyra é gerencial. Ela ajuda na tomada de decisão, mas não substitui a contabilidade fiscal da empresa.

## Resumo rápido

| Conceito        | Para que serve                             |
| --------------- | ------------------------------------------ |
| Plano de contas | Organiza as contas financeiras e contábeis |
| Diário          | Indica a origem do lançamento              |
| Categoria       | Define o que é o valor                     |
| Centro de custo | Define onde ou para quem o valor pertence  |
| Conta bancária  | Indica por onde o dinheiro entra ou sai    |
| Competência     | Define o mês ao qual o valor pertence      |
| Lançamento      | Registro técnico usado nos relatórios      |
| DRE             | Relatório de resultado da empresa          |
