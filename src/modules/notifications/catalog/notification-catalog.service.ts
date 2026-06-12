import { Injectable, OnModuleInit } from '@nestjs/common';
import { NotificationProductKey } from '../enums';
import { NotificationDefinition } from '../types';
import { AGENCY_NOTIFICATION_CATALOG } from './agency-notification.catalog';

@Injectable()
export class NotificationCatalogService implements OnModuleInit {
  private readonly definitions = new Map<string, NotificationDefinition>();

  onModuleInit(): void {
    for (const definition of AGENCY_NOTIFICATION_CATALOG) {
      const key = this.createKey(
        definition.productKey,
        definition.eventType,
      );

      if (this.definitions.has(key)) {
        throw new Error(
          `Duplicate notification definition: ${key}`,
        );
      }

      this.definitions.set(key, definition);
    }
  }

  getDefinition(
    productKey: NotificationProductKey,
    eventType: string,
  ): NotificationDefinition | null {
    return (
      this.definitions.get(this.createKey(productKey, eventType)) ??
      null
    );
  }

  requireDefinition(
    productKey: NotificationProductKey,
    eventType: string,
  ): NotificationDefinition {
    const definition = this.getDefinition(productKey, eventType);

    if (!definition) {
      throw new Error(
        `Notification event is not cataloged: ${productKey}:${eventType}`,
      );
    }

    return definition;
  }

  listDefinitions(): NotificationDefinition[] {
    return Array.from(this.definitions.values());
  }

  listByProduct(
    productKey: NotificationProductKey,
  ): NotificationDefinition[] {
    return this.listDefinitions().filter(
      (definition) => definition.productKey === productKey,
    );
  }

  listByModule(
    productKey: NotificationProductKey,
    moduleKey: string,
  ): NotificationDefinition[] {
    return this.listDefinitions().filter(
      (definition) =>
        definition.productKey === productKey &&
        definition.moduleKey === moduleKey,
    );
  }

  private createKey(
    productKey: NotificationProductKey,
    eventType: string,
  ): string {
    return `${productKey}:${eventType}`;
  }
}
