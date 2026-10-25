export type OrionCapabilitiesManifest = {
  version: 1;
  /** Operations Room commands answered without AI (OR1 interpreter). */
  commands: Array<{
    slash: string;
    label: string;
    description: string;
    example: string;
    ready: boolean;
  }>;
  /** Screens of the Agency web app; the only targets of `navigate`. */
  routes: Array<{ path: string; label: string }>;
  /** Each tool and the permission it stands in for (product · module · resource · action). */
  tools: Array<{ name: string; needs: string[]; clientArea: boolean }>;
};
