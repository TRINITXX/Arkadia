import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import type { ConvImage } from "@/lib/convStore";
import { ARKADIA_HOST } from "~/remote/config";

/**
 * Images of a turn, read from the PC's image cache through the phone route
 * `/image`, which takes only requests that say they come from its own page.
 */
export function ConvImages({ images }: { images: ConvImage[] | undefined }) {
  if (!images?.length) return null;
  return (
    <View style={styles.row}>
      {images.map((img) => (
        <Image
          key={img.path}
          source={{
            uri: `https://${ARKADIA_HOST}/image?path=${encodeURIComponent(img.path)}`,
            headers: { "Sec-Fetch-Site": "same-origin" },
          }}
          style={styles.image}
          contentFit="cover"
          transition={150}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  image: { width: 120, height: 120, borderRadius: 12 },
});
