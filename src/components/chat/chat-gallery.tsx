import { Images } from "lucide-react";
import {
  ImageThumb,
  type LightboxContent,
} from "@/components/modern/ImageThumb";
import { VideoThumb } from "@/components/modern/VideoThumb";
import type { ImageRef } from "@/lib/imageGallery";
import { isVideoPath } from "@/lib/imagePaths";

/**
 * The strip under a message: its pasted images, then the image and video
 * files it names. A click opens the lightbox, whose ←/→ walk every image of
 * the conversation. `dropped` pasted images are no longer in memory (the
 * newest are kept, `keepPasted`): a chip counts them.
 */
export function ChatGallery({
  refs,
  dropped = 0,
  onOpen,
}: {
  refs: ImageRef[];
  dropped?: number;
  onOpen: (content: LightboxContent) => void;
}) {
  if (refs.length === 0 && dropped === 0) return null;
  return (
    <div className="chat-gallery">
      {dropped > 0 && (
        <span
          className="chat-gallery-more"
          title="Collées plus tôt : seules les dernières images collées restent en mémoire"
        >
          <Images /> {dropped} image{dropped > 1 ? "s" : ""}
        </span>
      )}
      {refs.map((ref) => {
        const { url } = ref;
        if (url) {
          return (
            <img
              key={ref.path}
              className="modern-thumb"
              src={url}
              alt={ref.path}
              title={ref.path}
              onClick={(e) => {
                e.stopPropagation();
                onOpen({ kind: "image", url, path: ref.path });
              }}
            />
          );
        }
        return isVideoPath(ref.path) ? (
          <VideoThumb key={ref.path} path={ref.path} onOpen={onOpen} />
        ) : (
          <ImageThumb
            key={ref.path}
            path={ref.path}
            mediaType={ref.mediaType}
            onOpen={onOpen}
          />
        );
      })}
    </div>
  );
}
