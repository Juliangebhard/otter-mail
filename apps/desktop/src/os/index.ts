/**
 * The operating system the app runs on (HostOS, os/types.ts): macOS or Linux.
 * Everything that differs between them is asked of `hostOS`.
 */

import { linuxOS } from "./linux/index.js";
import { macOS } from "./mac/index.js";
import type { HostOS } from "./types.js";

export const hostOS: HostOS = process.platform === "darwin" ? macOS : linuxOS;
