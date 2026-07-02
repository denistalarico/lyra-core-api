---
systemKey: finance-initial-setup
slug: configuracao-inicial-finance
title: "Configuração inicial do Finance: o que preencher antes de começar"
summary: "Veja o checklist de configurações essenciais para usar faturas, contas a pagar, rentabilidade e DRE com mais precisão."
categoryKey: primeiros-passos
moduleKey: finance
productKey: lyra-agency
trailKeys: [primeiros-passos-no-finance]
order: 3
version: 1
locale: pt-BR
status: published
isFeatured: true
searchable: true
estimatedMinutes: 9
---

## Por que configurar antes de operar

O Finance pode ser usado rapidamente, mas a qualidade dos relatórios depende da configuração inicial.

Quando as configurações estão incompletas, alguns problemas aparecem:

- faturas sem classificação;
- contas a pagar sem centro de custo;
- rentabilidade de cliente distorcida;
- DRE incompleta;
- margem aparecendo como 100% sem ser real;
- mão de obra não calculada;
- pagamentos sem baixa correta.

A configuração inicial evita retrabalho e aumenta a confiança nos números.

## Checklist inicial

Antes de começar, revise:

- plano de contas;
- diários;
- categorias;
- centros de custo;
- contas bancárias;
- produtos, serviços e planos;
- regras financeiras do Team;
- custos dos membros.

## 1. Plano de contas

O plano de contas organiza as contas usadas nos lançamentos e relatórios.

Exemplos:

- Clientes a receber;
- Fornecedores a pagar;
- Receita de gestão de tráfego;
- Receita de social media;
- Freelancer de design;
- Softwares;
- Impostos;
- Despesas administrativas.

Recomendações:

- mantenha receitas separadas por tipo de serviço;
- separe custos diretos de despesas internas;
- não use uma única conta genérica para tudo;
- não misture conta bancária com conta de receita;
- revise se as contas estão no tipo correto.

Exemplo:

```text
Receita de social media → Receita
Freelancer para cliente → Custo
ChatGPT usado pela agência → Despesa
Banco Inter PJ → Ativo
Fornecedores a pagar → Passivo
```

## 2. Diários

Os diários agrupam lançamentos por origem.

Exemplos recomendados:

- Vendas;
- Compras;
- Banco;
- Caixa;
- Cartão de Crédito;
- Folha / Team;
- Ajustes Gerais.

Uso comum:

```text
Fatura de cliente → Vendas
Conta a pagar → Compras
Pagamento bancário → Banco
Pagamento de colaborador → Folha / Team
```

O diário ajuda a organizar os registros e facilita auditoria.

## 3. Categorias

As categorias tornam a classificação mais simples para o usuário.

Exemplos de categorias de receita:

- Gestão de tráfego pago;
- Gestão de redes sociais;
- Sites e landing pages;
- Consultoria;
- Setup inicial;
- Mensalidade recorrente.

Exemplos de categorias de custo:

- Freelancer de design;
- Freelancer de tráfego;
- Hospedagem de cliente;
- Produção externa;
- Ferramenta exclusiva de cliente.

Exemplos de categorias de despesa:

- Ferramentas de IA;
- Softwares de design;
- Contabilidade;
- Internet;
- Tarifas bancárias;
- Marketing da agência.

Regra importante:

```text
Cada categoria deve apontar para a conta contábil correta.
```

Se a categoria estiver errada, a DRE pode classificar o valor no lugar errado.

## 4. Centros de custo

Os centros de custo indicam onde o valor foi gerado ou consumido.

Crie centros para clientes e áreas internas.

Exemplos:

- Cliente — USO Benefícios;
- Cliente — Reino das Crianças;
- Cliente — Orenda Biotech;
- Tecnologia e Sistemas;
- Administração Geral;
- Marketing da Agência;
- Criação e Conteúdo;
- Desenvolvimento Interno.

Para rentabilidade, o centro mais importante é o do cliente.

Exemplo:

```text
Conta a pagar: Freelancer para Cliente X
Centro de custo: Cliente — X
```

Esse custo entra na rentabilidade do Cliente X.

## 5. Contas bancárias

