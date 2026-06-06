/**
 * SettingsList import-resolution contract.
 *
 * Contract obligations pinned here:
 * - SettingsList resolves from @earendil-works/pi-tui.
 * - getSettingsListTheme resolves from @earendil-works/pi-coding-agent.
 * - Both packages are approved Pi peer dependencies, not bundled runtime
 *   dependencies.
 * - This file performs no SettingsList rendering or interaction logic.
 */
import { SettingsList } from "@earendil-works/pi-tui";

type SettingsThemeLoader = (...args: never[]) => unknown;

const piCodingAgentPackageName = "@earendil-works/pi-coding-agent";
const piCodingAgentPeer = (await import(piCodingAgentPackageName)) as {
  readonly getSettingsListTheme?: SettingsThemeLoader;
};

if (typeof piCodingAgentPeer.getSettingsListTheme !== "function") {
  throw new Error("@earendil-works/pi-coding-agent must export getSettingsListTheme");
}

export const getSettingsListTheme: SettingsThemeLoader = piCodingAgentPeer.getSettingsListTheme;

export type SettingsListPeerImportContract = {
  readonly SettingsList: typeof SettingsList;
  readonly getSettingsListTheme: typeof getSettingsListTheme;
  readonly settingsListPackageName: "@earendil-works/pi-tui";
  readonly settingsThemePackageName: "@earendil-works/pi-coding-agent";
  readonly dependencyPlacement: "peerDependencies";
};

export { SettingsList };
