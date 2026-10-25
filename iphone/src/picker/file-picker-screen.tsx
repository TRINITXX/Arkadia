import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SegmentedControl } from "@expo/ui/community/segmented-control";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { quotePathsForPrompt } from "@/lib/pickerPrompt";
import type { FileSource, RemoteFile } from "@/lib/remoteProtocol";
import { ARKADIA_HOST } from "~/remote/config";
import { listFiles, send } from "~/remote/connection";
import { showNotice } from "~/ui/notice";

const SOURCES: { id: FileSource; label: string }[] = [
  { id: "photos", label: "Photos" },
  { id: "downloads", label: "Téléchargements" },
];
/** One page more each time the grid is scrolled to its end. */
const PAGE = 60;
const MAX = 1000;
const GAP = 3;

/**
 * The PC's recent photos (its iCloud Photos folder) and downloads, as the
 * desktop rail's picker (choice A of 25/10/2026: Apple sheet, grid, several
 * to tick). « Insérer » types their quoted paths into Claude's prompt, nothing
 * is uploaded: the photos are on the PC already.
 */
export function FilePickerScreen() {
  const { pane } = useLocalSearchParams<{ pane: string }>();
  const { width } = useWindowDimensions();
  const tile = Math.floor((width - GAP * 4) / 3);
  const [source, setSource] = useState<FileSource>("photos");
  const [files, setFiles] = useState<RemoteFile[] | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    listFiles(source, limit)
      .then((list) => live && setFiles(list))
      .catch((e) => {
        if (!live) return;
        setFiles([]);
        showNotice(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [source, limit]);

  const switchSource = (next: FileSource) => {
    setSource(next);
    setFiles(null);
    setLimit(PAGE);
  };
  const toggle = useCallback(
    (path: string) =>
      setPicked((p) =>
        p.includes(path) ? p.filter((x) => x !== path) : [...p, path],
      ),
    [],
  );
  const insert = () => {
    if (!pane || picked.length === 0) return;
    send({ t: "input", pane, data: quotePathsForPrompt(picked) });
    router.back();
  };

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <Text style={styles.title}>Insérer dans l’invite</Text>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.close}
        >
          <SymbolView name="xmark" size={14} tintColor="#8e8e93" />
        </Pressable>
      </View>
      <SegmentedControl
        values={SOURCES.map((s) => s.label)}
        selectedIndex={SOURCES.findIndex((s) => s.id === source)}
        onChange={(e) =>
          switchSource(
            SOURCES[e.nativeEvent.selectedSegmentIndex]?.id ?? "photos",
          )
        }
        appearance="dark"
        style={styles.segment}
      />
      {files === null ? (
        <ActivityIndicator color="#8e8e93" style={styles.loading} />
      ) : (
        <FlatList
          data={files}
          numColumns={3}
          keyExtractor={(f) => f.path}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.grid}
          onEndReached={() =>
            files.length >= limit && setLimit((l) => Math.min(MAX, l + PAGE))
          }
          ListEmptyComponent={<Text style={styles.empty}>Rien ici.</Text>}
          renderItem={({ item }) => (
            <FileTile
              file={item}
              size={tile}
              order={picked.indexOf(item.path)}
              onPress={toggle}
            />
          )}
        />
      )}
      <Pressable
        onPress={insert}
        disabled={picked.length === 0}
        style={({ pressed }) => [
          styles.insert,
          (pressed || picked.length === 0) && styles.dimmed,
        ]}
      >
        <Text style={styles.insertText}>
          {picked.length === 0
            ? "Insérer"
            : `Insérer ${picked.length} élément${picked.length > 1 ? "s" : ""}`}
        </Text>
      </Pressable>
    </View>
  );
}

function FileTile({
  file,
  size,
  order,
  onPress,
}: {
  file: RemoteFile;
  size: number;
  /** Its rank among the picked, -1 when not picked. */
  order: number;
  onPress: (path: string) => void;
}) {
  const on = order >= 0;
  return (
    <Pressable
      onPress={() => onPress(file.path)}
      style={[styles.tile, { width: size, height: size }]}
    >
      {file.is_image ? (
        <Image
          source={{
            uri: `https://${ARKADIA_HOST}/thumb?path=${encodeURIComponent(file.path)}`,
            headers: { "Sec-Fetch-Site": "same-origin" },
          }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey={file.path}
          transition={120}
        />
      ) : (
        <View style={styles.doc}>
          <SymbolView
            name={file.is_dir ? "folder.fill" : "doc.fill"}
            size={30}
            tintColor="#8e8e93"
          />
          <Text style={styles.docName} numberOfLines={2}>
            {file.name}
          </Text>
        </View>
      )}
      {on && <View style={styles.ring} />}
      <View style={[styles.check, on && styles.checkOn]}>
        {on && <Text style={styles.checkText}>{order + 1}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#1c1c1e" },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  title: { color: "#ffffff", fontSize: 17, fontWeight: "600" },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#2c2c2e",
    alignItems: "center",
    justifyContent: "center",
  },
  segment: { marginHorizontal: 16, marginBottom: 12, height: 32 },
  loading: { marginTop: 40 },
  grid: { paddingHorizontal: GAP, gap: GAP, paddingBottom: 12 },
  gridRow: { gap: GAP },
  empty: { color: "#8e8e93", textAlign: "center", marginTop: 40 },
  tile: { borderRadius: 4, overflow: "hidden", backgroundColor: "#2c2c2e" },
  doc: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 6,
  },
  docName: { color: "#c7c7cc", fontSize: 11, textAlign: "center" },
  ring: {
    ...StyleSheet.absoluteFill,
    borderWidth: 3,
    borderColor: "#0a84ff",
    borderRadius: 4,
  },
  check: {
    position: "absolute",
    right: 6,
    bottom: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#ffffff",
    backgroundColor: "rgba(0,0,0,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: "#0a84ff" },
  checkText: { color: "#ffffff", fontSize: 12, fontWeight: "700" },
  insert: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 34,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#0a84ff",
    alignItems: "center",
    justifyContent: "center",
  },
  dimmed: { opacity: 0.5 },
  insertText: { color: "#ffffff", fontSize: 17, fontWeight: "600" },
});
