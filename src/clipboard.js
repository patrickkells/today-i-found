export async function copyText(
  value,
  {
    clipboardImpl = globalThis.navigator?.clipboard,
    documentImpl = globalThis.document,
  } = {},
) {
  try {
    if (!clipboardImpl?.writeText) throw new Error("Clipboard API unavailable");
    await clipboardImpl.writeText(value);
    return true;
  } catch {
    let textarea;
    const previouslyFocused = documentImpl?.activeElement;
    try {
      textarea = documentImpl?.createElement("textarea");
      if (!textarea || !documentImpl?.body || typeof documentImpl.execCommand !== "function") return false;
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      documentImpl.body.append(textarea);
      textarea.select();
      return documentImpl.execCommand("copy") === true;
    } catch {
      return false;
    } finally {
      textarea?.remove();
      if (previouslyFocused && previouslyFocused !== documentImpl?.body && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    }
  }
}
