import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  CreateKnowledgeVaultItemDto,
  GrantKnowledgeVaultPermissionDto,
  RevealKnowledgeVaultItemDto,
  UpdateKnowledgeVaultItemDto,
} from "../dto";
import {
  KnowledgeVaultReauthService,
  KnowledgeVaultService,
} from "../services";
import { KnowledgeContext } from "../services/knowledge-context";

function buildKnowledgeContext(headers: Record<string, string | string[] | undefined>): KnowledgeContext {
  return {
    tenantId: String(headers["x-tenant-id"] ?? ""),
    workspaceId: String(headers["x-workspace-id"] ?? ""),
    userId: String(headers["x-user-id"] ?? ""),
    role: String(headers["x-user-role"] ?? ""),
  };
}

@Controller("agency/knowledge/vault")
export class KnowledgeVaultController {
  constructor(
    private readonly vaultService: KnowledgeVaultService,
    private readonly reauthService: KnowledgeVaultReauthService,
  ) {}

  @Get()
  list(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.vaultService.list(buildKnowledgeContext(headers));
  }

  @Post()
  create(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateKnowledgeVaultItemDto,
  ) {
    return this.vaultService.create(buildKnowledgeContext(headers), dto);
  }

  @Patch(":id")
  update(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("id") id: string,
    @Body() dto: UpdateKnowledgeVaultItemDto,
  ) {
    return this.vaultService.update(buildKnowledgeContext(headers), id, dto);
  }

  @Post(":id/permissions")
  grantPermission(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("id") id: string,
    @Body() dto: GrantKnowledgeVaultPermissionDto,
  ) {
    return this.vaultService.grantPermission(buildKnowledgeContext(headers), id, dto);
  }

  @Post(":id/reveal")
  async reveal(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("id") id: string,
    @Body() dto: RevealKnowledgeVaultItemDto,
  ) {
    const context = buildKnowledgeContext(headers);

    await this.reauthService.verifyPassword(context, dto.password);

    return this.vaultService.reveal(context, id);
  }
}
