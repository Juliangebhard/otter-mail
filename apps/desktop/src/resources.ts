/** Files the app ships next to its code: the app icons (resources/app-icons). */

import { app, nativeImage, type NativeImage } from "electron";
import { join } from "node:path";

export function appIconImage(id: string): NativeImage {
  const dir = app.isPackaged
    ? join(process.resourcesPath, "app-icons")
    : join(app.getAppPath(), "resources/app-icons");
  return nativeImage.createFromPath(join(dir, `${id}.png`));
}
