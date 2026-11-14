// The browser's half of a wholesaler delivery's upload: each file goes
// straight to private storage through the signed URL its ticket carries
// (docs/technical/document-storage-and-access.md, "Wholesaler deliveries").
// No byte passes through a Server Action.

/** Uploads each file through its signed URL; false when one did not arrive. */
export async function uploadDeliveryFiles(
  files: readonly File[],
  uploadUrls: readonly string[],
  contentType: string,
): Promise<boolean> {
  const answers = await Promise.all(
    files.map(async (file, index) => {
      const response = await fetch(uploadUrls[index] ?? '', {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': contentType },
      }).catch(() => null);
      return response?.ok ?? false;
    }),
  );
  return answers.every(Boolean);
}
