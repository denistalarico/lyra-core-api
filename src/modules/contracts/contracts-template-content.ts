export type ContractTemplateContent = {
  headerHtml: string;
  bodyHtml: string;
  footerHtml: string;
};

const clientRecurringMarketingServices: ContractTemplateContent = {
  headerHtml: `
    <h1>Contrato de Prestação de Serviços de Marketing Digital</h1>
    <p><strong>Contrato nº:</strong> {{contract.number}}</p>
  `,
  bodyHtml: `
    <h2>Identificação das partes contratantes</h2>

    <p><strong>CONTRATANTE:</strong> {{client.legalName}}, inscrita no CNPJ/CPF sob o nº {{client.taxId}}, estabelecida em {{client.address}}, doravante denominada CONTRATANTE, neste ato representada por {{responsible.fullName}}, CPF {{responsible.cpf}}, telefone {{responsible.phone}} e e-mail {{responsible.email}}.</p>

    <p><strong>CONTRATADA:</strong> {{agency.legalName}}, inscrita no CNPJ sob o nº {{agency.taxId}}, estabelecida em {{agency.address}}, e-mail {{agency.email}}, neste ato representada por {{agency.signerName}}, doravante denominada CONTRATADA.</p>

    <p>As partes acima identificadas têm, entre si, justo e contratado o presente Contrato de Prestação de Serviços de Marketing Digital, que se regerá pelas cláusulas seguintes.</p>

    <h2>1. Objeto</h2>

    <p>1.1. O presente contrato tem como objeto a prestação, pela CONTRATADA à CONTRATANTE, dos seguintes serviços: {{offer.services}}.</p>

    <p>1.2. O plano contratado contempla {{offer.monthlyPublications}} publicações mensais, além das demais entregas descritas na proposta comercial ou cotação aprovada.</p>

    <p>1.3. Toda campanha, peça ou conteúdo que exigir aprovação prévia deverá ser validado pela CONTRATANTE antes da publicação.</p>

    <p>1.4. Serviços adicionais não previstos neste contrato ou na proposta comercial serão cobrados separadamente, mediante aprovação prévia da CONTRATANTE.</p>

    <h2>2. Obrigações da contratante</h2>

    <p>2.1. Adimplir pontualmente os valores contratados.</p>

    <p>2.2. Fornecer informações, materiais, acessos, senhas, documentos e aprovações necessários para execução dos serviços.</p>

    <p>2.3. Responder às solicitações da CONTRATADA em prazo razoável, evitando atrasos no cronograma de execução.</p>

    <p>2.4. Responsabilizar-se pela veracidade das informações fornecidas e pela manutenção dos acessos necessários à execução dos serviços.</p>

    <h2>3. Obrigações da contratada</h2>

    <p>3.1. Executar os serviços contratados com zelo técnico, dentro do escopo contratado.</p>

    <p>3.2. Enviar conteúdos para aprovação com antecedência compatível com o cronograma definido entre as partes.</p>

    <p>3.3. Emitir nota fiscal, fatura ou documento de cobrança referente aos serviços prestados.</p>

    <p>3.4. Quando aplicável, enviar relatórios de desempenho ou comprovantes de execução dos serviços.</p>

    <h2>4. Investimento em anúncios</h2>

    <p>4.1. O pagamento de mídia, anúncios e campanhas em plataformas como Meta Ads, Google Ads, LinkedIn Ads, TikTok Ads ou semelhantes será de responsabilidade exclusiva da CONTRATANTE, salvo disposição expressa em contrário.</p>

    <h2>5. Preço, pagamento e vigência</h2>

    <p>5.1. Em contrapartida aos serviços prestados, a CONTRATANTE pagará à CONTRATADA o valor recorrente mensal de {{offer.recurringAmount}}.</p>

    <p>5.2. Entrada/setup: {{offer.setupFee}}.</p>

    <p>5.3. O pagamento deverá ser realizado até o dia {{offer.invoiceDueDay}} de cada mês.</p>

    <p>5.4. Em caso de atraso, incidirá multa moratória de {{offer.lateFeePercent}}, acrescida de juros de mora de {{offer.monthlyInterestPercent}} ao mês, sem prejuízo de correção monetária quando aplicável.</p>

    <p>5.5. O contrato terá duração total de {{offer.contractTermMonths}} meses, com vigência inicial mínima de {{offer.initialTermMonths}} meses.</p>

    <p>5.6. Renovação automática: {{offer.autoRenewal}}. Prazo de renovação: {{offer.renewalTermMonths}} meses.</p>

    <h2>6. Suspensão dos serviços</h2>

    <p>6.1. A CONTRATADA poderá suspender a execução dos serviços em caso de inadimplência, ausência de envio de materiais, ausência de aprovação ou falta de resposta da CONTRATANTE por prazo que comprometa a execução do serviço.</p>

    <p>6.2. A suspensão dos serviços não exonera a CONTRATANTE da obrigação de pagamento das mensalidades contratadas durante a vigência do contrato.</p>

    <h2>7. Rescisão</h2>

    <p>7.1. O contrato poderá ser rescindido por acordo entre as partes, por descumprimento contratual ou por solicitação unilateral mediante aviso prévio.</p>

    <p>7.2. Caso a CONTRATANTE rescinda o contrato antes do término da vigência mínima acordada, será devida a seguinte multa rescisória: {{offer.terminationPenalty}}.</p>

    <p>7.3. Valores vencidos, serviços já executados e despesas aprovadas continuarão devidos em caso de rescisão.</p>

    <h2>8. Portfólio</h2>

    <p>8.1. A CONTRATADA poderá utilizar peças, campanhas, imagens, resultados e materiais já publicados da CONTRATANTE para composição de portfólio profissional, respeitando informações confidenciais e estratégicas.</p>

    <h2>9. Confidencialidade</h2>

    <p>9.1. As partes comprometem-se a manter sigilo sobre informações estratégicas, documentos, dados, acessos, campanhas e materiais confidenciais obtidos em razão deste contrato.</p>

    <p>9.2. O dever de confidencialidade permanecerá vigente mesmo após o término do contrato.</p>

    <h2>10. Independência das partes</h2>

    <p>10.1. O presente contrato não constitui sociedade, associação, representação comercial, vínculo trabalhista, previdenciário ou tributário entre as partes, mantendo-se ambas independentes.</p>

    <h2>11. Disposições finais</h2>

    <p>11.1. Este contrato constitui o acordo integral entre as partes e substitui entendimentos anteriores relacionados ao objeto contratado.</p>

    <p>11.2. Qualquer alteração deverá ser feita por escrito e aprovada por ambas as partes.</p>

    <p>11.3. Este documento poderá ser assinado manual ou eletronicamente, inclusive por plataforma de assinatura digital.</p>

    <h2>12. Foro</h2>

    <p>12.1. As partes elegem o foro de {{contract.jurisdiction}} para dirimir eventuais controvérsias decorrentes deste contrato.</p>

    <p>{{contract.city}}, {{contract.date}}.</p>

    <div class="signature-grid">
      <div class="signature-line">
        {{responsible.fullName}}<br />
        CONTRATANTE
      </div>
      <div class="signature-line">
        {{agency.signerName}}<br />
        CONTRATADA
      </div>
    </div>
  `,
  footerHtml: `<p>Contrato nº {{contract.number}}</p>`,
};

