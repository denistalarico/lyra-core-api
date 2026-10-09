import { Injectable } from '@nestjs/common';
import { FilesService } from '../../../common/files/files.service';
import { DocumentLayoutsService } from '../../document-layouts/document-layouts.service';
import { DocumentPdfRendererService } from '../../document-layouts/document-pdf-renderer.service';
import type { AgencyMeetingAiSummary, AgencyMeetingRoom } from '../entities';
import {
  meetingAiCost,
  type MeetingAiAction,
  type MeetingAiEvidence,
} from '../meeting-ai.types';

export async function readMeetingAsset(
  body: AsyncIterable<Buffer | Uint8Array | string>,
  limit: number,
) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit)
      throw new Error('Arquivo excede o limite de processamento.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
const escape = (value: string | null | undefined) =>
  (value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

@Injectable()
export class TeamChatMeetingAiPdfService {
  constructor(
    private readonly files: FilesService,
    private readonly layouts: DocumentLayoutsService,
    private readonly renderer: DocumentPdfRendererService,
  ) {}

  async render(
    row: AgencyMeetingAiSummary,
    room: AgencyMeetingRoom,
    persistSnapshot: () => Promise<void>,
  ) {
    const execution = row.execution!;
    if (!execution.layoutSnapshotRef) {
      const layout = await this.layouts.getDefaultLayout({
        tenantId: room.tenantId,
        workspaceId: room.workspaceId,
      });
      const template = await this.layouts.getSystemTemplateForType(
        layout.layoutType,
      );
      const chrome = this.renderer.buildLayoutChrome(layout, template);
      // Inline only assets served by our own storage service. Chromium receives no network access.
      if (chrome.logoUrl) {
        let image = '';
        try {
          const assetPath = new URL(
            chrome.logoUrl,
            'http://local',
          ).pathname.match(/\/api\/assets\/(.+)$/)?.[1];
          if (assetPath) {
            const asset = await this.files.getAsset(
              decodeURIComponent(assetPath),
            );
            if (/^image\/(png|jpeg|webp)$/.test(asset.contentType))
              image = `data:${asset.contentType};base64,${(await readMeetingAsset(asset.body, 1024 * 1024)).toString('base64')}`;
          }
        } catch {
          /* A missing logo does not prevent the document being issued. */
        }
        chrome.headerHtml = chrome.headerHtml.replaceAll(
          escape(chrome.logoUrl),
          image,
        );
      }
      const layoutSnapshotRef = `${execution.audioRef.slice(0, -'audio.mp3'.length)}layout.json`;
      await this.files.uploadPrivateBuffer({
        path: layoutSnapshotRef,
        body: Buffer.from(
          JSON.stringify({
            layoutId: layout.id,
            capturedAt: new Date().toISOString(),
            chrome,
          }),
        ),
        contentType: 'application/json',
      });
      execution.layoutSnapshotRef = layoutSnapshotRef;
      await persistSnapshot();
    }
    const snapshot = await this.files.getPrivateAsset(
      execution.layoutSnapshotRef,
    );
    const { chrome } = JSON.parse(
      (await readMeetingAsset(snapshot.body, 2 * 1024 * 1024)).toString(),
    ) as { chrome: { css: string; headerHtml: string; footerHtml: string } };
    const stringSection = (title: string, items: string[] | null) =>
      `<section><h2>${escape(title)}</h2>${items?.length ? `<ul>${items.map((item) => `<li>${escape(item)}</li>`).join('')}</ul>` : '<p>Não registrado.</p>'}</section>`;
    const evidenceSection = (
      title: string,
      items: Array<MeetingAiEvidence | MeetingAiAction> | null,
      actions = false,
    ) =>
      `<section><h2>${escape(title)}</h2>${
        items?.length
          ? items
              .map((value) => {
                const item = value as MeetingAiEvidence &
                  Partial<MeetingAiAction>;
                return `<article><p><strong>${escape(item.text)}</strong>${actions ? `<br>Responsável: ${escape(item.owner || 'Não definido')} · Prazo: ${escape(item.dueDate || 'Não definido')}` : ''}</p><blockquote>${escape(item.evidence)}</blockquote></article>`;
              })
              .join('')
          : '<p>Não registrado.</p>'
      }</section>`;
    const cost = meetingAiCost(execution.calls);
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${chrome.css}
      @page { size: A4; margin: 12mm; } body { font-family: Arial, sans-serif; font-size: 11px; color: #172033; }
      table.meeting-report { width:100%; border-collapse:collapse; } thead { display:table-header-group; } tfoot { display:table-footer-group; }
      .doc-header,.doc-footer { position:static !important; } .doc-header { margin-bottom:16px; } .doc-footer { margin-top:16px; font-size:9px; }
      h1 { font-size:22px; } h2 { font-size:15px; margin-top:20px; break-after:avoid; } p { white-space:pre-wrap; line-height:1.6; }
      article,li,blockquote { break-inside:avoid; } blockquote { border-left:2px solid #cbd5e1; padding-left:10px; margin-left:0; color:#475569; } img { max-height:64px; max-width:160px; }
      </style></head><body><table class="meeting-report"><thead><tr><td>${chrome.headerHtml}</td></tr></thead><tfoot><tr><td>${chrome.footerHtml}</td></tr></tfoot><tbody><tr><td>
      <h1>Resumo da reunião — ${escape(room.title)}</h1><p>Início: ${escape(room.startedAt?.toISOString())}\nEncerramento: ${escape(room.endedAt?.toISOString())}\nParticipantes: ${escape(execution.participants?.join(', ') || 'Não registrados')}\nCobertura: ${execution.partial ? 'Parcial; a captura não cobre toda a reunião.' : 'Desde o início da reunião.'}\nÁudio analisado: ${Math.round(execution.audioSeconds ?? 0)} segundos</p>
      <section><h2>Resumo executivo</h2><p>${escape(row.summary)}</p></section>
      ${stringSection('Principais tópicos', row.topics)}${evidenceSection('Acordos', row.agreements)}${evidenceSection('Decisões', row.decisions)}
      ${evidenceSection('Ações', row.actionItems, true)}${stringSection('Próximos passos', row.nextSteps)}${stringSection('Pendências', row.openQuestions)}
      <section><h2>Custo de IA</h2><p>${cost === null ? 'Custo desconhecido: uma tentativa não retornou uso confirmado.' : `Estimativa: US$ ${cost.toFixed(6)}`}\nConta de despesa: ${escape(execution.accountName)}\nCentro de custo: ${escape(execution.costCenterName)}\nTarifas verificadas em ${escape(execution.rates.date)}. Custos de captura e armazenamento não incluídos.</p></section>
      </td></tr></tbody></table></body></html>`;
    const buffer = await this.renderer.renderHtmlToPdf(html, {
      untrusted: { allowRequest: (url) => url.startsWith('data:') },
      margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
    });
    const pdfRef = `${execution.audioRef.slice(0, -'audio.mp3'.length)}summary.pdf`;
    await this.files.uploadPrivateBuffer({
      path: pdfRef,
      body: buffer,
      contentType: 'application/pdf',
    });
    return pdfRef;
  }
}
