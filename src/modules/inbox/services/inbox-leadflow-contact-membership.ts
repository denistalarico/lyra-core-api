import type { EntityManager } from 'typeorm';
import { ContactListEntity } from '../../contacts/entities/contact-list.entity';
import { ContactListMemberEntity } from '../../contacts/entities/contact-list-member.entity';
import { InboxChannelEntity } from '../entities/inbox-channel.entity';

/**
 * Puts a LeadFlow contact in the protected "LeadFlow" list and, for a
 * client-scoped channel, in that client's sublist. Idempotent: lists are
 * upserted and memberships inserted with ON CONFLICT DO NOTHING.
 */
export async function ensureLeadFlowContactMembership(
  manager: EntityManager,
  scope: { tenantId: string; workspaceId: string },
  channelId: string,
  contactId: string,
): Promise<void> {
  const channel = await manager.getRepository(InboxChannelEntity).findOneBy({
    id: channelId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
  });
  const lists = manager.getRepository(ContactListEntity);
  await manager.query(
    `INSERT INTO contact_lists
      (tenant_id,workspace_id,name,description,color,parent_list_id,visibility,
       created_by_user_id,is_system,is_protected,source_product,source_context)
     VALUES ($1,$2,'LeadFlow','Contatos canônicos do LeadFlow.','#2563EB',NULL,
       'workspace',NULL,true,true,'leadflow','shared_contacts')
     ON CONFLICT (workspace_id,name) DO UPDATE SET
       is_system=true,is_protected=true,source_product='leadflow'`,
    [scope.tenantId, scope.workspaceId],
  );
  const parent = await lists.findOneBy({
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    name: 'LeadFlow',
  });
  if (!parent) throw new Error('leadflow_contact_list_missing');
  const listIds = [parent.id];
  const clientId =
    typeof channel?.metadata?.clientId === 'string'
      ? channel.metadata.clientId
      : null;
  if (clientId) {
    const clientName =
      typeof channel?.metadata?.clientName === 'string' &&
      channel.metadata.clientName.trim()
        ? channel.metadata.clientName.trim().slice(0, 120)
        : `Cliente ${clientId.slice(0, 8)}`;
    await manager.query(
      `INSERT INTO contact_lists
        (tenant_id,workspace_id,name,description,color,parent_list_id,visibility,
         created_by_user_id,is_system,is_protected,source_product,source_context)
       VALUES ($1,$2,$3,'Contatos do LeadFlow deste cliente.','#2563EB',$4,
         'workspace',NULL,true,true,'leadflow',$5)
       ON CONFLICT (workspace_id,name) DO UPDATE SET
         is_system=true,is_protected=true,source_product='leadflow',
         source_context=EXCLUDED.source_context,parent_list_id=EXCLUDED.parent_list_id`,
      [
        scope.tenantId,
        scope.workspaceId,
        clientName,
        parent.id,
        `client:${clientId}`,
      ],
    );
    const child = await lists.findOneBy({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      parentListId: parent.id,
      sourceContext: `client:${clientId}`,
    });
    if (child) listIds.push(child.id);
  }
  for (const listId of listIds) {
    await manager
      .getRepository(ContactListMemberEntity)
      .createQueryBuilder()
      .insert()
      .values({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        listId,
        contactId,
        addedByUserId: null,
      })
      .orIgnore()
      .execute();
  }
}