const clientShortTermMarketingServices: ContractTemplateContent = {
  headerHtml: `
    <h1>Contrato de Prestação de Serviços de Marketing Digital</h1>
    <p><strong>Contrato nº:</strong> {{contract.number}}</p>
  `,
  bodyHtml: `
    <h2>Identificação das partes</h2>

    <p><strong>CONTRATANTE:</strong> {{client.legalName}}, CNPJ/CPF {{client.taxId}}, estabelecida em {{client.address}}, neste ato representada por {{responsible.fullName}}, CPF {{responsible.cpf}}, telefone {{responsible.phone}} e e-mail {{responsible.email}}.</p>

    <p><strong>CONTRATADA:</strong> {{agency.legalName}}, CNPJ {{agency.taxId}}, estabelecida em {{agency.address}}, e-mail {{agency.email}}, neste ato representada por {{agency.signerName}}.</p>

    <h2>1. Objeto</h2>

    <p>1.1. O presente contrato tem como objeto a prestação dos seguintes serviços: {{offer.services}}, conforme proposta comercial aprovada.</p>

    <h2>2. Obrigações da contratante</h2>

    <p>2.1. Pagar os valores ajustados nos prazos estabelecidos.</p>

    <p>2.2. Fornecer informações, acessos, materiais e aprovações necessários à execução do serviço.</p>

    <h2>3. Obrigações da contratada</h2>

    <p>3.1. Executar os serviços contratados dentro do prazo e escopo acordados.</p>

    <p>3.2. Enviar, quando aplicável, comprovantes de execução, arquivos finais ou relatórios.</p>

    <h2>4. Preço e pagamento</h2>

    <p>4.1. O valor total dos serviços será de {{offer.totalAmount}}.</p>

    <p>4.2. Forma de pagamento: {{offer.paymentTerms}}.</p>

    <p>4.3. Prazo de entrega: {{offer.deliveryDeadline}}.</p>

    <p>4.4. Limite de revisões, quando aplicável: {{offer.revisionLimit}}.</p>

    <p>4.5. O investimento em anúncios, quando houver, será de responsabilidade exclusiva da CONTRATANTE.</p>

    <h2>5. Vigência e rescisão</h2>

    <p>5.1. Este contrato terá vigência até a conclusão dos serviços contratados ou pelo período indicado na proposta comercial.</p>

    <p>5.2. Em caso de rescisão antes da conclusão dos serviços por iniciativa da CONTRATANTE, será devida multa ou retenção proporcional conforme segue: {{offer.terminationPenalty}}.</p>

    <h2>6. Portfólio e confidencialidade</h2>

    <p>6.1. A CONTRATADA poderá utilizar materiais já publicados como portfólio, vedado o uso de informações confidenciais sem autorização.</p>

    <p>6.2. As partes comprometem-se a manter sigilo sobre informações estratégicas e acessos obtidos durante a execução dos serviços.</p>

    <h2>7. Disposições finais</h2>

    <p>7.1. Este contrato constitui o acordo integral entre as partes. Qualquer alteração deverá ser feita por escrito.</p>

    <p>7.2. O foro eleito para dirimir quaisquer questões é o de {{contract.jurisdiction}}.</p>

    <p>{{contract.city}}, {{contract.date}}.</p>

    <div class="signature-grid">
      <div class="signature-line">
        {{responsible.fullName}}<br />
        CONTRATANTE
      </div>
      <div class="signature-line">
        {{agency.signerName}}<br />
        CONTRATADA
      </div>
    </div>
  `,
  footerHtml: `<p>Contrato nº {{contract.number}}</p>`,
};

