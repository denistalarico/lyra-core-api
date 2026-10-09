/** Real document renderer + Chromium; storage/layout repositories are fixture boundaries.
 * No environment credentials, production data, provider calls or graph updates.
 */
require('ts-node').register({ transpileOnly: true });
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Readable } = require('node:stream');
const { execFileSync } = require('node:child_process');
const { TeamChatMeetingAiPdfService } = require('../src/modules/team-chat/services/team-chat-meeting-ai-pdf.service');
const { DocumentPdfRendererService } = require('../src/modules/document-layouts/document-pdf-renderer.service');
const { MEETING_AI_RATES } = require('../src/modules/team-chat/services/team-chat-meeting-ai-provider.service');

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-meeting-ai-pdf-'));
  const objects = new Map();
  const files = {
    uploadPrivateBuffer: async ({ path, body }) => { objects.set(path, body); return { path }; },
    getPrivateAsset: async path => ({ body: Readable.from([objects.get(path)]) }),
    getAsset: async () => { throw new Error('Remote assets forbidden in this fixture'); },
  };
  let layoutReads = 0;
  const layouts = {
    getDefaultLayout: async () => { layoutReads++; return { id: 'layout-fixture', layoutType: 'essence', companyName: 'Agência de Teste Lyra', footerText: 'Rodapé configurado em Documentos — uso interno', primaryColor: '#2563eb', companyAddressLine1: 'São Paulo' }; },
    getSystemTemplateForType: async () => null,
  };
  const renderer = new DocumentPdfRendererService();
  const service = new TeamChatMeetingAiPdfService(files, layouts, renderer);
  const room = { title: 'Planejamento de publicação', tenantId: 'fixture-tenant', workspaceId: 'fixture-workspace', startedAt: new Date('2026-10-09T12:00:00Z'), endedAt: new Date('2026-10-09T13:00:00Z') };
  const row = {
    summary: 'A equipe alinhou a publicação e confirmou os acordos abaixo.',
    topics: ['Campanha', 'Prazos'], nextSteps: ['Revisar as peças.'], openQuestions: ['Definir orçamento.'], actionItems: [],
    agreements: Array.from({ length: 70 }, (_, index) => ({ text: `Acordo ${index + 1}: preparar a campanha e revisar as peças com a equipe.`, evidence: 'Vamos preparar a campanha e revisar as peças antes de publicar.' })),
    decisions: [{ text: '<script>INJECAO_EXECUTADA</script>', evidence: '<img src="http://127.0.0.1:1/private">' }],
    execution: { audioRef: 'meeting-ai/fixture/audio.mp3', partial: true, audioSeconds: 3600, participants: ['Ana', 'Bruno'], calls: [], accountName: 'Despesas com IA', costCenterName: 'Operações', rates: MEETING_AI_RATES },
  };
  let checkpoint = 0;
  const upload = files.uploadPrivateBuffer;
  files.uploadPrivateBuffer = async () => { throw new Error('Temporary layout upload failure'); };
  await assert.rejects(service.render(row, room, async () => { checkpoint++; }), /Temporary/);
  assert.equal(row.execution.layoutSnapshotRef, undefined);
  files.uploadPrivateBuffer = upload;
  const pdfRef = await service.render(row, room, async () => { checkpoint++; });
  const pdf = objects.get(pdfRef);
  assert(pdf.subarray(0, 5).toString() === '%PDF-');
  const filename = path.join(directory, 'summary.pdf'); fs.writeFileSync(filename, pdf);
  const text = execFileSync('pdftotext', [filename, '-'], { encoding: 'utf8' });
  const pages = text.split('\f').filter(page => page.trim());
  assert(pages.length >= 3, 'Expected multiple pages');
  for (const page of pages) {
    assert(page.includes('Agência de Teste Lyra'), 'Header must repeat on every page');
    assert(page.includes('Rodapé configurado em Documentos'), 'Footer must repeat on every page');
  }
  assert(text.includes('Acordo 70')); assert(text.includes('Cobertura: Parcial'));
  assert(text.includes('<script>INJECAO_EXECUTADA</script>'), 'HTML must remain escaped text');
  await service.render(row, room, async () => { checkpoint++; });
  assert.equal(layoutReads, 2); assert.equal(checkpoint, 1);
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify({ pages: pages.length, repeatedHeaderFooter: true, escapedContent: true, frozenLayout: true, transientLayoutUploadRecovery: true }, null, 2));
  console.log(JSON.stringify({ pages: pages.length, repeatedHeaderFooter: true, escapedContent: true, frozenLayout: true, transientLayoutUploadRecovery: true, artifacts: directory }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
