/** The first letter upper-cased, the rest as written: "client_recurrent" words, a search hit type. */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Letters without their accents and case, for a search: "sai" finds "Saïd". */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** A shared uppercase label (or any casing) read as a sentence: "VIEW ONLY" becomes "View only". */
export function sentenceCase(text: string): string {
  return capitalize(text.toLowerCase());
}
