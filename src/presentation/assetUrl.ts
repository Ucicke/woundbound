/** Development keeps source PNGs; production uses lossless WebP copies. */
export function assetUrl(path: string): string {
  const relative = path.replace(/^\//, '');
  const file = import.meta.env.PROD ? relative.replace(/\.png$/i, '.webp') : relative;
  return `${import.meta.env.BASE_URL}${file}`;
}