Cadastre apenas contas controladas pela empresa.

Exemplos:

- Banco Inter PJ;
- Nubank PJ;
- Mercado Pago;
- Stripe;
- Caixa;
- Cartão Empresarial.

Não cadastre a conta pessoal de colaboradores como conta bancária da empresa.

Dados bancários de colaboradores devem ficar no Team, no cadastro do membro.

## 6. Produtos, serviços e planos

Produtos, serviços e planos precisam de configuração financeira.

Campos importantes:

- categoria de receita;
- conta de receita;
- categoria de custo, se aplicável;
- centro de custo;
- estratégia de centro de custo;
- recorrência, quando for plano mensal.

Para serviços vendidos a clientes, a estratégia mais comum é:

```text
Usar centro de custo do cliente
```

Assim, quando uma cotação for aceita e virar fatura, a fatura já pode nascer vinculada ao cliente correto.

## 7. Faturas

Faturas representam valores a receber de clientes.

Fluxo recomendado:

```text
Cotação aceita
→ Fatura em rascunho
→ Revisão
→ Confirmação
→ Lançamento automático
→ Recebimento
→ Baixa
```

Faturas em rascunho não entram nos relatórios de receita.

A receita passa a contar quando a fatura é confirmada ou emitida.

## 8. Contas a pagar

Contas a pagar representam custos e despesas.

Ao cadastrar uma conta a pagar, revise:

- fornecedor;
- vencimento;
- categoria;
- centro de custo;
- competência;
- valor;
- recorrência, se for uma despesa recorrente.

Exemplo de custo direto:

```text
Descrição: Freelancer para Cliente X
Categoria: Freelancer de design
Centro de custo: Cliente — X
```

Exemplo de despesa interna:

```text
Descrição: ChatGPT
Categoria: Ferramentas de IA
Centro de custo: Tecnologia e Sistemas
```

No primeiro caso, o valor entra como custo direto do cliente.

No segundo, o valor fica como despesa interna e não entra diretamente na margem do cliente.

## 9. Contas a pagar recorrentes

Use recorrência para custos que se repetem.

Exemplos:

- ChatGPT;
- Adobe;
- Canva;
- Contabilidade;
- Internet;
- Hospedagem;
- ferramenta exclusiva de cliente;
- freelancer mensal.

A recorrência cria novas contas a pagar, mas não gera pagamento automático.

O pagamento deve ser registrado quando realmente acontecer.

## 10. Team

No Team, configure os custos dos membros.

Campos importantes:

- custo por hora;
- custo mensal;
- horas contratadas;
- moeda;
- vencimento;
- tipo de vínculo;
- dados de pagamento.

Esses dados são usados para calcular mão de obra.

Exemplo:

```text
Tempo registrado: 5 horas
Custo por hora: R$ 40
Mão de obra do cliente: R$ 200
```

Se o membro não tiver custo configurado, o Lyra pode mostrar alerta de horas sem custo.

## 11. Regras financeiras do Team

As regras financeiras dizem como pagamentos de colaboradores, contractors e freelancers devem ir para o Finance.

Para a maioria dos casos, use:

```text
Gerar conta a pagar: Sim
Gerar despesa: Não
```

A conta a pagar já reconhece a despesa no Finance.

Gerar despesa separada pode causar duplicidade se não houver tratamento adequado.

Se a regra exigir aprovação, a conta a pagar só será criada depois da aprovação.

## Checklist final antes de operar

Use este checklist:

```text
[ ] Plano de contas configurado
[ ] Diários criados
[ ] Categorias vinculadas às contas corretas
[ ] Centros de custo criados
[ ] Clientes com centro de custo
[ ] Contas bancárias da empresa cadastradas
[ ] Produtos com categoria de receita
[ ] Contas a pagar com categoria e centro de custo
[ ] Membros com custo por hora ou custo mensal
[ ] Regras financeiras do Team configuradas
```

## Princípio geral

A configuração inicial não precisa ser perfeita, mas precisa ser consistente.

Se você usa sempre a mesma regra de classificação, os relatórios ficam mais confiáveis e fáceis de interpretar.
