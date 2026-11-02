import type { ImageSource } from "expo-image";
import type { ImageRef } from "@/lib/imageRef";
import { ARKADIA_HOST } from "~/remote/config";

/**
 * An image of the chat as expo-image loads it: a pasted one from the data
 * the chat keeps; a PC file through the PC's `/image` route
 * (`conv-images.tsx`), which takes only requests that say they come from
 * its own page.
 */
export function imageSource({ path, url }: ImageRef): ImageSource {
  if (url) return { uri: url };
  return {
    uri: `https://${ARKADIA_HOST}/image?path=${encodeURIComponent(path)}`,
    headers: { "Sec-Fetch-Site": "same-origin" },
  };
}
