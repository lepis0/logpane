import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "./Button";

type Lang = "fi" | "en";

interface HelpSection {
  title: Record<Lang, string>;
  items: Record<Lang, string[]>;
}

const SECTIONS: HelpSection[] = [
  {
    title: { fi: "Lähteet", en: "Sources" },
    items: {
      fi: [
        "Lisää uusi lähde sivupalkin +-painikkeesta: anna nimi, valitse tyyppi (yksittäinen tiedosto tai glob-kuvio), polku, väri ja valinnaiset tagit.",
        "Käytä kansiokuvakkeen 'Selaa…'-painiketta valitaksesi tiedoston tai kansion graafisesti sen sijaan että kirjoitat polun ulkomuistista.",
        "Glob-tyyppi (esim. /logs/*/*.log) seuraa uusinta osumaa, mutta muut osumat pysyvät selattavina.",
        "Sivupalkin rataspainikkeesta avautuvassa hallintanäkymässä voit muokata, poistaa, rollata tai ladata minkä tahansa lähteen.",
        "Poistaminen lopettaa vain lähteen seurannan - tiedostoja levyllä ei kosketa.",
      ],
      en: [
        "Add a new source from the sidebar's + button: give it a name, pick a type (single file or glob pattern), a path, a color, and optional tags.",
        "Use the folder icon's 'Browse…' button to pick a file or directory graphically instead of typing the path from memory.",
        "A glob-type source (e.g. /logs/*/*.log) follows the most recently modified match live, while the other matches stay browsable.",
        "The manage-sources view (gear icon in the sidebar) lets you edit, delete, roll, or download any source.",
        "Deleting a source only stops tracking it - files on disk are left untouched.",
      ],
    },
  },
  {
    title: { fi: "Paneelit", en: "Panes" },
    items: {
      fi: [
        "Klikkaamalla lähdettä sivupalkissa se avautuu aktiivisessa paneelissa (korvaten sen sisällön).",
        "Keskiklikkaus (hiiren rullapainike) avaa lähteen aina uuteen paneeliin, kunnes 4 paneelin katto tulee vastaan.",
        "Paneelien väliset jakoviivat ovat raahattavia, jolloin voit muuttaa kunkin paneelin kokoa.",
        "Paneeli suljetaan sen omasta X-painikkeesta - lähde itse jää tallelle.",
      ],
      en: [
        "Clicking a source in the sidebar opens it in the currently active pane (replacing its content).",
        "Middle-clicking (mouse wheel button) always opens the source in a new pane, up to a maximum of 4 panes.",
        "The dividers between panes are draggable, so you can resize each pane.",
        "Close a pane with its own X button - the source itself remains available.",
      ],
    },
  },
  {
    title: { fi: "Haku", en: "Search" },
    items: {
      fi: [
        "Kirjoita hakukenttään suodattaaksesi tai korostaaksesi osumia rivillä.",
        "'.*'-kytkin ottaa käyttöön säännölliset lausekkeet (regex) tavallisen tekstihaun sijaan.",
        "'Aa'-kytkin vaihtaa kirjainkoon huomioimisen päälle/pois.",
        "'Vain osumat' -suodatin piilottaa kaikki rivit jotka eivät täsmää hakuun.",
        "Osumalaskuri näyttää nykyisen/kaikki osumat, ja nuolipainikkeilla (tai Enter / Shift+Enter) hypätään edelliseen/seuraavaan osumaan.",
        "Virheellinen regex näytetään punaisella tekstillä hakukentän vieressä.",
      ],
      en: [
        "Type in the search field to filter or highlight matches on each line.",
        "The '.*' toggle switches to regular-expression matching instead of plain text.",
        "The 'Aa' toggle turns case-sensitive matching on or off.",
        "The 'only matching' filter hides every line that doesn't match the search.",
        "The match counter shows current/total matches; the arrow buttons (or Enter / Shift+Enter) jump to the previous/next match.",
        "An invalid regex is shown in red text next to the search field.",
      ],
    },
  },
  {
    title: { fi: "Automaattinen vieritys", en: "Autoscroll" },
    items: {
      fi: [
        "Uudet rivit vierittävät näkymän automaattisesti alas niin kauan kuin olet paneelin pohjalla.",
        "Kun vierität ylös lukeaksesi vanhempia rivejä, automaattinen vieritys keskeytyy eikä hyppää enää itsestään alas.",
        "Keskeytyksen aikana näkyy 'N uutta riviä · jump to latest' -painike - klikkaa sitä (tai vieritä itse takaisin pohjalle) jatkaaksesi seurantaa.",
        "Vierittämällä paneelin yläreunaan asti ladataan lisää vanhempia rivejä palvelimelta.",
      ],
      en: [
        "New lines auto-scroll the view down as long as you're at the bottom of the pane.",
        "Scrolling up to read older lines pauses autoscroll so the view no longer jumps down on its own.",
        "While paused, a 'N new lines · jump to latest' button appears - click it (or scroll back to the bottom yourself) to resume following.",
        "Scrolling to the very top of a pane loads more older lines from the server.",
      ],
    },
  },
  {
    title: { fi: "Lokitason värjäys", en: "Log-level coloring" },
    items: {
      fi: [
        "Logpane tunnistaa parhaansa mukaan ERROR/FATAL/PANIC-, WARN-, INFO- ja DEBUG/TRACE-tasot riveiltä ja värjää ne omalla värillään.",
        "Tunnistus toimii sekä paljailla sanoilla, [TAG]-hakasulkeilla että JSON-tyylisillä level=/\"level\":\"...\" -kentillä.",
      ],
      en: [
        "Logpane makes a best-effort detection of ERROR/FATAL/PANIC, WARN, INFO, and DEBUG/TRACE levels in each line and colors them accordingly.",
        "Detection works with bare words, [TAG] brackets, and JSON-style level=/\"level\":\"...\" fields.",
      ],
    },
  },
  {
    title: { fi: "Roll ja lataus", en: "Roll & download" },
    items: {
      fi: [
        "Roll-painike (jos lähteelle sallittu) arkistoi ja tyhjentää nykyisen tiedoston vahvistuksen jälkeen.",
        "Lataa-painike lataa lähteen nykyisen tiedoston suoraan selaimeen.",
      ],
      en: [
        "The roll button (if enabled for the source) archives and truncates the current file after a confirmation prompt.",
        "The download button downloads the source's current file directly to your browser.",
      ],
    },
  },
  {
    title: { fi: "Teema", en: "Theme" },
    items: {
      fi: ["Tumma/vaalea-kytkin sivupalkin yläreunassa vaihtaa teeman ja muistaa valinnan uudelleenlatauksen yli."],
      en: ["The dark/light toggle at the top of the sidebar switches the theme and remembers your choice across reloads."],
    },
  },
  {
    title: { fi: "Pikanäppäimet", en: "Keyboard shortcuts" },
    items: {
      fi: [
        "'/' fokusoi aktiivisen paneelin hakukentän (ei laukea jos jo kirjoitat toiseen kenttään).",
        "'Esc' poistaa fokuksen nykyisestä kentästä.",
      ],
      en: [
        "'/' focuses the active pane's search field (ignored while you're already typing in a field).",
        "'Esc' blurs the currently focused field.",
      ],
    },
  },
];

const TEXT: Record<Lang, { title: string; close: string }> = {
  fi: { title: "Ohje", close: "Sulje" },
  en: { title: "Help", close: "Close" },
};

export interface HelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HelpDialog({ open, onOpenChange }: HelpDialogProps) {
  const [lang, setLang] = useState<Lang>("fi");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex h-[32rem] w-[36rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="text-sm font-semibold">{TEXT[lang].title}</Dialog.Title>
            <div className="flex items-center gap-1.5">
              <div className="flex items-center overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
                {(["fi", "en"] as const).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setLang(code)}
                    className={cn(
                      "px-2.5 py-1 text-xs font-medium uppercase transition-colors",
                      lang === code
                        ? "bg-sky-600 text-white"
                        : "bg-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                    )}
                  >
                    {code}
                  </button>
                ))}
              </div>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" aria-label={TEXT[lang].close}>
                  <X className="size-4" />
                </Button>
              </Dialog.Close>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 text-sm">
            {SECTIONS.map((section) => (
              <div key={section.title.en}>
                <h3 className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {section.title[lang]}
                </h3>
                <ul className="list-disc space-y-1 pl-5 text-slate-600 dark:text-slate-300">
                  {section.items[lang].map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
