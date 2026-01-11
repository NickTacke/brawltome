const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export async function fetcher(path: string) {
  const response = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
  if (!response.ok) {
    if (response.status === 404) return null; // Gracefully handle 404s
    const error = new Error('Failed to fetch data');
    (error as Error & { status: number }).status = response.status;
    throw error;
  }
  return response.json();
}
