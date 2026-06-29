import { helpArticlesPtBr } from "./help-articles.pt-br";
import {
  HelpCategorySeed,
  HelpContentRegistry,
  HelpTrailSeed,
} from "./help-content.types";

/**
 * Canonical, platform-owned Help Center content. This registry is the single
 * source of truth: it is version-controlled here and synced into the global
 * help_* tables idempotently by HelpCenterSeedService. To ship a new locale
 * (en/es), add categories/trails/articles with the matching `locale` and the
 * same content `key`/`systemKey`; the unique indexes are scoped by locale.
 */

const categoriesPtBr: HelpCategorySeed[] = [
  {
    key: "primeiros-passos",
    title: "Primeiros passos",
    description: "Comece por aqui e entenda como o Lyra Agency se conecta.",
    icon: "Rocket",
    color: "#2563eb",
    productKey: "lyra-agency",
    moduleKey: "general",
    order: 1,
    locale: "pt-BR",
    status: "published",
  },
  {
    key: "finance",
    title: "Finance",
    description: "Faturas, contas a pagar, recebimentos e configuração financeira.",
    icon: "Wallet",
    color: "#16a34a",
    productKey: "lyra-agency",
    moduleKey: "finance",
    order: 2,
    locale: "pt-BR",
    status: "published",
  },
  {
    key: "team",
    title: "Team",
    description: "Custo de colaboradores, contratos e pagamentos da equipe.",
    icon: "Users",
    color: "#9333ea",
    productKey: "lyra-agency",
    moduleKey: "team",
    order: 3,
    locale: "pt-BR",
    status: "published",
  },
  {
    key: "clients",
    title: "Clients",
    description: "Centros de custo, custo direto e rentabilidade por cliente.",
    icon: "Briefcase",
    color: "#ea580c",
    productKey: "lyra-agency",
    moduleKey: "clients",
    order: 4,
    locale: "pt-BR",
    status: "published",
  },
  {
    key: "relatorios",
    title: "Relatórios",
    description: "DRE Gerencial e leitura de resultados financeiros.",
    icon: "BarChart2",
    color: "#0891b2",
    productKey: "lyra-agency",
    moduleKey: "finance",
    order: 5,
    locale: "pt-BR",
    status: "published",
  },
  {
    key: "boas-praticas",
    title: "Boas práticas",
    description: "Rotinas, checklists e erros comuns a evitar.",
    icon: "CheckCircle2",
    color: "#ca8a04",
    productKey: "lyra-agency",
    moduleKey: "general",
    order: 6,
    locale: "pt-BR",
    status: "published",
  },
];

const trailsPtBr: HelpTrailSeed[] = [
  {
    key: "primeiros-passos-no-finance",
    title: "Primeiros passos no Finance",
    description:
      "Configure a base financeira e aprenda o ciclo da receita à baixa de pagamentos.",
    audience: "Quem está começando a operar o Finance",
    estimatedMinutes: 22,
    productKey: "lyra-agency",
    moduleKey: "finance",
    order: 1,
    locale: "pt-BR",
    status: "published",
    articles: [
      { articleKey: "finance-initial-setup" },
      { articleKey: "finance-products-services-plans" },
      { articleKey: "finance-quotes-invoices-receipts" },
      { articleKey: "finance-bills-recurrences-payments" },
    ],
  },
  {
    key: "rentabilidade-de-clientes",
    title: "Rentabilidade de clientes",
    description:
      "Da configuração de centros de custo à leitura da margem direta por cliente.",
    audience: "Gestores e financeiro",
    estimatedMinutes: 23,
    productKey: "lyra-agency",
    moduleKey: "clients",
    order: 2,
    locale: "pt-BR",
    status: "published",
    articles: [
      { articleKey: "clients-cost-centers-profitability" },
      { articleKey: "clients-direct-cost-labor-margin" },
      { articleKey: "team-member-contractor-cost" },
      { articleKey: "reports-managerial-dre" },
    ],
  },
  {
    key: "team-e-pagamentos",
    title: "Team e pagamentos",
    description:
      "Configure custo de pessoas e conecte pagamentos da equipe ao Finance.",
    audience: "RH, sócios e financeiro",
    estimatedMinutes: 11,
    productKey: "lyra-agency",
    moduleKey: "team",
    order: 3,
    locale: "pt-BR",
    status: "published",
    articles: [
      { articleKey: "team-member-contractor-cost" },
      { articleKey: "finance-bills-recurrences-payments" },
    ],
  },
  {
    key: "relatorios-financeiros",
    title: "Relatórios financeiros",
    description:
      "Entenda os termos, leia a DRE Gerencial e mantenha a rotina mensal.",
    audience: "Gestores e sócios",
    estimatedMinutes: 18,
    productKey: "lyra-agency",
    moduleKey: "finance",
    order: 4,
    locale: "pt-BR",
    status: "published",
    articles: [
      { articleKey: "finance-glossary" },
      { articleKey: "reports-managerial-dre" },
      { articleKey: "best-practices-monthly-routine" },
    ],
  },
];

export const HELP_CONTENT_REGISTRY: HelpContentRegistry = {
  categories: [...categoriesPtBr],
  trails: [...trailsPtBr],
  articles: [...helpArticlesPtBr],
};
