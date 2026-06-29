import { HelpArticleSeed } from "./help-content.types";

const base = {
  contentFormat: "html" as const,
  productKey: "lyra-agency",
  locale: "pt-BR" as const,
  version: 1,
  status: "published" as const,
  searchable: true,
};

/**
 * Official Lyra Help Center articles (pt-BR). Authored, trusted platform
 * content. `content` is sanitized HTML produced by the platform — it is NOT
 * user input.
 */
export const helpArticlesPtBr: HelpArticleSeed[] = [
  {
    ...base,
    systemKey: "finance-clients-team-overview",
    slug: "como-finance-clients-e-team-trabalham-juntos",
    title: "Como o Finance, Clients e Team trabalham juntos no Lyra Agency",
    summary:
      "Visão geral de como cadastro de clientes, custo da equipe e lançamentos financeiros se conectam para gerar receita, custo e rentabilidade.",
    categoryKey: "primeiros-passos",
    moduleKey: "general",
    order: 1,
    isFeatured: true,
    estimatedReadMinutes: 6,
    content: `
<h2>Por que esses três módulos andam juntos</h2>
<p>No Lyra Agency, <strong>Finance</strong>, <strong>Clients</strong> e <strong>Team</strong> não são ilhas: eles compõem a mesma história financeira da agência. Entender essa conexão é o primeiro passo para que a rentabilidade por cliente faça sentido.</p>
<ul>
  <li><strong>Clients</strong> guarda quem é o cliente, seus contratos e o vínculo com projetos e tarefas.</li>
  <li><strong>Team</strong> guarda quem executa o trabalho e quanto custa cada colaborador por hora.</li>
  <li><strong>Finance</strong> consolida a receita (faturas) e o custo (contas a pagar, pagamentos da equipe) em lançamentos contábeis.</li>
</ul>

<h2>O fluxo de ponta a ponta</h2>
<ol>
  <li>Uma <strong>cotação</strong> aprovada vira uma <strong>fatura</strong> — isso registra a <strong>receita</strong> do cliente.</li>
  <li>O time executa <strong>tarefas</strong> ligadas ao projeto do cliente; o tempo registrado, multiplicado pelo custo/hora do membro, vira <strong>mão de obra</strong>.</li>
  <li><strong>Contas a pagar</strong> alocadas ao <strong>centro de custo</strong> do cliente viram <strong>custo direto</strong>.</li>
  <li>O Finance cruza receita, custo direto e mão de obra para calcular a <strong>margem direta</strong> por cliente.</li>
</ol>

<h2>O que isso significa na prática</h2>
<p>Se você quer ver rentabilidade confiável por cliente, três coisas precisam estar configuradas: o <strong>custo/hora dos membros</strong> (Team), o <strong>centro de custo do cliente</strong> (Finance/Clients) e as <strong>faturas confirmadas</strong> (Finance). Sem isso, os relatórios mostram apenas parte da realidade.</p>

<h2>Próximos passos</h2>
<p>Siga a trilha <em>Primeiros passos no Finance</em> para configurar a base, e depois a trilha <em>Rentabilidade de clientes</em> para medir margem.</p>
`,
  },
  {
    ...base,
    systemKey: "finance-glossary",
    slug: "glossario-financeiro",
    title:
      "Glossário financeiro: plano de contas, diário, categoria, centro de custo e competência",
    summary:
      "Os termos essenciais do Finance explicados em linguagem direta, para você entender os relatórios sem ser contador.",
    categoryKey: "finance",
    moduleKey: "finance",
    order: 1,
    isFeatured: true,
    estimatedReadMinutes: 7,
    content: `
<h2>Plano de contas</h2>
<p>É a lista organizada de "caixinhas" onde cada valor é classificado: receitas, custos, despesas, ativos e passivos. Toda movimentação financeira aponta para uma <strong>conta</strong> do plano. É o que dá estrutura à DRE.</p>

<h2>Categoria</h2>
<p>É uma classificação de negócio mais próxima do dia a dia (ex.: "Tráfego pago", "Salários", "Ferramentas"). No Lyra, a categoria carrega um <strong>tipo</strong> (receita ou despesa) e normalmente está vinculada a uma conta do plano de contas. É por ela que a maior parte dos lançamentos é classificada.</p>

<h2>Diário (livro diário)</h2>
<p>É o registro cronológico de todos os lançamentos contábeis (os <em>journal entries</em>). Quando uma fatura é confirmada ou um pagamento é baixado, o Lyra cria automaticamente um lançamento no diário. A DRE Gerencial lê justamente os lançamentos <strong>postados</strong> no diário.</p>

<h2>Centro de custo</h2>
<p>É a dimensão que responde "para quem/para qual frente esse custo existe". Na agência, o uso mais importante é ter <strong>um centro de custo por cliente</strong>, para separar quanto cada cliente consome. É a peça-chave da rentabilidade por cliente.</p>

<h2>Competência (regime de competência)</h2>
<p>Competência é <strong>quando o fato econômico acontece</strong>, não quando o dinheiro entra ou sai. Uma fatura de junho pertence à competência de junho mesmo que seja paga em julho. Relatórios gerenciais usam competência para mostrar o resultado real do período.</p>

<h2>Caixa x competência</h2>
<p><strong>Caixa</strong> = quando o dinheiro efetivamente entra/sai. <strong>Competência</strong> = quando a receita/custo é reconhecida. Confundir os dois é a causa mais comum de relatórios que "não batem".</p>
`,
  },
  {
    ...base,
    systemKey: "finance-initial-setup",
    slug: "configuracao-inicial-do-finance",
    title: "Configuração inicial do Finance: o que preencher antes de começar",
    summary:
      "O checklist do que precisa existir (plano de contas, categorias, centros de custo, contas bancárias) antes de emitir a primeira fatura.",
    categoryKey: "finance",
    moduleKey: "finance",
    order: 2,
    isFeatured: false,
    estimatedReadMinutes: 5,
    content: `
<h2>Antes da primeira fatura</h2>
<p>O Finance funciona melhor quando a base está pronta. Configure nesta ordem:</p>
<ol>
  <li><strong>Plano de contas e categorias</strong> — confira as categorias de receita e despesa que sua agência usa. Cada categoria deve ter o tipo correto (receita/despesa).</li>
  <li><strong>Centros de custo</strong> — crie ao menos um centro de custo por cliente relevante (a base da rentabilidade).</li>
  <li><strong>Contas bancárias / caixa</strong> — cadastre onde o dinheiro entra e sai; vincule cada conta a uma conta do plano de contas.</li>
  <li><strong>Provedores de pagamento</strong> — se você recebe via gateway, configure os provedores e taxas.</li>
  <li><strong>Sequências de documentos</strong> — defina a numeração de faturas para manter a emissão organizada.</li>
</ol>

<h2>Erros que aparecem depois se você pular etapas</h2>
<ul>
  <li>Sem centro de custo por cliente, a rentabilidade fica em branco.</li>
  <li>Sem categoria com tipo correto, a DRE classifica errado.</li>
  <li>Sem conta bancária vinculada, a baixa de pagamento não gera o lançamento esperado.</li>
</ul>

<h2>Dica</h2>
<p>Comece simples: poucas categorias bem definidas valem mais que um plano de contas enorme que ninguém mantém.</p>
`,
  },
  {
    ...base,
    systemKey: "finance-products-services-plans",
    slug: "produtos-servicos-e-planos",
    title:
      "Como cadastrar produtos, serviços e planos com configuração financeira",
    summary:
      "Como modelar o que você vende — avulso, setup, recorrente — para que cotações e faturas saiam corretas.",
    categoryKey: "finance",
    moduleKey: "finance",
    order: 3,
    isFeatured: false,
    estimatedReadMinutes: 5,
    content: `
<h2>Tipos do que você vende</h2>
<ul>
  <li><strong>Serviço avulso (one-time):</strong> cobrança única, ex.: landing page, diagnóstico.</li>
  <li><strong>Plano recorrente:</strong> cobrança que se repete, ex.: gestão mensal de tráfego.</li>
  <li><strong>Setup + recorrente:</strong> uma entrada inicial mais a mensalidade.</li>
  <li><strong>Add-on:</strong> complemento contratado junto de um plano.</li>
</ul>

<h2>Configuração financeira do item</h2>
<p>Para cada item defina: <strong>preço</strong> (avulso, setup, recorrente), <strong>moeda</strong>, <strong>intervalo de recorrência</strong> quando aplicável e a <strong>categoria de receita</strong> padrão. Isso garante que ao montar uma cotação os valores e a classificação já venham corretos.</p>

<h2>Por que isso importa para a rentabilidade</h2>
<p>Itens bem cadastrados padronizam a receita e facilitam comparar clientes parecidos. Um catálogo bagunçado vira retrabalho em cada proposta.</p>
`,
  },
  {
    ...base,
    systemKey: "finance-quotes-invoices-receipts",
    slug: "cotacoes-faturas-e-recebimentos",
    title: "Como criar cotações, faturas e registrar recebimentos",
    summary:
      "O caminho da proposta até o dinheiro na conta: aprovar cotação, gerar fatura, confirmar e dar baixa no recebimento.",
    categoryKey: "finance",
    moduleKey: "finance",
    order: 4,
    isFeatured: false,
    estimatedReadMinutes: 6,
    content: `
<h2>1. Cotação</h2>
<p>Monte a cotação a partir do catálogo de produtos/serviços. Ao ser <strong>aprovada (aceita)</strong>, o Lyra gera automaticamente uma <strong>fatura em rascunho</strong>, evitando redigitação e mantendo a origem rastreável.</p>

<h2>2. Fatura</h2>
<p>Revise a fatura rascunho (cliente, itens, vencimento, centro de custo). Ao <strong>confirmar</strong> a fatura, ela deixa de ser rascunho e o Lyra cria o <strong>lançamento de receita</strong> no diário. A partir daí, ela conta como receita do cliente.</p>

<h2>3. Recebimento (baixa)</h2>
<p>Quando o cliente paga, registre o <strong>recebimento</strong> e faça a <strong>baixa</strong> da fatura. Isso movimenta a conta bancária e fecha o ciclo caixa. Se houver taxa de gateway, ela é registrada como custo do recebimento.</p>

<h2>Receita confirmada é a fonte canônica</h2>
<p>Na rentabilidade por cliente, a <strong>receita considerada é a da fatura confirmada</strong> — não a cotação nem o rascunho. Por isso, confirmar faturas em dia mantém os relatórios fiéis.</p>
`,
  },
  {
    ...base,
    systemKey: "finance-bills-recurrences-payments",
    slug: "contas-a-pagar-recorrencias-e-pagamentos",
    title: "Como registrar contas a pagar, recorrências e pagamentos",
    summary:
      "Como lançar despesas, automatizar contas que se repetem e dar baixa nos pagamentos — alocando ao cliente certo.",
    categoryKey: "finance",
    moduleKey: "finance",
    order: 5,
    isFeatured: false,
    estimatedReadMinutes: 6,
    content: `
<h2>Conta a pagar (bill)</h2>
<p>Registre cada despesa como uma conta a pagar, com fornecedor, vencimento, categoria de despesa e — sempre que for custo de um cliente — o <strong>centro de custo do cliente</strong>. Essa alocação é o que transforma a despesa em <strong>custo direto</strong> daquele cliente.</p>

<h2>Recorrências</h2>
<p>Para despesas que se repetem (ferramentas, mídia mensal), use <strong>recorrências</strong>: o Lyra gera as contas futuras de forma idempotente, normalmente como <em>rascunho</em>, para você revisar antes de confirmar. Assim você não esquece de lançar e não duplica.</p>

<h2>Pagamento (baixa)</h2>
<p>Ao pagar, registre o <strong>pagamento</strong> e dê <strong>baixa</strong> na conta. Isso gera o lançamento de saída e movimenta a conta bancária. Estornos revertem o lançamento de forma controlada.</p>

<h2>Boas práticas de alocação</h2>
<ul>
  <li>Custo que é claramente de um cliente → centro de custo daquele cliente.</li>
  <li>Custo geral da agência (sem cliente) → deixe sem centro de custo de cliente; ele entra como despesa, não como custo direto.</li>
</ul>
`,
  },
  {
    ...base,
    systemKey: "finance-bank-accounts-cards-providers",
    slug: "contas-bancarias-cartoes-e-provedores",
    title: "Como usar contas bancárias, cartões e provedores de pagamento",
    summary:
      "Onde o dinheiro entra e sai: cadastrar contas e cartões, vincular ao plano de contas e configurar gateways.",
    categoryKey: "finance",
    moduleKey: "finance",
    order: 6,
    isFeatured: false,
    estimatedReadMinutes: 4,
    content: `
<h2>Contas bancárias e caixa</h2>
<p>Cadastre cada conta real (banco, caixa, carteira digital) e <strong>vincule-a a uma conta do plano de contas</strong>. É esse vínculo que permite que recebimentos e pagamentos gerem os lançamentos corretos.</p>

<h2>Cartões</h2>
<p>Cartões de crédito funcionam como conta de passivo: as despesas entram ao longo do mês e o pagamento da fatura do cartão é uma saída na conta bancária. Trate-os como conta própria para reconciliar com facilidade.</p>

<h2>Provedores de pagamento (gateways)</h2>
<p>Se você recebe via gateway, configure o <strong>provedor</strong> e suas <strong>taxas</strong>. A taxa do recebimento é registrada como custo, então a receita líquida fica fiel ao que realmente entrou.</p>

<h2>Reconciliação</h2>
<p>Manter contas e cartões organizados torna a conferência mensal rápida e evita o clássico "o extrato não bate com o sistema".</p>
`,
  },
  {
    ...base,
    systemKey: "clients-cost-centers-profitability",
    slug: "centros-de-custo-para-rentabilidade",
    title:
      "Como configurar centros de custo para medir rentabilidade por cliente",
    summary:
      "O centro de custo por cliente é a peça que liga despesas ao cliente certo e destrava a margem direta.",
    categoryKey: "clients",
    moduleKey: "finance",
    order: 1,
    isFeatured: false,
    estimatedReadMinutes: 5,
    content: `
<h2>O conceito</h2>
<p>Um <strong>centro de custo</strong> é uma etiqueta que diz "este custo pertence a esta frente". Para medir rentabilidade por cliente, a regra é simples: <strong>cada cliente tem o seu centro de custo</strong>.</p>

<h2>Como configurar</h2>
<ol>
  <li>Crie um centro de custo para cada cliente ativo.</li>
  <li>Ao lançar contas a pagar que são daquele cliente, selecione o centro de custo dele.</li>
  <li>Confirme que as faturas do cliente também estão associadas ao mesmo centro de custo / cliente.</li>
</ol>

<h2>O resultado</h2>
<p>Com isso, o Lyra consegue somar, por cliente: a <strong>receita</strong> (faturas confirmadas), o <strong>custo direto</strong> (linhas de contas a pagar daquele centro de custo) e, somado à mão de obra, calcular a <strong>margem direta</strong>.</p>

<h2>Cuidados</h2>
<ul>
  <li>Não reaproveite um mesmo centro de custo para dois clientes diferentes.</li>
  <li>Custos gerais da agência não devem ir para o centro de custo de um cliente — senão você "suja" a margem dele.</li>
</ul>
`,
  },
  {
    ...base,
    systemKey: "clients-direct-cost-labor-margin",
    slug: "custo-direto-mao-de-obra-e-margem",
    title: "Como calcular custo direto, mão de obra e margem direta",
    summary:
      "As três fontes canônicas da rentabilidade e como o Lyra as combina para mostrar a margem por cliente.",
    categoryKey: "clients",
    moduleKey: "finance",
    order: 2,
    isFeatured: true,
    estimatedReadMinutes: 6,
    content: `
<h2>As três fontes canônicas</h2>
<table>
  <thead><tr><th>Componente</th><th>Fonte no Lyra</th></tr></thead>
  <tbody>
    <tr><td><strong>Receita</strong></td><td>Faturas <em>confirmadas</em> do cliente</td></tr>
    <tr><td><strong>Custo direto</strong></td><td>Linhas de contas a pagar no <em>centro de custo</em> do cliente</td></tr>
    <tr><td><strong>Mão de obra</strong></td><td>Tempo registrado em tarefas × custo/hora do membro</td></tr>
  </tbody>
</table>

<h2>Como a margem é calculada</h2>
<p><strong>Margem direta = Receita − Custo direto − Mão de obra.</strong> É uma margem <em>direta</em> porque considera apenas o que é atribuível ao cliente; ela não distribui o <strong>overhead</strong> (custos gerais da agência).</p>

<h2>Mão de obra em detalhe</h2>
<p>Cada tarefa ligada a um projeto de cliente acumula tempo. Esse tempo é multiplicado pelo <strong>custo/hora</strong> do colaborador (configurado no Team). Por isso, se o custo/hora estiver vazio, a mão de obra do cliente aparece subestimada.</p>

<h2>Pré-requisitos para o número ser confiável</h2>
<ul>
  <li>Tarefas herdam o cliente do projeto — então projetos precisam estar ligados ao cliente.</li>
  <li>Membros precisam de custo/hora preenchido no Team.</li>
  <li>Despesas do cliente precisam estar no centro de custo correto.</li>
</ul>
`,
  },
  {
    ...base,
    systemKey: "team-member-contractor-cost",
    slug: "team-custo-de-colaboradores-e-contractors",
    title:
      "Como configurar o Team para calcular custo de colaboradores e contractors",
    summary:
      "Onde definir custo/hora, horas contratadas e contratos para que a mão de obra entre certa na rentabilidade.",
    categoryKey: "team",
    moduleKey: "team",
    order: 1,
    isFeatured: false,
    estimatedReadMinutes: 5,
    content: `
<h2>Por que o Team afeta a rentabilidade</h2>
<p>O custo de mão de obra que aparece na margem de cada cliente vem do <strong>custo/hora</strong> dos membros. Se o Team não estiver configurado, a rentabilidade ignora o maior custo da maioria das agências: as pessoas.</p>

<h2>O que configurar por membro</h2>
<ul>
  <li><strong>Custo/hora:</strong> quanto custa uma hora daquele colaborador (salário + encargos, ou valor do contractor).</li>
  <li><strong>Jornada / horas contratadas:</strong> base para calcular custo mensal e ocupação.</li>
  <li><strong>Tipo de vínculo:</strong> colaborador CLT, sócio ou contractor — útil para os pagamentos.</li>
  <li><strong>Contrato e pagamentos:</strong> vincule o membro a contratos e às rotinas de pagamento.</li>
</ul>

<h2>Colaboradores x contractors</h2>
<p>Para <strong>contractors</strong>, o custo/hora normalmente é o próprio valor combinado. Para <strong>CLT/sócios</strong>, lembre de incluir encargos no custo/hora para não subestimar a mão de obra.</p>

<h2>Conexão com o Finance</h2>
<p>Os pagamentos da equipe se integram ao Finance (confirmação, baixa, cancelamento), então o custo de pessoal também aparece como saída financeira, não só como mão de obra alocada.</p>
`,
  },
  {
    ...base,
    systemKey: "reports-managerial-dre",
    slug: "como-ler-a-dre-gerencial",
    title: "Como ler a DRE Gerencial no Finance",
    summary:
      "O que a DRE Gerencial mostra, de onde vêm os números e como interpretar receita, custos, despesas e resultado.",
    categoryKey: "relatorios",
    moduleKey: "finance",
    order: 1,
    isFeatured: true,
    estimatedReadMinutes: 6,
    content: `
<h2>O que é a DRE Gerencial</h2>
<p>A <strong>DRE (Demonstração do Resultado do Exercício) Gerencial</strong> mostra, para um período, quanto entrou (receita), quanto saiu (custos e despesas) e o <strong>resultado</strong> (lucro ou prejuízo). É a foto do desempenho do período.</p>

<h2>De onde vêm os números</h2>
<p>A DRE Gerencial lê os <strong>lançamentos postados</strong> no diário. A classificação de cada valor segue, em ordem, o <strong>tipo da categoria</strong> e, na sequência, o <strong>tipo da conta</strong> do plano de contas. Por isso, categorias com tipo errado aparecem na linha errada.</p>

<h2>Como ler de cima para baixo</h2>
<ol>
  <li><strong>Receita</strong> — vendas reconhecidas no período.</li>
  <li><strong>(−) Custos</strong> — o que é diretamente ligado à entrega.</li>
  <li><strong>(=) Margem</strong> — o que sobra antes das despesas gerais.</li>
  <li><strong>(−) Despesas</strong> — estrutura, administrativo, overhead.</li>
  <li><strong>(=) Resultado</strong> — lucro ou prejuízo do período.</li>
</ol>

<h2>Sinais e estornos</h2>
<p>Estornos aparecem com o sinal invertido do lançamento original, mantendo a DRE coerente. Se algo parece "dobrado", verifique se há lançamento e estorno no mesmo período.</p>

<h2>Alertas de classificação</h2>
<p>Quando um lançamento não tem classificação clara, o relatório sinaliza. Trate esses alertas: eles indicam categorias sem tipo ou contas sem mapeamento.</p>
`,
  },
  {
    ...base,
    systemKey: "best-practices-monthly-routine",
    slug: "rotina-mensal-e-erros-comuns",
    title: "Rotina mensal recomendada e erros comuns que afetam relatórios",
    summary:
      "Um checklist de fechamento mensal e a lista dos deslizes que mais distorcem rentabilidade e DRE.",
    categoryKey: "boas-praticas",
    moduleKey: "finance",
    order: 1,
    isFeatured: false,
    estimatedReadMinutes: 5,
    content: `
<h2>Rotina mensal recomendada</h2>
<ol>
  <li><strong>Confirme as faturas</strong> do período (receita reconhecida).</li>
  <li><strong>Lance e confirme as contas a pagar</strong>, com o centro de custo do cliente quando aplicável.</li>
  <li><strong>Gere as recorrências</strong> e revise os rascunhos antes de confirmar.</li>
  <li><strong>Dê baixa</strong> em recebimentos e pagamentos efetivados.</li>
  <li><strong>Revise o custo/hora</strong> da equipe se houve mudança de salário/contrato.</li>
  <li><strong>Abra a DRE Gerencial</strong> e trate os alertas de classificação.</li>
  <li><strong>Confira a rentabilidade</strong> por cliente e investigue margens fora do padrão.</li>
</ol>

<h2>Erros comuns que distorcem relatórios</h2>
<ul>
  <li><strong>Faturas não confirmadas:</strong> receita "some" do período.</li>
  <li><strong>Despesa sem centro de custo:</strong> o cliente parece mais lucrativo do que é.</li>
  <li><strong>Custo geral no centro de custo de um cliente:</strong> margem do cliente fica artificialmente baixa.</li>
  <li><strong>Custo/hora vazio:</strong> mão de obra subestimada, margem superestimada.</li>
  <li><strong>Categoria com tipo errado:</strong> valor cai na linha errada da DRE.</li>
  <li><strong>Misturar caixa e competência:</strong> relatórios que "não batem" entre si.</li>
</ul>

<h2>Princípio geral</h2>
<p>Consistência vence perfeição: aplicar sempre a mesma regra de classificação é mais valioso do que acertar um mês e bagunçar o próximo.</p>
`,
  },
];