const meiContractorMonthlyServices: ContractTemplateContent = {
  headerHtml: `
    <h1>Contrato de Prestação de Serviços</h1>
    <p><strong>Contrato nº:</strong> {{contract.number}}</p>
  `,
  bodyHtml: `
    <h2>Entre as partes</h2>

    <p><strong>Contratante:</strong> {{agency.legalName}}, inscrita no CNPJ sob o nº {{agency.taxId}}, com sede em {{agency.address}}, neste ato representada por {{agency.signerName}}, doravante denominada AGÊNCIA.</p>

    <p><strong>Contratado(a):</strong> {{contractor.fullName}}, CPF {{contractor.cpf}}, nascido(a) em {{contractor.birthDate}}, {{contractor.nationality}}, residente e domiciliado(a) em {{contractor.address}}, doravante denominado(a) PRESTADOR(A).</p>

    <p><strong>Dados da empresa do prestador, quando aplicável:</strong> {{contractor.companyLegalName}} — CNPJ {{contractor.companyTaxId}}.</p>

    <h2>1. Objeto</h2>

    <p>1.1. O presente contrato tem por objeto a prestação de serviços de {{role.title}}, que incluem: {{role.description}}, a serem executados pelo(a) PRESTADOR(A) em favor da AGÊNCIA, conforme demanda e escopo acordado.</p>

    <h2>2. Natureza da relação</h2>

    <p>2.1. Este é um contrato de prestação de serviços autônomos, de natureza civil, não gerando vínculo empregatício, societário, previdenciário ou tributário entre as partes.</p>

    <p>2.2. O(A) PRESTADOR(A) declara possuir autonomia técnica e operacional na execução das atividades, assumindo responsabilidade por seus encargos fiscais, previdenciários e obrigações legais.</p>

    <p>2.3. O(A) PRESTADOR(A) não estará sujeito(a) a controle de jornada pela AGÊNCIA, atuando com autonomia na organização de seus horários, desde que respeitados os prazos de entrega acordados.</p>

    <p>2.4. Forma de execução: {{work.executionMode}}. Local/modalidade de execução: {{work.locationMode}}.</p>

    <p>2.5. Declaração complementar de autonomia: {{work.autonomyStatement}}.</p>

    <h2>3. Remuneração e forma de pagamento</h2>

    <p>3.1. A AGÊNCIA pagará ao(à) PRESTADOR(A) o valor mensal de {{payment.monthlyAmount}}, considerando a entrega das atividades e resultados descritos no objeto deste contrato.</p>

    <p>3.2. Condições de pagamento: {{payment.paymentTerms}}.</p>

    <p>3.3. O pagamento será realizado até o dia {{payment.dueDay}} de cada período contratado, mediante apresentação de {{payment.billingDocument}}.</p>

    <p>3.4. Atividades adicionais fora do escopo deverão ser previamente acordadas por escrito e remuneradas de forma independente.</p>

    <h2>4. Prazo e rescisão</h2>

    <p>4.1. O presente contrato terá vigência de {{contract.startDate}} até {{contract.endDate}}.</p>

    <p>4.2. Renovação automática: {{contract.autoRenewal}}.</p>

    <p>4.3. Qualquer das partes poderá rescindir o contrato mediante aviso prévio por escrito, sem prejuízo de valores pendentes por serviços já prestados.</p>

    <h2>5. Confidencialidade</h2>

    <p>5.1. O(A) PRESTADOR(A) obriga-se a manter sigilo absoluto sobre informações, dados, estratégias, materiais, clientes, processos e acessos da AGÊNCIA.</p>

    <p>5.2. O dever de confidencialidade permanecerá vigente por tempo indeterminado.</p>

    <h2>6. Não-solicitação</h2>

    <p>6.1. Pelo prazo de 12 meses contados do término deste contrato, o(a) PRESTADOR(A) não poderá prestar serviços diretamente a clientes ativos da AGÊNCIA com os quais tenha tido contato em razão deste contrato, salvo autorização expressa por escrito.</p>

    <h2>7. Propriedade intelectual</h2>

    <p>7.1. Todo material, arte, texto, código, estratégia, conceito ou produto criado pelo(a) PRESTADOR(A) no âmbito deste contrato será de propriedade da AGÊNCIA, observada a quitação dos valores devidos.</p>

    <h2>8. Disposições gerais</h2>

    <p>8.1. Este contrato representa o entendimento integral entre as partes e substitui acordos anteriores relacionados ao objeto contratado.</p>

    <p>8.2. Nenhuma disposição deste contrato deverá ser interpretada como subordinação, exclusividade obrigatória, pessoalidade absoluta ou controle de jornada.</p>

    <h2>9. Foro</h2>

    <p>9.1. Para dirimir controvérsias oriundas deste contrato, fica eleito o foro de {{contract.jurisdiction}}.</p>

    <p>{{contract.city}}, {{contract.date}}.</p>

    <div class="signature-grid">
      <div class="signature-line">
        {{agency.signerName}}<br />
        AGÊNCIA
      </div>
      <div class="signature-line">
        {{contractor.fullName}}<br />
        PRESTADOR(A)
      </div>
    </div>
  `,
  footerHtml: `<p>Contrato nº {{contract.number}}</p>`,
};

