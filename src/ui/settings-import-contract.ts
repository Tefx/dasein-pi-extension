/**
 * SettingsList import-resolution contract.
 *
 * Contract obligations pinned here:
 * - SettingsList and getSettingsListTheme resolve from @earendil-works/pi-tui.
 * - @earendil-works/pi-tui is an approved Pi peer dependency, not a bundled
 *   runtime dependency.
 * - This file performs no SettingsList rendering or interaction logic.
 */
import { SettingsList, getSettingsListTheme } from "@earendil-works/pi-tui";

export type SettingsListPeerImportContract = {
  readonly SettingsList: typeof SettingsList;
  readonly getSettingsListTheme: typeof getSettingsListTheme;
  readonly packageName: "@earendil-works/pi-tui";
  readonly dependencyPlacement: "peerDependencies";
};

export type { SettingsList };
export { getSettingsListTheme };
