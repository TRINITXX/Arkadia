import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fileName } from "@/lib/chat/chatAttachments";
import type { ChatItem } from "@/lib/chat/chatState";
import { viewerImages, viewerIndex } from "@/lib/chat/phoneImages";
import type { ImageRef } from "@/lib/imageRef";
import { C, T } from "~/chat/chat-theme";
import { imageSource } from "~/chat/feed/pc-image";

type OpenImage = (image: ImageRef) => void;

const OpenImageContext = createContext<OpenImage | null>(null);

/** Opens an image full size over where it is; null outside a host. */
export function useOpenImage(): OpenImage | null {
  return useContext(OpenImageContext);
}

/** A pasted image is named by the chat (« Image collée 2 »), a file by its name. */
const nameOf = (image: ImageRef) =>
  image.url ? image.path : fileName(image.path);

/**
 * Where the thumbnails under it open their image: full size over the feed,
 * or over the sheet they're in (iOS stacks a modal only from the one under
 * it, so each feed and each sheet hosts its own). The viewer walks the
 * chat's images (`viewerImages`, the desktop lightbox's ←/→), read when it
 * opens: a streamed token doesn't touch it.
 */
export function ImageViewerHost({
  items,
  children,
}: {
  items: ChatItem[];
  children: ReactNode;
}) {
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });
  // `n` mounts a new viewer per opening: its list starts on the image.
  const [view, setView] = useState<{
    list: ImageRef[];
    start: number;
    n: number;
  } | null>(null);
  const [shown, setShown] = useState(false);
  const open = useCallback((image: ImageRef) => {
    const all = viewerImages(itemsRef.current);
    const at = viewerIndex(all, image);
    setView((v) => ({
      list: at < 0 ? [image] : all,
      start: Math.max(at, 0),
      n: (v?.n ?? 0) + 1,
    }));
    setShown(true);
  }, []);
  const close = useCallback(() => setShown(false), []);
  return (
    <OpenImageContext.Provider value={open}>
      {children}
      {view && (
        <ImageViewer
          key={view.n}
          visible={shown}
          list={view.list}
          start={view.start}
          onClose={close}
        />
      )}
    </OpenImageContext.Provider>
  );
}

/**
 * The chat's images full size on black (the desktop's lightbox): a swipe
 * sideways goes to the next or the previous, a pinch zooms in, « Fermer »
 * closes.
 */
function ImageViewer({
  visible,
  list,
  start,
  onClose,
}: {
  visible: boolean;
  list: ImageRef[];
  start: number;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(start);
  const current = list[index] ?? list[0];
  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  const renderItem = ({ item }: ListRenderItemInfo<ImageRef>) => (
    <ZoomPage image={item} width={width} height={height} />
  );
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.screen}>
        <FlatList
          data={list}
          horizontal
          pagingEnabled
          initialScrollIndex={start}
          getItemLayout={(_, i) => ({
            length: width,
            offset: width * i,
            index: i,
          })}
          keyExtractor={(_, i) => String(i)}
          renderItem={renderItem}
          onMomentumScrollEnd={settle}
          showsHorizontalScrollIndicator={false}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          windowSize={3}
        />
        <View style={[styles.top, { paddingTop: insets.top + 6 }]}>
          <Text style={styles.name} numberOfLines={1}>
            {current ? nameOf(current) : ""}
          </Text>
          {list.length > 1 && (
            <Text style={styles.count}>
              {index + 1} / {list.length}
            </Text>
          )}
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          >
            <Text style={styles.closeText}>Fermer</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** One image, fit to the screen; iOS's own pinch zooms it. */
function ZoomPage({
  image,
  width,
  height,
}: {
  image: ImageRef;
  width: number;
  height: number;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <ScrollView
      style={{ width, height }}
      contentContainerStyle={styles.page}
      maximumZoomScale={failed ? 1 : 4}
      minimumZoomScale={1}
      centerContent
      bouncesZoom
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
    >
      {failed ? (
        <Text style={styles.failed}>Image introuvable sur le PC</Text>
      ) : (
        <Image
          source={imageSource(image)}
          style={{ width, height }}
          contentFit="contain"
          transition={120}
          accessibilityLabel={nameOf(image)}
          onError={() => setFailed(true)}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000000" },
  page: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  top: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  name: { flex: 1, color: C.ink, fontSize: T.small, fontWeight: "500" },
  count: { color: C.dim, fontSize: T.small, fontVariant: ["tabular-nums"] },
  close: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  pressed: { opacity: 0.5 },
  closeText: { color: C.accent, fontSize: T.body, fontWeight: "500" },
  failed: { color: C.mute, fontSize: T.small },
});
