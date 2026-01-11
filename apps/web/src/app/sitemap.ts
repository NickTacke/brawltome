import type { MetadataRoute } from 'next';

// Use a stable timestamp to avoid unnecessary cache invalidation
const lastModified = new Date();

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://brawltome.app',
      lastModified,
      changeFrequency: 'daily',
      priority: 1,
    },
  ];
}
