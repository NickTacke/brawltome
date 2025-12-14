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

export function timeAgo(date: string | Date | number): string {
  const d = new Date(date);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000);

  if (seconds < 60) {
    return 'just now';
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }

  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months}mo ago`;
  }

  const years = Math.floor(months / 12);
  return `${years}y ago`;
}
