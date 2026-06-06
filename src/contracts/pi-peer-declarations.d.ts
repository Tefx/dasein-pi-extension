/**
 * Compile-time declarations for approved Pi peer dependency imports.
 *
 * The package contract keeps these packages in peerDependencies so Dasein does
 * not bundle Pi-owned runtime APIs. Live import behavior remains a smoke gate.
 */
declare module "@earendil-works/pi-tui" {
  export interface SettingsListContractItem {
    readonly id: string;
    readonly label: string;
  }

  export class SettingsList {
    constructor(...args: never[]);
  }

  export function getSettingsListTheme(...args: never[]): unknown;
  export function matchesKey(data: string, key: string): boolean;
  export function truncateToWidth(text: string, width: number, ellipsis?: string, pad?: boolean): string;
  export function visibleWidth(text: string): number;
  export function wrapTextWithAnsi(text: string, width: number): string[];
}

declare module "@earendil-works/pi-coding-agent" {
  export interface PiExtensionContractMarker {
    readonly packageName?: string;
  }

  export function getSettingsListTheme(...args: never[]): unknown;
}
