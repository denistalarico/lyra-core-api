import { Injectable } from '@nestjs/common';
import {
  getPresetByKey,
  getPresetsForBusinessMode,
  isCustomBusinessMode,
  type LeadFlowAgentPresetCatalogItem,
} from '../catalog/agent-presets.catalog';

/**
 * Resolves predefined agent presets compatible with the active Business Mode.
 * Business Mode itself is owned by LeadFlow Settings — this service never
 * chooses or mutates it, it only reads a key and returns compatible presets.
 */
@Injectable()
export class LeadFlowAgentPresetService {
  listPresetsForBusinessMode(
    businessModeKey: string,
  ): LeadFlowAgentPresetCatalogItem[] {
    return getPresetsForBusinessMode(businessModeKey);
  }

  getPreset(presetKey: string): LeadFlowAgentPresetCatalogItem | undefined {
    return getPresetByKey(presetKey);
  }

  isCustomBusinessMode(businessModeKey: string): boolean {
    return isCustomBusinessMode(businessModeKey);
  }
}
