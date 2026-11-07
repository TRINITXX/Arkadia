import { memo, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { fileName } from "@/lib/chat/chatAttachments";
import { C, T } from "~/chat/chat-theme";
import { F } from "~/chat/feed/feed-style";
import { useOpenImage } from "~/chat/feed/image-viewer";
import { imageSource } from "~/chat/feed/pc-image";

/** A load that fails is tried again this often, this many times (a phone's network). */
const RETRY_MS = 4000;
const RETRIES = 3;

/** The desktop's strip (92 px high) on a phone, and its tool line's 22 px. */
const STRIP = { height: 72, min: 48, max: 160 };
const LINE = { height: 22, min: 16, max: 44 };

/**
 * An image of the chat, small: a PC file (`/image`) or one pasted in the
 * chat; as wide as its shape once loaded. A tap opens it full size
 * (`ImageViewerHost`). One that can't be read after its retries: its name
 * in a tool line (`ChatReadThumb`) or for a file the message attaches
 * (`named`), nothing for a path the prose names (it may name no file).
 */
export const ImageThumb = memo(function ImageThumb({
  path,
  url,
  small = false,
  named = false,
  quiet = false,
}: {
  /** The file, or a pasted image's name (« Image collée 1 »). */
  path: string;
  /** A pasted image's data: shown, never fetched. */
  url?: string;
  /** In a tool line, in place of its path. */
  small?: boolean;
  /** Failed, its name stays (an attached file, never lost from sight). */
  named?: boolean;
  /** Failed, nothing shows: on a reply's line, a name would squeeze it. */
  quiet?: boolean;
}) {
  const open = useOpenImage();
  const [ratio, setRatio] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  // Each try mounts the image anew: a failed load is not cached.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!failed || attempt >= RETRIES) return;
    const timer = setTimeout(() => {
      setFailed(false);
      setAttempt((a) => a + 1);
    }, RETRY_MS);
    return () => clearTimeout(timer);
  }, [failed, attempt]);
  const source = useMemo(() => imageSource({ path, url }), [path, url]);
  const size = small ? LINE : STRIP;
  const width = ratio
    ? Math.min(size.max, Math.max(size.min, Math.round(size.height * ratio)))
    : size.height;
  const name = url ? path : fileName(path);
  if (failed)
    return (small || named) && !quiet ? (
      <Text style={styles.alt} numberOfLines={1}>
        {name}
      </Text>
    ) : null;
  return (
    <Pressable
      onPress={open ? () => open({ path, url }) : undefined}
      disabled={!open}
      hitSlop={small ? 8 : 0}
      accessibilityRole="imagebutton"
      accessibilityLabel={name}
      accessibilityHint="Ouvrir en grand"
      style={({ pressed }) => pressed && styles.pressed}
    >
      <Image
        key={attempt}
        source={source}
        style={[
          small ? styles.line : styles.strip,
          { width, height: size.height },
        ]}
        contentFit="cover"
        transition={120}
        onLoad={({ source: s }) => {
          if (s.width > 0 && s.height > 0) setRatio(s.width / s.height);
        }}
        onError={() => setFailed(true)}
      />
    </Pressable>
  );
});

/** The images a message names, under its words (`ChatGallery`). */
export function ImageStrip({ paths }: { paths: readonly string[] }) {
  if (paths.length === 0) return null;
  return (
    <View style={styles.stripRow}>
      {paths.map((path) => (
        <ImageThumb key={path} path={path} />
      ))}
    </View>
  );
}

/** The images Claude read, in their tool line (`ChatReadThumbs`); with
 *  `quiet`, on a reply's line after its icons (`ChatThumbStrip`). */
export function ReadThumbs({
  paths,
  quiet = false,
}: {
  paths: readonly string[];
  quiet?: boolean;
}) {
  if (paths.length === 0) return null;
  return (
    <View style={[styles.lineRow, quiet && styles.afterIcons]}>
      {paths.map((path) => (
        <ImageThumb key={path} path={path} small quiet={quiet} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stripRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  lineRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  afterIcons: { marginLeft: 4 },
  strip: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: F.thumbLine,
    backgroundColor: F.gapBg,
  },
  line: {
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: F.thumbLine,
    backgroundColor: F.thumbBg,
  },
  pressed: { opacity: 0.7 },
  alt: { color: C.mute, fontSize: T.tiny, maxWidth: 120 },
});
