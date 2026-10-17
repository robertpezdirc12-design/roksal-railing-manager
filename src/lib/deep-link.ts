// deep-link — R544: URL odraz stanja zavihka (globoka povezava /?m=<tabId>).
// Shema: /?m=<id zavihka> — sekcijo izpelje sectionForTab (nav-registry, EN VIR);
// id-ji se vežejo na register (logistika→„Plan", varnost→„Revizija": id≠ime).
//
// Pravila (raziskava R544-a):
//  • vsak navigacijski klik naredi pushTabState → zgodovina brskalnika se
//    polni in BACK gumb odvija preklope (prej: naslovna vrstica vedno /);
//  • inicialni sync ob mountu AppShell: URL zmaga nad persistom
//    (roksal-session) — globoka povezava odpre ciljni zavihek tudi po prijavi
//    (LoginScreen ne navigira, ?m preživi v naslovu);
//  • neveljaven ?m (neznan id ali zavihek brez pravice — tabVisible fail-closed)
//    → clearTabState: odstranjen iz naslova, stanje ostane na persistanem
//    zavihku. Modul vrata (module-view) ostajajo glavna obramba.
//
// Čist client-safe lib — brez Reacta, brez strežniških uvozov; vse funkcije so
// testabilne (URLSearchParams nad nizi), stranski učinki (history) imajo
// try/catch varovalko za SSR/izolirane teste (history obstaja samo v brskalniku).

export const TAB_PARAM = 'm'

/** Prebere ?m iz podanega search niza (location.search). Null kadar manjka/prazen. */
export function tabFromSearch (search: string): string | null {
  const raw = new URLSearchParams(search).get(TAB_PARAM)
  if (!raw) return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** URL za zavihek: /?m=<id>. Vezaji v id-jih (foto-replace, material-v5 …) so v
 *  query vrednostih dovoljeni, encodeURIComponent jih vseeno ohrani varne. */
export function urlForTab (tabId: string): string {
  return `/?${TAB_PARAM}=${encodeURIComponent(tabId)}`
}

/** Zapiši zavihek v zgodovino (NOVA entrata — back jo odvije nazaj). */
export function pushTabState (tabId: string): void {
  try {
    window.history.pushState({ rokTab: tabId }, '', urlForTab(tabId))
  } catch {
    /* SSR/test brez window.history — nikoli v brskalniku */
  }
}

/** Odstrani ?m iz naslova (neveljaven vnos) BREZ nove zgodovinske entrate. */
export function clearTabState (): void {
  try {
    window.history.replaceState({}, '', '/')
  } catch {
    /* SSR/test brez window.history — nikoli v brskalniku */
  }
}
