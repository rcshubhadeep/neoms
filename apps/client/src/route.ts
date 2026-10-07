// Hash routes work identically in the browser and the desktop shell, which serves files.
export const settingsTabs = ['members', 'invitations', 'llm', 'usage', 'agent-policy'] as const;
export type SettingsTab = (typeof settingsTabs)[number];
export type Route = { workspace?: string; conversation?: string; settings?: SettingsTab };

export function parseRoute(hash: string): Route {
  const [w, workspace, section, value] = hash.replace(/^#\/?/, '').split('/');
  if (w !== 'w' || !workspace) return {};
  if (section === 'c' && value) return { workspace, conversation: value };
  if (section === 'settings')
    return {
      workspace,
      settings: settingsTabs.includes(value as SettingsTab) ? (value as SettingsTab) : 'members',
    };
  return { workspace };
}

export function formatRoute({ workspace, conversation, settings }: Route) {
  if (!workspace) return '';
  if (settings) return `#/w/${workspace}/settings/${settings}`;
  return conversation ? `#/w/${workspace}/c/${conversation}` : `#/w/${workspace}`;
}
