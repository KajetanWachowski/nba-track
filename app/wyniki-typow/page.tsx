import { redirect } from "next/navigation";

/** Wyniki są teraz w zakładce „Kupony” (sekcja Wyniki). */
export default function ResultsRedirect() {
  redirect("/kupony#wyniki");
}
