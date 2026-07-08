export type LeadFlowSettingsValidationIssue = {
  field: string;
  message: string;
};

export type LeadFlowSettingsValidationResponse = {
  valid: boolean;
  errors: LeadFlowSettingsValidationIssue[];
  warnings: LeadFlowSettingsValidationIssue[];
};
