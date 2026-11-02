import {
  ACTIVATION_MS,
  readFrameMessage,
  type FrameMessage,
} from "@/lib/chat/chatVisual";

/**
 * A chat visual on the iPhone (`iphone/src/chat/feed/chat-visual-card.tsx`):
 * the desktop's document (`visualDocument`: CSP, theme, bootstrap) loaded
 * straight into a WKWebView, no shell and no frame around it. Pure: the
 * script that bridges the page's bootstrap to the app, what the page may
 * load, and what it says back. The phone only shows a visual, never checks
 * it (the desktop page does).
 */

/** The page's address: react-native-webview loads an html source on this base. */
export const PHONE_VISUAL_URL = "about:blank";

/**
 * What the WebView may load: the page itself and its own `#anchors`. Never
 * another page, a `data:` or `blob:` document (it would drop the CSP), nor a
 * frame: links go to the browser through the bootstrap (`link`).
 */
export function phoneVisualMayLoad(url: string): boolean {
  return url.split("#")[0] === PHONE_VISUAL_URL;
}

/**
 * The card's page never zooms (the conversation scrolls past it): a viewport
 * after the page's own, which WKWebView honours (Safari alone ignores it).
 * « Agrandir » keeps the page's own viewport: pinch-zoom as written.
 */
const NO_ZOOM = `document.addEventListener("DOMContentLoaded",function(){var m=document.createElement("meta");m.name="viewport";m.content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";(document.head||document.documentElement).appendChild(m);});`;

/**
 * The script the WebView runs before the page (`injectedJavaScriptBeforeContentLoaded`,
 * the page's own world), so the desktop's bootstrap works unchanged: it
 * talks to `window.parent`, which a top-level page doesn't have. This makes
 * one, frozen and for good, that hands the app the bootstrap's height, link
 * and choice (`readPhoneVisualMessage`). Everything it uses is taken before
 * the page runs: a page that patches `JSON`, `Object.prototype.toJSON` or
 * `window.webkit` later never sees the token. A link or a choice passes only
 * within `ACTIVATION_MS` of the user's tap in the page (the desktop's
 * `frameGestureOk`), never a page's own call.
 */
export function phoneVisualBridge(card: boolean): string {
  return `(function(){
var W=window,M=W.webkit&&W.webkit.messageHandlers,H=M&&M.ReactNativeWebView;if(!H||W.parent!==W)return;
var send=H.postMessage.bind(H),q=JSON.stringify,now=Date.now,tap=-Infinity,A=${ACTIVATION_MS};
function user(e){if(e.isTrusted)tap=now();}
W.addEventListener("click",user,true);W.addEventListener("touchend",user,true);
var up=Object.freeze({postMessage:function(m){if(!m||typeof m!=="object"||m.arkadiaVisual!==1)return;
var k=m.k,kind=m.kind,v=m.v,out;if(typeof k!=="string")return;
if(kind==="size"){if(typeof v!=="number"||v!==v||v===Infinity||v===-Infinity)return;out=""+v;}
else if(kind==="link"||kind==="choose"){if(typeof v!=="string"||now()-tap>A)return;out=q(v);}
else return;
send('{"arkadiaVisual":1,"k":'+q(k)+',"kind":"'+kind+'","v":'+out+"}");}});
try{Object.defineProperty(W,"parent",{value:up,writable:false,configurable:false});}catch(x){try{W.parent=up;}catch(y){}}
${card ? NO_ZOOM : ""}
})();true;`;
}

/**
 * A message the bridge passed up (`onMessage`'s string), read as the
 * desktop reads a frame's (`readFrameMessage`): only its bootstrap's, by the
 * page's token.
 */
export function readPhoneVisualMessage(
  data: string,
  token: string,
): FrameMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  return readFrameMessage(parsed, token);
}
