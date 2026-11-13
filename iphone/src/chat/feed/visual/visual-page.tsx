import {
  type ComponentRef,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Linking, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import * as WebBrowser from "expo-web-browser";
import {
  clampVisualHeight,
  firstFrameGrowth,
  nextFrameHeight,
  visualDocument,
} from "@/lib/chat/chatVisual";
import {
  phoneVisualBridge,
  phoneVisualMayLoad,
  readPhoneVisualMessage,
} from "@/lib/chat/phoneVisual";
import { C } from "~/chat/chat-theme";

interface VisualPageProps {
  /** The page, its images in (`visualHtml`). The parent keys this by it. */
  html: string;
  /** Fills its box (« Agrandir »): the page as written, scrolling and zooming. */
  fill?: boolean;
  /** The desktop checked it clean: its growth is never stopped (`nextFrameHeight`). */
  verified?: boolean;
  /** A choice of the page (`arkadia.choose`), after the user's tap in it. */
  onChoose: (text: string) => void;
}

/** Height before the page says its own (`size`), as the desktop's frame. */
const FIRST_HEIGHT = 160;

/**
 * Around a card on screen, always: the header, the composer and the card's
 * band. Approximate: the room only caps the page's images and videos.
 */
const AROUND_CARD = 190;

/**
 * The height each page last took, by page: the feed's list unmounts a card
 * scrolled away, and one mounted again starts at it, not at `FIRST_HEIGHT`
 * (the list would jump while the page loads again).
 */
const lastHeights = new Map<string, number>();

const CARD_BRIDGE = phoneVisualBridge(true);
const FILL_BRIDGE = phoneVisualBridge(false);

/** Only the page's bootstrap holds it: its messages are its own (`readFrameMessage`). */
function newToken(): string {
  const part = () => Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}${part()}${part()}`;
}

/** A link of the page, on the user's tap: the system's browser, over the app. */
function openLink(url: string) {
  void WebBrowser.openBrowserAsync(url).catch(() =>
    Linking.openURL(url).catch(() => {}),
  );
}

/**
 * A visual's page in a WKWebView: the desktop's document (`visualDocument`,
 * its CSP and the column's theme), its bootstrap bridged to the app
 * (`phoneVisualBridge`). In the card it takes the page's own height, never
 * scrolls nor zooms (the conversation scrolls past it), its media fitted to
 * the screen (`--ark-fit-h`). The WebView loads that document and nothing
 * else, opens no window and asks for no camera.
 */
export function VisualPage({
  html,
  fill = false,
  verified = false,
  onChoose,
}: VisualPageProps) {
  const { height: screen } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Read once: a new room would mean loading the page again (and the app is portrait).
  const [room] = useState(
    () => screen - insets.top - insets.bottom - AROUND_CARD,
  );
  const [token] = useState(newToken);
  const source = useMemo(
    () => ({
      html: visualDocument(html, token, fill ? undefined : room, !fill),
    }),
    [html, token, fill, room],
  );
  /** Its WebContent process killed (memory): a new WebView loads the page again. */
  const [life, setLife] = useState(0);
  const [growth, setGrowth] = useState(() =>
    firstFrameGrowth(lastHeights.get(html) ?? FIRST_HEIGHT),
  );
  useEffect(() => {
    if (!fill) lastHeights.set(html, growth.height);
  }, [html, fill, growth.height]);
  /**
   * When the card's height last landed on screen (`nextFrameHeight`'s round
   * trip), and that height: the list moving the card is no resize.
   */
  const resizedAt = useRef<number | null>(null);
  const laidHeight = useRef(0);
  const verifiedRef = useRef(verified);
  const chooseRef = useRef(onChoose);
  const webRef = useRef<ComponentRef<typeof WebView>>(null);
  useEffect(() => {
    verifiedRef.current = verified;
    chooseRef.current = onChoose;
  });

  const onMessage = (e: WebViewMessageEvent) => {
    const m = readPhoneVisualMessage(e.nativeEvent.data, token);
    if (!m) return;
    if (m.kind === "size" && !fill) {
      const at = resizedAt.current;
      const since = at === null ? null : Date.now() - at;
      setGrowth((g) =>
        nextFrameHeight(
          g,
          clampVisualHeight(m.height),
          since,
          !verifiedRef.current,
        ),
      );
    } else if (m.kind === "choose") {
      chooseRef.current(m.text);
      // The page may say so (the choice kit's « Ajouté »): it went in.
      webRef.current?.injectJavaScript(
        'window.dispatchEvent(new Event("arkadia-chosen"));true;',
      );
    }
    else if (m.kind === "link") openLink(m.url);
  };

  return (
    <View
      style={fill ? styles.fill : [styles.card, { height: growth.height }]}
      onLayout={(e) => {
        const { height } = e.nativeEvent.layout;
        if (height === laidHeight.current) return;
        laidHeight.current = height;
        resizedAt.current = Date.now();
      }}
    >
      <WebView
        ref={webRef}
        key={life}
        source={source}
        style={styles.web}
        injectedJavaScriptBeforeContentLoaded={fill ? FILL_BRIDGE : CARD_BRIDGE}
        onMessage={onMessage}
        // Every address comes to `phoneVisualMayLoad`: one out of the list
        // the library would hand to iOS to open, without a tap.
        originWhitelist={["*"]}
        onShouldStartLoadWithRequest={(r) => phoneVisualMayLoad(r.url)}
        // A popup (window.open, target=_blank): dropped, as the desktop's sandbox does.
        onOpenWindow={() => {}}
        // A refused load never swaps the page for the library's error screen.
        onError={(e) => e.preventDefault()}
        onContentProcessDidTerminate={() => setLife((n) => n + 1)}
        javaScriptCanOpenWindowsAutomatically={false}
        allowsLinkPreview={false}
        dataDetectorTypes="none"
        mediaCapturePermissionGrantType="deny"
        allowsInlineMediaPlayback
        incognito
        scrollEnabled={fill}
        bounces={fill}
        showsHorizontalScrollIndicator={fill}
        showsVerticalScrollIndicator={fill}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        webviewDebuggingEnabled={__DEV__}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.bg },
  fill: { flex: 1, backgroundColor: C.bg },
  // Clear until the page paints (its own background is the column's): no white flash.
  web: { flex: 1, backgroundColor: "transparent" },
});
