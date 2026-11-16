import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { VISUAL_THEME_CSS } from "@/lib/chat/chatVisual";
import { VISUAL_KIT_CSS, VISUAL_KIT_JS } from "@/lib/chat/visualKit";

/** A page with the kit run over it, in a window of its own; `sent`: what it chose. */
function page(body: string, framed = true, asks = true) {
  const win = new Window({ url: "http://localhost/" });
  const doc = win.document;
  doc.body.innerHTML = body;
  const sent: string[] = [];
  /** The images each choice carried. */
  const shots: unknown[] = [];
  const mic: boolean[] = [];
  /** The states the page kept, and how many times it asked its own back. */
  const kept: unknown[] = [];
  const asked = { n: 0 };
  Object.defineProperty(win, "arkadia", {
    value: {
      keep: (state: unknown) => kept.push(state),
      // `asks` false: a bridge that can't ask its state back (yet).
      ...(asks ? { restore: () => (asked.n += 1) } : {}),
      choose: (t: string, images?: unknown) => {
        sent.push(t);
        shots.push(images);
      },
      dictate: (on: boolean) => mic.push(on),
    },
  });
  // The kit as the frame runs it, against this window's globals.
  new Function(
    "window",
    "document",
    "CustomEvent",
    "Event",
    "requestAnimationFrame",
    "FileReader",
    VISUAL_KIT_JS,
  )(
    win,
    doc,
    win.CustomEvent,
    win.Event,
    (f: () => void) => setTimeout(f, 0),
    win.FileReader,
  );
  const q = (s: string) => doc.querySelector(s) as unknown as HTMLElement;
  const all = (s: string) =>
    Array.from(doc.querySelectorAll(s)) as unknown as HTMLElement[];
  const click = (s: string, text?: string) => {
    const el = text ? all(s).find((e) => e.textContent?.includes(text)) : q(s);
    if (!el) throw new Error(`nothing to click: ${s} ${text ?? ""}`);
    el.click();
  };
  const ack = () => {
    if (framed) win.dispatchEvent(new win.Event("arkadia-chosen"));
  };
  /** Arkadia asks the choice it held for a dictation again. */
  const chooseAgain = () =>
    win.dispatchEvent(new win.Event("arkadia-choose-again"));
  /** What Arkadia says of the pane's dictation (`arkadia-voice`), or its text. */
  const voice = (detail: Record<string, unknown>) =>
    win.dispatchEvent(new win.CustomEvent("arkadia-voice", { detail }));
  const dictated = (text: string) =>
    win.dispatchEvent(
      new win.CustomEvent("arkadia-dictated", { detail: text }),
    );
  const key = (
    el: Element,
    type: "keydown" | "keyup",
    init: { key: string; repeat?: boolean; ctrlKey?: boolean },
  ) => {
    const e = new win.KeyboardEvent(type, {
      ...init,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(e);
    return e.defaultPrevented;
  };
  /** Ctrl+V of a PNG in `el`; resolves once the page read it. */
  const pasteImage = async (el: Element, bytes = "png-1") => {
    const file = new win.File([bytes], "shot.png", { type: "image/png" });
    const e = new win.Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "clipboardData", { value: { files: [file] } });
    el.dispatchEvent(e);
    await new Promise((r) => setTimeout(r, 30));
    return e.defaultPrevented;
  };
  /** Arkadia's answer to `restore`: the state it kept, or null. */
  const restore = (state: unknown) =>
    win.dispatchEvent(
      new win.CustomEvent("arkadia-restore", { detail: state }),
    );
  return {
    doc,
    q,
    all,
    click,
    sent,
    shots,
    ack,
    chooseAgain,
    mic,
    voice,
    dictated,
    key,
    pasteImage,
    kept,
    asked,
    restore,
  };
}

const GROUPS = `<div class="ark-choice" data-intro="Mes choix pour les mails">
  <p id="intro">Trois listes à régler.</p>
  <section class="ark-group" data-title="Loueurs" data-sub="30 adresses">
    <div class="ark-question" data-title="Objet">
      <p id="qexpl">Le plus court gagne.</p>
      <div class="ark-option" data-reco>Un complément de revenu</div>
      <div class="ark-option">Jusqu'à 120 € par <b>chauffeur</b></div>
    </div>
    <div class="ark-question" data-title="Texte">
      <div class="ark-option" data-reco data-title="Mot pour mot"><p>Premier.</p><p>Second.</p></div>
      <div class="ark-option" data-title="Chiffré"><p>Exemple.</p></div>
    </div>
    <div class="ark-preview" data-title="Aperçu"><div class="ark-mail"><b>Alexis</b><span><b data-from=" objet "></b> · <span data-from="Texte"></span> <i data-from="Nulle part">gardé</i></span></div></div>
  </section>
  <section class="ark-group" data-title="Relance" data-sub="J+4">
    <div class="ark-note" data-title="Objet">Même fil.</div>
    <div class="ark-question" data-title="Texte" data-mark="letter">
      <div class="ark-option" data-title="Deux lignes"><p>Court.</p></div>
    </div>
  </section>
  <div id="after" class="ark-note" data-title="À savoir">Rien ne part sans toi.</div>
</div>`;

describe("the choice kit", () => {
  it("takes the width its options need, not the whole pane", () => {
    const few =
      page(`<div class="ark-choice"><div class="ark-question" data-title="Hébergement">
      <div class="ark-option" data-reco>Vercel, gratuit</div><div class="ark-option">Le VPS 1</div><div class="ark-option">Cloudflare Pages</div>
    </div></div>`);
    const fewWidth = parseInt(few.q(".ark-choice").style.maxWidth, 10);
    expect(fewWidth).toBeLessThan(600);
    // Mockups or pictures: the frame's width, never a guess from their text.
    const mocks =
      page(`<div class="ark-choice"><div class="ark-question" data-title="Design">
      <div class="ark-option" data-title="A"><img src="data:," alt=""></div><div class="ark-option" data-title="B"><svg></svg></div>
    </div></div>`);
    expect(mocks.q(".ark-choice").style.maxWidth).toBe("");
    const wide = page(GROUPS);
    expect(parseInt(wide.q(".ark-choice").style.maxWidth, 10)).toBeGreaterThan(
      fewWidth,
    );
  });

  it("lets a mockup in an option fill its card, never the pane-height cap", () => {
    const win = new Window({ url: "http://localhost/" });
    const doc = win.document;
    // The page's own class narrowed the shot as a session wrote it.
    doc.head.innerHTML = `<style>${VISUAL_THEME_CSS}</style><style>${VISUAL_KIT_CSS}</style><style>.shot{width:100%;max-width:260px}</style>`;
    doc.body.innerHTML = `<button class="ark-opt"><div class="ark-body"><img id="shot" class="shot" src="data:,"></div></button>
      <img id="lone" src="data:,"><button class="ark-opt"><img id="icon" width="20" src="data:,"></button>`;
    const css = (id: string) => {
      const el = doc.getElementById(id);
      if (!el) throw new Error(`no #${id}`);
      return win.getComputedStyle(el);
    };
    expect(css("shot").maxHeight).toBe("none");
    expect(css("shot").maxWidth).toBe("100%");
    // Outside a choice the cap holds; a sized picture stays as sized.
    expect(css("lone").maxHeight).not.toBe("none");
    expect(css("icon").maxHeight).toBe("");
  });

  it("keeps what sits beside options wrapped in a container", () => {
    const { q, all } = page(`<div class="ark-choice">
      <div class="ark-question" data-title="Q"><div class="cols"><h4 id="h1">Court</h4><div class="ark-option">A</div><h4 id="h2">Long</h4><div class="ark-option">B</div></div></div>
    </div>`);
    expect(q("#h1")?.closest(".ark-qx")).not.toBeNull();
    expect(q("#h2")?.closest(".ark-qx")).not.toBeNull();
    expect(all(".ark-opt")).toHaveLength(2);
  });

  it("keeps every node of the page it has no slot for", () => {
    const { q, doc } = page(GROUPS);
    expect(q("#intro")?.textContent).toBe("Trois listes à régler.");
    expect(q("#qexpl")?.closest(".ark-qx")).not.toBeNull();
    expect(doc.body.textContent).toContain("Rien ne part sans toi.");
    // An option's own markup moves into its card.
    expect(q(".ark-opt b")?.textContent).toBe("chauffeur");
  });

  it("starts on the advice, marks groups not yet seen, and sends one line per group", () => {
    const { all, click, sent, q } = page(GROUPS);
    expect(
      all(".ark-opt[aria-checked=true] .ark-mk").map((e) => e.textContent),
    ).toEqual(["01", "A"]);
    expect(all(".ark-step")[1].textContent).toContain("À voir");
    expect(q(".ark-left").textContent).toBe("Relance pas encore vue");
    click(".ark-opt", "par chauffeur");
    click(".ark-next");
    expect(q(".ark-left").textContent).toBe("");
    click(".ark-cta");
    expect(sent).toEqual([
      "Mes choix pour les mails :\nLoueurs : objet « Jusqu'à 120 € par chauffeur », texte « Mot pour mot »\nRelance : texte aucun choix",
    ]);
  });

  it("gives each question a remark field, sent in its line when filled", () => {
    const { doc, all, click, sent } = page(GROUPS);
    const fields = all(".ark-rmt") as HTMLTextAreaElement[];
    expect(fields).toHaveLength(3);
    fields[0].value = "  Trop long,\n à revoir ";
    // A key typed in a remark is text, never a pick.
    const key = new (doc.defaultView as unknown as typeof window).KeyboardEvent(
      "keydown",
      { key: "2", bubbles: true },
    );
    fields[0].dispatchEvent(key);
    expect(
      all(".ark-opt[aria-checked=true] .ark-mk").map((e) => e.textContent),
    ).toEqual(["01", "A"]);
    click(".ark-cta");
    expect(sent).toEqual([
      "Mes choix pour les mails :\nLoueurs : objet « Un complément de revenu » (remarque : Trop long, à revoir), texte « Mot pour mot »\nRelance : texte aucun choix",
    ]);
  });

  it("takes an image pasted into a remark: its tag at the caret, its thumbnail, sent with the choice", async () => {
    const p = page(GROUPS);
    const field = p.all(".ark-rmt")[0] as HTMLTextAreaElement;
    field.value = "Comme ça";
    field.focus();
    field.setSelectionRange(5, 5);
    expect(await p.pasteImage(field)).toBe(true);
    expect(field.value).toBe("Comme[Image #1] ça");
    expect(await p.pasteImage(p.all(".ark-rmt")[2], "png-2")).toBe(true);
    expect(p.all(".ark-pic img")).toHaveLength(2);
    // Its × takes it away with its tag; the next one keeps its number.
    expect(await p.pasteImage(field, "png-3")).toBe(true);
    expect(field.value).toBe("Comme[Image #1][Image #3] ça");
    (p.all(".ark-pic button")[0] as HTMLButtonElement).click();
    expect(field.value).toBe("Comme[Image #3] ça");
    // A tag erased by hand: back at the remark's end.
    (p.all(".ark-rmt")[2] as HTMLTextAreaElement).value = "voir";
    p.click(".ark-cta");
    expect(p.sent[0]).toContain("(remarque : Comme[Image #3] ça)");
    expect(p.sent[0]).toContain("(remarque : voir [Image #2])");
    expect(p.shots[0]).toEqual([
      { n: 3, m: "image/png", d: btoa("png-3") },
      { n: 2, m: "image/png", d: btoa("png-2") },
    ]);
  });

  it("dictates into a remark: mic, Space held or Ctrl+Space, the text at the caret", () => {
    const p =
      page(`<div class="ark-choice"><div class="ark-question" data-title="Prix">
      <div class="ark-option" data-reco>6,99 €</div><div class="ark-option">9,99 €</div>
    </div></div>`);
    const field = p.q(".ark-rmt") as HTMLTextAreaElement;
    const mic = p.q(".ark-mic") as HTMLButtonElement;
    // No word from Arkadia (the iPhone, the browser copy): no mic.
    expect(mic.hidden).toBe(true);
    p.voice({ can: true, status: "idle" });
    expect(mic.hidden).toBe(false);
    // Space held: the tap's space goes, the repeat starts, the release stops.
    field.value = "trop cher";
    field.setSelectionRange(4, 4);
    expect(p.key(field, "keydown", { key: " " })).toBe(false);
    field.value = "trop  cher";
    expect(p.key(field, "keydown", { key: " ", repeat: true })).toBe(true);
    expect(field.value).toBe("trop cher");
    expect(p.mic).toEqual([true]);
    p.voice({ can: true, mine: true, status: "listening", interim: "pour" });
    expect(mic.classList.contains("ark-rec")).toBe(true);
    // Shown where they will land, the caret.
    expect(p.q(".ark-rmw").textContent).toBe("trop pour cher");
    p.key(field, "keyup", { key: " " });
    expect(p.mic).toEqual([true, false]);
    // The words land where the caret was, a space each side.
    p.dictated("pour un mois");
    p.voice({ can: true, status: "idle" });
    expect(field.value).toBe("trop pour un mois cher");
    expect((p.q(".ark-rmw") as HTMLElement).hidden).toBe(true);
    // Ctrl+Space toggles; the mic of another dictation under way waits.
    expect(p.key(field, "keydown", { key: " ", ctrlKey: true })).toBe(true);
    expect(p.mic).toEqual([true, false, true]);
    p.voice({ can: true, mine: false, status: "listening" });
    expect(mic.disabled).toBe(true);
  });

  it("sends the choice again when Arkadia asks, the remark dictated meanwhile in it", () => {
    const p =
      page(`<div class="ark-choice"><div class="ark-question" data-title="Prix">
      <div class="ark-option" data-reco>6,99 €</div><div class="ark-option">9,99 €</div>
    </div></div>`);
    p.voice({ can: true, status: "idle" });
    p.click(".ark-mic");
    p.voice({ can: true, mine: true, status: "listening", interim: "trop" });
    // « Valider » mid-dictation: Arkadia holds it, the words land, then it asks again.
    p.click(".ark-cta");
    p.dictated("trop cher pour un mois");
    p.voice({ can: true, status: "idle" });
    p.chooseAgain();
    expect(p.sent).toHaveLength(2);
    expect(p.sent[1]).toContain("(remarque : trop cher pour un mois)");
    // Asked once: a later ask sends nothing more.
    p.chooseAgain();
    expect(p.sent).toHaveLength(2);
  });

  it("never cuts a remark, dictated at length", () => {
    const p =
      page(`<div class="ark-choice"><div class="ark-question" data-title="Prix">
      <div class="ark-option" data-reco>6,99 €</div>
    </div></div>`);
    const long = "mot ".repeat(750).trim();
    p.voice({ can: true, status: "idle" });
    p.click(".ark-mic");
    p.voice({ can: true, mine: true, status: "listening" });
    p.dictated(long);
    p.voice({ can: true, status: "idle" });
    expect((p.q(".ark-rmt") as HTMLTextAreaElement).value).toBe(long);
    p.click(".ark-cta");
    expect(p.sent[0]).toContain(`(remarque : ${long})`);
  });

  it("fills a preview from its question, whatever the case, and leaves an unknown one alone", () => {
    const { q, all } = page(GROUPS);
    expect(q(".ark-mail b[data-from]").textContent).toBe(
      "Un complément de revenu",
    );
    // Paragraphs keep a space between them.
    expect(all("[data-from]")[1].textContent).toBe("Premier. Second.");
    expect(q("i[data-from]").textContent).toBe("gardé");
  });

  it("says « Ajouté » only when Arkadia answers that the choice went in", () => {
    const framed = page(GROUPS);
    framed.click(".ark-cta");
    expect(framed.q(".ark-cta").textContent).toBe("Valider mes choix");
    framed.ack();
    expect(framed.q(".ark-cta").textContent).toBe("Ajouté à ton message");
    // A second click Arkadia refuses (a key typed in the Lab just before): no « Ajouté » left over.
    framed.click(".ark-cta");
    expect(framed.q(".ark-cta").textContent).toBe("Valider mes choix");
    // An answer nobody asked for (no click, or the page's own) changes nothing.
    const idle = page(GROUPS);
    idle.ack();
    expect(idle.q(".ark-cta").textContent).toBe("Valider mes choix");
  });

  it("draws a single question without tabs, and a multiple one by toggles", () => {
    const { all, click, sent } =
      page(`<div class="ark-choice" data-intro="Mon choix">
      <div class="ark-question" data-title="Hébergement"><div class="ark-option" data-reco>Vercel</div><div class="ark-option">Le VPS 1</div></div>
      <div class="ark-question" data-title="SMS" data-multi><div class="ark-option">Rappel</div><div class="ark-option">Reçu</div></div>
    </div>`);
    expect(all(".ark-step")).toHaveLength(0);
    click(".ark-opt", "VPS");
    click(".ark-opt", "Rappel");
    click(".ark-opt", "Reçu");
    click(".ark-cta");
    expect(sent[0]).toBe(
      "Mon choix :\nHébergement : « Le VPS 1 »\nSMS : « Rappel », « Reçu »",
    );
    expect(all("[role=checkbox]")).toHaveLength(2);
  });

  it("keeps its picks, tab, remarks and images for its next load", async () => {
    const first = page(GROUPS);
    expect(first.asked.n).toBe(1);
    // Nothing sent before Arkadia gave back what it kept: never over it.
    first.click(".ark-opt", "120");
    expect(first.kept).toHaveLength(0);
    first.restore(null);
    first.click(".ark-opt", "Chiffré");
    const field = first.all(".ark-rmt")[0] as HTMLTextAreaElement;
    field.value = "Plus court";
    field.dispatchEvent(
      new (first.doc.defaultView as unknown as typeof window).Event("input"),
    );
    await first.pasteImage(field);
    first.click(".ark-step", "Relance");
    await new Promise((r) => setTimeout(r, 200));
    const state = first.kept[first.kept.length - 1];

    // The frame gone and back: a new page, the same state.
    const again = page(GROUPS);
    again.restore(state);
    expect(again.all(".ark-step")[1].getAttribute("aria-selected")).toBe(
      "true",
    );
    // Applying what came back sends nothing back (the zoom's copy would echo).
    await new Promise((r) => setTimeout(r, 30));
    expect(again.kept).toHaveLength(0);
    again.click(".ark-step", "Loueurs");
    expect(
      again
        .all(".ark-opt[aria-checked=true] .ark-mk")
        .map((e) => e.textContent),
    ).toEqual(["02", "B"]);
    expect((again.all(".ark-rmt")[0] as HTMLTextAreaElement).value).toBe(
      "Plus court[Image #1]",
    );
    expect(again.all(".ark-pic img")).toHaveLength(1);
    // The next image takes the next number; the choice sends it.
    await again.pasteImage(again.all(".ark-rmt")[0], "png-2");
    again.click(".ark-cta");
    expect(again.sent[0]).toContain("[Image #1][Image #2]");
    expect((again.shots[0] as { n: number }[]).map((x) => x.n)).toEqual([1, 2]);
  });

  it("sends a remark typed a moment ago as soon as the frame is left", () => {
    const p = page(GROUPS);
    p.restore(null);
    const field = p.all(".ark-rmt")[0] as HTMLTextAreaElement;
    field.value = "Dernier mot";
    const win = p.doc.defaultView as unknown as typeof window;
    field.dispatchEvent(new win.Event("input"));
    expect(p.kept).toHaveLength(0);
    win.dispatchEvent(new win.Event("blur"));
    expect(p.kept).toHaveLength(1);
    const state = p.kept[0] as { qs: { r: string }[] }[];
    expect(state[0].qs[0].r).toBe("Dernier mot");
  });

  it("ignores a state pushed before it asked its own: its defaults never overwrite what is kept", () => {
    const early = page(GROUPS, true, false);
    early.restore([{ cur: 1, qs: [] }]);
    early.click(".ark-opt", "120");
    expect(early.all(".ark-step")[0].getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(early.kept).toHaveLength(0);
  });

  it("refuses an image past the ten a choice carries: no tag without its image", async () => {
    const p = page(GROUPS);
    const field = p.all(".ark-rmt")[0];
    for (let i = 0; i < 11; i++) await p.pasteImage(field, `png-${i}`);
    expect(p.all(".ark-pic")).toHaveLength(10);
    expect((field as HTMLTextAreaElement).value).not.toContain("[Image #11]");
  });

  it("unpicks a single choice clicked again: none forced when none is liked", () => {
    const { all, click, sent } =
      page(`<div class="ark-choice" data-intro="Mon choix">
      <div class="ark-question" data-title="Maquette"><div class="ark-option" data-reco>A</div><div class="ark-option">B</div></div>
    </div>`);
    const checked = () =>
      all(".ark-opt[aria-checked=true] .ark-st").map((e) => e.textContent);
    // The advised one, picked from the start, unpicks too.
    click(".ark-opt", "A");
    expect(checked()).toEqual([]);
    click(".ark-opt", "B");
    expect(checked()).toEqual(["B"]);
    click(".ark-opt", "B");
    expect(checked()).toEqual([]);
    click(".ark-cta");
    expect(sent[0]).toBe("Mon choix :\nMaquette : aucun choix");
  });
});
