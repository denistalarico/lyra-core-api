import { Global, Injectable, Module, NotFoundException } from '@nestjs/common';
import type { Readable } from 'node:stream';

export type CompanyLogoScope = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string;
  companyContextId?: string;
  surface?: 'agency' | 'client_area';
};
type Resolver = (
  scopes: readonly CompanyLogoScope[],
) => Promise<Array<string | null>>;
type Reader = (
  scope: CompanyLogoScope,
) => Promise<{ mimeType: string; body: Readable }>;

@Injectable()
export class CompanyLogoRegistry {
  private resolver?: Resolver;
  private reader?: Reader;
  register(resolve: Resolver, read: Reader) {
    if (this.resolver)
      throw new Error('Company logo resolver already registered.');
    this.resolver = resolve;
    this.reader = read;
  }
  resolveMany(scopes: readonly CompanyLogoScope[]) {
    return this.resolver?.(scopes) ?? Promise.resolve(scopes.map(() => null));
  }
  async resolve(scope: CompanyLogoScope) {
    return (await this.resolveMany([scope]))[0] ?? null;
  }
  async read(scope: CompanyLogoScope) {
    if (!this.reader) throw new NotFoundException('Logo not found.');
    return this.reader(scope);
  }
}
@Global()
@Module({ providers: [CompanyLogoRegistry], exports: [CompanyLogoRegistry] })
export class CompanyLogoRegistryModule {}