const contractorHomeHourServices: ContractTemplateContent = {
  headerHtml: `
    <h1>Contrato de Prestação de Serviços</h1>
    <p><strong>Contrato nº:</strong> {{contract.number}}</p>
  `,
  bodyHtml: `
    <h2>Entre as partes</h2>

    <p><strong>Contratante:</strong> {{agency.legalName}}, inscrita no CNPJ sob o nº {{agency.taxId}}, com sede em {{agency.address}}, neste ato representada por {{agency.signerName}}, doravante denominada AGÊNCIA.</p>

    <p><strong>Contratado(a):</strong> {{contractor.fullName}}, CPF {{contractor.cpf}}, {{contractor.nationality}}, residente e domiciliado(a) em {{contractor.address}}, doravante denominado(a) PRESTADOR(A).</p>

    <h2>1. Objeto</h2>

    <p>1.1. O presente contrato tem por objeto a prestação de serviços de {{role.title}}, em regime {{work.locationMode}}, conforme demanda, incluindo: {{role.description}}.</p>

    <h2>2. Natureza da relação</h2>

    <p>2.1. Trata-se de contrato de prestação de serviços autônomos, de natureza civil, não gerando vínculo empregatício, societário ou previdenciário entre as partes.</p>

    <p>2.2. O(A) PRESTADOR(A) terá liberdade para organizar seus horários, comprometendo-se com a execução das tarefas demandadas, sem subordinação hierárquica ou controle de jornada pela AGÊNCIA.</p>

    <p>2.3. Sem controle de jornada: {{work.noTimeTracking}}.</p>

    <h2>3. Remuneração e pagamento</h2>

    <p>3.1. A AGÊNCIA pagará ao(à) PRESTADOR(A) o valor de {{payment.hourlyAmount}} por hora efetivamente trabalhada, mediante comprovação em relatório de atividades ou planilha de horas.</p>

    <p>3.2. O relatório deverá ser entregue até o dia {{payment.reportDueDay}} do mês subsequente.</p>

    <p>3.3. O pagamento será realizado até o dia {{payment.dueDay}}, mediante apresentação de {{payment.billingDocument}}.</p>

    <p>3.4. Regra de validação das horas/atividades: {{work.activitiesApprovalRule}}.</p>

    <h2>4. Prazo e rescisão</h2>

    <p>4.1. O presente contrato terá prazo de {{contract.termMonths}} meses, podendo ser renovado conforme acordo entre as partes.</p>

    <p>4.2. Renovação automática: {{contract.autoRenewal}}.</p>

    <p>4.3. Qualquer das partes poderá rescindir este contrato mediante aviso prévio, sem prejuízo de valores devidos por serviços já prestados.</p>

    <h2>5. Confidencialidade</h2>

    <p>5.1. O(A) PRESTADOR(A) compromete-se a manter sigilo absoluto sobre informações, dados, estratégias, materiais, clientes e processos da AGÊNCIA.</p>

    <h2>6. Não-solicitação</h2>

    <p>6.1. Pelo prazo de 6 meses após o término deste contrato, o(a) PRESTADOR(A) não poderá prestar serviços diretamente para clientes ativos da AGÊNCIA com os quais tenha tido contato em razão deste contrato, salvo autorização por escrito.</p>

    <h2>7. Propriedade intelectual</h2>

    <p>7.1. Todo material, arte, texto, código, peça, estratégia ou produto criado no âmbito deste contrato será de propriedade da AGÊNCIA, condicionada à quitação dos valores devidos.</p>

    <h2>8. Foro</h2>

    <p>8.1. As partes elegem o foro de {{contract.jurisdiction}} para dirimir dúvidas oriundas deste contrato.</p>

    <p>{{contract.city}}, {{contract.date}}.</p>

    <div class="signature-grid">
      <div class="signature-line">
        {{agency.signerName}}<br />
        AGÊNCIA
      </div>
      <div class="signature-line">
        {{contractor.fullName}}<br />
        PRESTADOR(A)
      </div>
    </div>
  `,
  footerHtml: `<p>Contrato nº {{contract.number}}</p>`,
};

export function getContractTemplateContentByPresetKey(
  presetKey: string,
): ContractTemplateContent | null {
  const map: Record<string, ContractTemplateContent> = {
    client_recurring_marketing_services: clientRecurringMarketingServices,
    client_short_term_marketing_services: clientShortTermMarketingServices,
    mei_contractor_monthly_services: meiContractorMonthlyServices,
    contractor_home_hour_services: contractorHomeHourServices,
  };

  return map[presetKey] ?? null;
}
