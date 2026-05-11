export * from "../protocol/remote";

import type { ConnectionProfile } from "../protocol/remote";

export interface DesktopConnectionProfile extends ConnectionProfile {
  accentColor?: string;
}
