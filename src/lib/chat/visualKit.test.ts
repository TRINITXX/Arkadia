import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { VISUAL_THEME_CSS } from "@/lib/chat/chatVisual";
import { VISUAL_KIT_CSS, VISUAL_KIT_JS } from "@/lib/chat/visualKit";

/** A page with the kit run over it, in a window of its own; `sent`: what it chose. */
function page(body: string, framed = true) {
  const win = new Window({ url: "http://localhost/" });
  const doc = win.document;
  doc.body.innerHTML = body;
  const sent: string[] = [];
  Object.defineProperty(win, "arkadia", {
    value: { choose: (t: string) => sent.push(t) },
  });
  // The kit as the frame runs it, against this window's globals.
  new Function(
    "window",
    "document",
    "CustomEvent",
    "Event",
    "requestAnimationFrame",
    VISUAL_KIT_JS,
  )(win, doc, win.CustomEvent, win.Event, (f: () => void) => setTimeout(f, 0));
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
  return { doc, q, all, click, sent, ack };
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
    // Capped: the bridge cuts the whole summary at 4000 characters.
    expect(fields[0].maxLength).toBe(500);
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
});
