export const STASH_RULES = {
  maximumTabs: 8,
  maximumNameLength: 24,
  defaultTabs: [
    { id: "stash-tab-general", name: "General" },
    { id: "stash-tab-gear", name: "Gear" },
    { id: "stash-tab-maps", name: "Maps" },
    { id: "stash-tab-materials", name: "Materials" },
  ],
} as const;
