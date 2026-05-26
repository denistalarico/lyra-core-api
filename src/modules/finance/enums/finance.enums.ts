export enum FinanceAccountType {
  Asset = 'asset',
  Liability = 'liability',
  Equity = 'equity',
  Revenue = 'revenue',
  Expense = 'expense',
  CostOfGoodsSold = 'cost_of_goods_sold',
}

export enum FinanceAccountStatus {
  Active = 'active',
  Archived = 'archived',
}

export enum FinanceJournalType {
  Sales = 'sales',
  Purchase = 'purchase',
  Bank = 'bank',
  Cash = 'cash',
  CreditCard = 'credit_card',
  Miscellaneous = 'miscellaneous',
}

export enum FinanceCategoryType {
  Revenue = 'revenue',
  Expense = 'expense',
  Cost = 'cost',
  Tax = 'tax',
  Transfer = 'transfer',
}

export enum FinanceCostBehavior {
  Fixed = 'fixed',
  Variable = 'variable',
  Mixed = 'mixed',
}

export enum FinanceCostCenterType {
  Client = 'client',
  Project = 'project',
  Team = 'team',
  Department = 'department',
  Internal = 'internal',
  Commercial = 'commercial',
  Administrative = 'administrative',
  Other = 'other',
}

export enum FinanceBankAccountType {
  Checking = 'checking',
  Savings = 'savings',
  Cash = 'cash',
  CreditCard = 'credit_card',
  PaymentProvider = 'payment_provider',
  Other = 'other',
}

export enum FinancePeriodStatus {
  Open = 'open',
  Closed = 'closed',
  Locked = 'locked',
}

export enum FinanceMetricPeriodType {
  Daily = 'daily',
  Weekly = 'weekly',
  Monthly = 'monthly',
  Quarterly = 'quarterly',
  Yearly = 'yearly',
  Custom = 'custom',
}

export enum FinanceMetricKey {
  Mrr = 'mrr',
  RevenueIssued = 'revenue_issued',
  RevenueReceived = 'revenue_received',
  OpenReceivables = 'open_receivables',
  OverdueReceivables = 'overdue_receivables',
  DefaultRate = 'default_rate',
  AverageTicket = 'average_ticket',
  FixedCosts = 'fixed_costs',
  VariableCosts = 'variable_costs',
  GrossMargin = 'gross_margin',
  NetMargin = 'net_margin',
  BreakEvenPoint = 'break_even_point',
  ActiveContracts = 'active_contracts',
  CustomerChurn = 'customer_churn',
  RevenueChurn = 'revenue_churn',
}

export enum FinanceReportType {
  Executive = 'executive',
  Revenue = 'revenue',
  Receivables = 'receivables',
  Expenses = 'expenses',
  ProfitAndLoss = 'profit_and_loss',
  Retention = 'retention',
  Profitability = 'profitability',
}

export enum FinanceProfitabilityHealth {
  Healthy = 'healthy',
  Attention = 'attention',
  Risk = 'risk',
  Deficit = 'deficit',
}
