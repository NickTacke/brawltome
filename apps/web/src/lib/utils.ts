export function fixEncoding(str: string | null | undefined): string {
  if (!str) return '';
  try {
    // If the string contains common Mojibake patterns (like Ã¼), try to fix it
    // effectively, we are treating the string as if it was decoded as ISO-8859-1 but was actually UTF-8
    // escape() converts string to %XX format, decodeURIComponent reads it back as UTF-8
    // valid for restoring UTF-8 bytes that were interpreted as Latin-1
    return decodeURIComponent(escape(str));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (err) {
    // If it fails (e.g. valid UTF-8 already that would break this hack), return original
    return str;
  }
}

