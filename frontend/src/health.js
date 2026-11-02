export async function checkHealth(fetcher = fetch) {
  try {
    const response = await fetcher('/api/health');
    if (!response.ok) return false;
    const data = await response.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}
